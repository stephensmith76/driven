// Built villains: a campaign's roster of villain sheets (migration 20261113000000_villains.sql).
// A sheet's `data` has the same shape a bank entry uses for an enemy, so sheets move
// between a campaign and the bank without conversion.
import { supabase } from './supabase'
import { CORE, type Enemy, type EnemyKind, type VillainDetails } from '../engine'

export type VillainData = {
  kind: EnemyKind
  /** Named enemies: force, flow, focus, presence. Mooks: attack. */
  stats: Record<string, number>
  defenses: { guard?: number; wits?: number; poise?: number }
  toughness: number
  harm_max: number
  count_max: number
  drive: number
  line: string
  source_id?: string | null
  details?: VillainDetails | null
}

export type VillainSheet = {
  id: string; campaign_id: string; name: string; kind: EnemyKind
  data: VillainData; portrait: string | null; updated_at?: string
}

export const namedDefenses = (s: Record<string, number>) => ({
  guard: CORE.defense_base + (s.flow ?? 0), wits: CORE.defense_base + (s.focus ?? 0), poise: CORE.defense_base + (s.presence ?? 0),
})

/** A blank sheet of the given kind, with the rules' defaults. */
export function blankVillainData(kind: EnemyKind): VillainData {
  if (kind === 'mooks') {
    return {
      kind, stats: { attack: 2 }, defenses: { guard: 13, wits: 12, poise: 12 }, toughness: 0,
      harm_max: CORE.harm.mook_boxes, count_max: CORE.villain_scaling.mook_group_size, drive: 0, line: '', details: {},
    }
  }
  const stats = { force: 2, flow: 1, focus: 0, presence: 1 }
  return {
    kind, stats, defenses: namedDefenses(stats), toughness: 0,
    harm_max: kind === 'lieutenant' ? CORE.harm.lieutenant_boxes : CORE.harm.villain_boxes,
    count_max: 1, drive: CORE.drive.start_night, line: '', details: { tricks: [] },
  }
}

/** The enemy row a sheet makes when it joins a fight: fresh, off the map. */
export function enemyDraft(name: string, d: VillainData, portrait?: string | null): Omit<Enemy, 'id' | 'campaign_id'> {
  return {
    name, kind: d.kind, stats: d.stats ?? {}, defenses: d.defenses ?? {}, toughness: d.toughness ?? 0,
    harm: 0, harm_max: d.harm_max ?? 1, stress: 0, count: d.count_max ?? 1, count_max: d.count_max ?? 1,
    drive: d.drive ?? 0, zone: null, line: d.line ?? '', source_id: d.source_id ?? null,
    ...(d.details && Object.keys(d.details).length ? { details: d.details } : {}),
    ...(portrait ? { portrait } : {}),
  }
}

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n))

/** One line of numbers for a sheet, for lists. */
export function villainStatLine(kind: string, d: VillainData) {
  const def = d.defenses ?? {}
  if (kind === 'mooks') {
    return `Group of ${d.count_max} · Attack ${signed(d.stats?.attack ?? 0)} · Guard ${def.guard} · Wits ${def.wits} · Poise ${def.poise} · ${d.harm_max} Harm each`
  }
  const s = d.stats ?? {}
  return `Force ${signed(s.force ?? 0)} · Flow ${signed(s.flow ?? 0)} · Focus ${signed(s.focus ?? 0)} · Presence ${signed(s.presence ?? 0)} · `
    + `Guard ${def.guard} · Wits ${def.wits} · Poise ${def.poise} · Harm ${d.harm_max} · Toughness ${d.toughness}`
}

export async function listVillains(campaignId: string): Promise<VillainSheet[]> {
  const { data, error } = await supabase.from('villains').select('*').eq('campaign_id', campaignId).order('name')
  if (error) throw error
  return (data ?? []) as VillainSheet[]
}

/** Create or replace a sheet. The id is made by the caller so a picture can be stored before the first save. */
export async function saveVillain(sheet: Omit<VillainSheet, 'updated_at'>) {
  const { error } = await supabase.from('villains').upsert({
    id: sheet.id, campaign_id: sheet.campaign_id, name: sheet.name, kind: sheet.kind, data: sheet.data, portrait: sheet.portrait,
  })
  if (error) throw error
}

export async function deleteVillain(id: string) {
  const { error } = await supabase.from('villains').delete().eq('id', id)
  if (error) throw error
}
