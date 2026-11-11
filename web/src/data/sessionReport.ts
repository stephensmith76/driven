// The session report (SPEC.md "How Claude updates the app"): session evidence for balance work.
import type { SupabaseClient } from '@supabase/supabase-js'

export const REPORT_FORMAT = 'street-level-session-report/1'

type Row = Record<string, unknown>
export type SessionReport = {
  format: typeof REPORT_FORMAT
  generated_at: string
  rules_version: string | null
  campaign: { id: string; name: string; night: number; phase: string }
  /** Table state when this Night began (null if it began before snapshots, or the migration isn't applied). */
  start_of_night: Row | null
  start_of_night_at: string | null
  end_of_night: { characters: Row[]; clocks: Row[] }
  rolls: Row[]
  helper_questions: { at: string; question: string; answer: string | null }[]
  gm_notes: string
}

/** Pure part: assemble the report from rows already read. */
export function buildReport(input: {
  now: string
  campaign: SessionReport['campaign'] & { rules_version: string | null }
  snapshot: { at: string; state: Row } | null
  characters: Row[]
  clocks: Row[]
  rolls: (Row & { at: string })[]
  helper: { at: string; question: string; answer: string | null }[]
  notes: string
}): SessionReport {
  const since = input.snapshot?.at ?? ''
  const mine = <T extends { at: string }>(xs: T[]) => xs.filter((x) => x.at >= since).sort((a, b) => a.at.localeCompare(b.at))
  const { rules_version, ...campaign } = input.campaign
  return {
    format: REPORT_FORMAT,
    generated_at: input.now,
    rules_version,
    campaign,
    start_of_night: input.snapshot?.state ?? null,
    start_of_night_at: input.snapshot?.at ?? null,
    end_of_night: { characters: input.characters, clocks: input.clocks },
    rolls: mine(input.rolls),
    helper_questions: mine(input.helper),
    gm_notes: input.notes,
  }
}

/** Read everything the report needs as the GM. */
export async function sessionReport(client: SupabaseClient, campaignId: string): Promise<SessionReport> {
  const must = <T,>(r: { data: T | null; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message)
    return r.data
  }
  const campaign = must(await client.from('campaigns').select('id, name, night, phase, rules_version').eq('id', campaignId).single()) as
    SessionReport['campaign'] & { rules_version: string | null }
  const [characters, clocks, rolls, helper, secrets, snap] = await Promise.all([
    client.from('characters').select('name, harm, stress, drive, dying, home_clock, is_npc').eq('campaign_id', campaignId).then(must),
    client.from('clocks').select('name, kind, size, filled').eq('campaign_id', campaignId).then(must),
    client.from('rolls').select('*').eq('campaign_id', campaignId).then(must),
    client.from('helper_log').select('at, question, answer').eq('campaign_id', campaignId).then(must),
    client.from('gm_secrets').select('notes').eq('campaign_id', campaignId).maybeSingle().then(must),
    // Missing before the M7 migration is applied: treat any error as "no snapshot".
    client.from('night_snapshots').select('at, state').eq('campaign_id', campaignId).eq('night', campaign.night).maybeSingle(),
  ])
  return buildReport({
    now: new Date().toISOString(), campaign,
    snapshot: (snap.data as { at: string; state: Row } | null) ?? null,
    characters: (characters ?? []) as Row[], clocks: (clocks ?? []) as Row[],
    rolls: (rolls ?? []) as (Row & { at: string })[],
    helper: (helper ?? []) as { at: string; question: string; answer: string | null }[],
    notes: (secrets as { notes?: string } | null)?.notes ?? '',
  })
}
