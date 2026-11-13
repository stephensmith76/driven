// GM writes for the Fight screen. Enemies are GM-only; after every change to one,
// the page rewrites scene.public_enemies with the safe summary (SPEC.md "Notes for the build").
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { bump, setField } from './writes'
import type { Character, Scene } from './types'
import type { CaseScene } from './caseFile'
import { enemyHit, heroHit, publicEnemy, standDown, type Enemy } from '../engine'
import { findEnemyPortrait } from './portraits'

/** Read every enemy and write the player-safe summary into the scene. */
export async function syncPublicEnemies(campaignId: string, db: SupabaseClient = supabase) {
  const { data, error } = await db.from('enemies').select('*').eq('campaign_id', campaignId)
  if (error) throw error
  const summary = ((data ?? []) as Enemy[]).map(publicEnemy)
  const { error: e2 } = await db.from('scene').update({ public_enemies: summary }).eq('campaign_id', campaignId)
  if (e2) throw e2
}

export async function setEnemyField(campaignId: string, id: string, field: string, value: unknown) {
  await setField('enemies', id, field, value)
  await syncPublicEnemies(campaignId)
}

export async function addEnemy(campaignId: string, draft: Omit<Enemy, 'id' | 'campaign_id'>) {
  // An enemy of the same name that already has a picture in this campaign keeps it.
  const portrait = draft.portrait ?? await findEnemyPortrait(campaignId, draft.name)
  const row = { campaign_id: campaignId, ...draft, ...(portrait ? { portrait } : {}) }
  let { error } = await supabase.from('enemies').insert(row)
  if (error && row.details && /details/i.test(error.message)) {
    // The database has no `details` column yet (the villains migration isn't applied): add the stat block alone.
    const { details: _details, ...plain } = row
    void _details
    ;({ error } = await supabase.from('enemies').insert(plain))
  }
  if (error) throw error
  await syncPublicEnemies(campaignId)
}

export async function removeEnemy(campaignId: string, id: string) {
  const { error } = await supabase.from('enemies').delete().eq('id', id)
  if (error) throw error
  await syncPublicEnemies(campaignId)
}

/** Apply a hit to an enemy: Harm for a named enemy, bodies for a mook group. Returns a line for the toast. */
export async function hitEnemy(campaignId: string, e: Enemy, impact: number, harm: number) {
  const { patch, note } = enemyHit(e, impact, harm)
  for (const [k, v] of Object.entries(patch)) await setField('enemies', e.id, k, v)
  await syncPublicEnemies(campaignId)
  return `${e.name}: ${note}`
}

/** Apply Harm to a hero (stops at Down; a later hit makes them Dying). Returns lines for the toast. */
export async function hitHero(h: Character, harm: number) {
  const r = heroHit(h, harm)
  if (r.harmDelta) await bump(h.id, 'harm', r.harmDelta)
  if (r.dying && !h.dying) await setField('characters', h.id, 'dying', true)
  return [`${h.name}: ${harm > 0 ? `${r.harmDelta} Harm` : 'no Harm'}.`, ...r.notes]
}

export async function setScene(sceneId: string, field: keyof Scene, value: unknown) {
  await setField('scene', sceneId, field, value)
}

/** End fight: Down heroes who aren't Dying stand up at Wounded, and per-fight flags clear. */
export async function endFight(heroes: Character[]) {
  const stood: string[] = []
  for (const h of heroes) {
    const to = standDown(h)
    if (to != null) {
      await bump(h.id, 'harm', to - h.harm)
      stood.push(h.name)
    }
    const { error } = await supabase.rpc('new_fight', { p_character_id: h.id })
    if (error) throw error
  }
  return stood
}

/**
 * Set up a prepared scene on the Fight screen: title, text and zones replace the
 * current scene, heroes come off the map, and the scene's enemies replace the current ones.
 */
export async function setUpScene(campaignId: string, s: CaseScene, db: SupabaseClient = supabase) {
  const { error } = await db.from('scene')
    .update({ title: s.title, text: s.text, zones: s.zones, positions: {}, round: 1 })
    .eq('campaign_id', campaignId)
  if (error) throw error
  const { error: e2 } = await db.from('enemies').delete().eq('campaign_id', campaignId)
  if (e2) throw e2
  if (s.enemies?.length) {
    const { error: e3 } = await db.from('enemies').insert(s.enemies.map((e) => ({ ...e, campaign_id: campaignId })))
    if (e3) throw e3
  }
  await syncPublicEnemies(campaignId, db)
}
