// GM bookkeeping writes. Each is a shortcut for something the GM could do by
// hand (SPEC.md "GM screens"): every number stays editable on screen.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { bump, setField } from './writes'
import type { Character, Clock } from './types'
import type { ArcSheet, CaseFile } from './caseFile'
import { startNightDrive, tickClock } from '../engine'

export type GmSecrets = { id: string; campaign_id: string; case: CaseFile; arc: ArcSheet; notes: string }

/** The hidden case file. Not on Realtime (it never leaves the GM's device), so it reloads on demand. */
export function useGmSecrets(campaignId: string) {
  const [row, setRow] = useState<GmSecrets | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('gm_secrets').select('*').eq('campaign_id', campaignId).maybeSingle()
    if (error) setError(error.message)
    else setRow(data as GmSecrets | null)
  }, [campaignId])
  useEffect(() => { void load() }, [load])
  const save = useCallback(async (patch: Partial<Pick<GmSecrets, 'case' | 'arc' | 'notes'>>) => {
    if (!row) return
    const { error } = await supabase.from('gm_secrets').update(patch).eq('id', row.id)
    if (error) throw error
    setRow({ ...row, ...patch })
  }, [row])
  return { secrets: row, error, reload: load, save }
}

export const heroesOf = (characters: Character[]) => characters.filter((c) => !c.is_npc)

/**
 * Tick a clock. For the Scheme clock, `stressFor` says who takes 1 Stress per
 * tick: one hero (their roll caused it), everyone (Dawn or a missed Crack), or nobody.
 */
export async function tickClockAndStress(clock: Clock, ticks: number, stressFor: Character[]) {
  const t = tickClock(clock, ticks)
  await setField('clocks', clock.id, 'filled', t.filled)
  const real = t.filled - clock.filled
  if (real > 0) for (const h of stressFor) await bump(h.id, 'stress', real)
  return { ...t, ticked: real }
}

/** Start the next Night: Night +1, back to Patrol, and anyone below their starting Drive goes up to it. */
export async function startNight(campaignId: string, night: number, heroes: Character[]) {
  const raised: string[] = []
  for (const h of heroes) {
    const to = startNightDrive(h, h.drive)
    if (to > h.drive) {
      await bump(h.id, 'drive', to - h.drive)
      raised.push(`${h.name} ${h.drive}→${to}`)
    }
  }
  const { error } = await supabase.from('campaigns').update({ night: night + 1, phase: 'patrol' }).eq('id', campaignId)
  if (error) throw error
  await saveNightSnapshot(campaignId, night + 1)
  return raised
}

/** Copy one clue's text into the found-clues list (the only part players see). Returns the new row id. */
export async function revealClue(campaignId: string, clue: { text: string; is_arc?: boolean }, night: number,
  personalFor: string | null, foundBy: string | null) {
  const id = crypto.randomUUID()
  const { error } = await supabase.from('clues').insert({
    id, campaign_id: campaignId, text: clue.text, is_arc: Boolean(clue.is_arc), night,
    personal_for: personalFor, found_by: foundBy,
  })
  if (error) throw error
  return id
}

export async function deleteRow(table: string, id: string) {
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw error
}

/** Remember how the table stood when a Night began, for the session report. Never blocks Start Night. */
export async function saveNightSnapshot(campaignId: string, night: number) {
  try {
    const [{ data: characters }, { data: clocks }] = await Promise.all([
      supabase.from('characters').select('name, harm, stress, drive, dying, home_clock').eq('campaign_id', campaignId).eq('is_npc', false),
      supabase.from('clocks').select('name, kind, size, filled').eq('campaign_id', campaignId),
    ])
    await supabase.from('night_snapshots').upsert(
      { campaign_id: campaignId, night, at: new Date().toISOString(), state: { characters, clocks } },
      { onConflict: 'campaign_id,night' })
  } catch (e) { console.warn('Could not save the Night snapshot', e) }
}
