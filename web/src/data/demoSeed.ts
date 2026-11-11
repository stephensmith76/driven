// The demo campaign: Stephen's seed file (supabase/seed/butcher_case.json, format
// "street-level-seed/1") converted into the app's shapes. The seed file stays the one
// source; this module only translates it (case format: supabase/seed/CASE_FORMAT.md).
import seed from '../../../supabase/seed/butcher_case.json'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { setUpScene } from './fight'
import { CORE, TAGS, type Enemy } from '../engine'
import type { ArcSheet, CaseFile, CaseScene } from './caseFile'
import type { Character, Clock, Zone } from './types'

type Seed = typeof seed
type SeedZone = Seed['scenes']['opening']['zones'][number]
type SeedEnemy = Seed['enemies'][number] & Partial<{ stats: Record<string, number>; attack: number; gunner: boolean; toughness: number; harm_max: number; drive: number }>
export type EnemyDraft = Omit<Enemy, 'id' | 'campaign_id'>

/** Seed enemy ids -> villain library entries (rules/data/villains.json). */
const LIBRARY_IDS: Record<string, string> = { butcher: 'the-butcher', saints1: 'fifth-street-saints' }

const heroName = (id: string) => seed.characters.find((c) => c.id === id)?.name ?? id

/** "Hazard: smoke" -> tag "hazard" plus the detail; "High Ground" -> "high-ground". */
function zoneFrom(z: SeedZone): Zone {
  const tags: string[] = []
  const details: string[] = []
  for (const raw of z.tags) {
    const [head, detail] = raw.split(':').map((s) => s.trim())
    const tag = TAGS.tags.find((t) => t.name.toLowerCase() === head.toLowerCase())
    tags.push(tag?.id ?? raw)
    if (detail) details.push(detail)
  }
  return { id: z.id, name: details.length ? `${z.name} (${details.join(', ')})` : z.name, tags, links: z.links }
}

export function enemyDraft(e: SeedEnemy): EnemyDraft {
  const source_id = LIBRARY_IDS[e.id] ?? null
  if (e.kind === 'mooks') {
    return {
      name: e.name, kind: 'mooks', stats: { attack: e.attack ?? 2 }, defenses: e.defenses, toughness: 0,
      harm: 0, harm_max: CORE.harm.mook_boxes, stress: 0, count: e.count ?? 3, count_max: e.count_max ?? 3, drive: 0,
      zone: e.zone ?? null, line: e.line ?? '', source_id,
    }
  }
  return {
    name: e.name, kind: e.kind === 'lieutenant' ? 'lieutenant' : 'villain', stats: { ...(e.stats ?? {}) }, defenses: e.defenses,
    toughness: e.toughness ?? 0, harm: 0, harm_max: e.harm_max ?? CORE.harm.villain_boxes, stress: 0, count: 1, count_max: 1,
    drive: e.drive ?? CORE.drive.start_night, zone: e.zone ?? null, line: e.line ?? '', source_id,
  }
}

function scenes(): CaseScene[] {
  const confrontationEnemies = seed.enemies.map((e) => enemyDraft(e as SeedEnemy))
  // The seed's enemies are the Cannery's (they stand in its zones). The opening's
  // "three Saints loading the van out back" is one Saints group in the Back Alley.
  const saints = seed.enemies.find((e) => e.kind === 'mooks') as SeedEnemy
  const openingEnemies = [{ ...enemyDraft(saints), zone: 'alley' }]
  return (['opening', 'confrontation'] as const).map((key) => {
    const s = seed.scenes[key]
    return {
      id: key, title: s.title, text: s.text, zones: s.zones.map(zoneFrom),
      obstacles: s.obstacles.map((o) => ({ name: o.name, rating: o.rating })),
      extras: s.extras,
      enemies: key === 'opening' ? openingEnemies : confrontationEnemies,
    }
  })
}

export function demoCase(): CaseFile {
  const c = seed.case
  const who = c.facets.who.replace(/^FIXED:\s*/i, '')
  return {
    title: c.title,
    mode: /fixed/i.test(c.mode) ? 'fixed' : 'floating',
    complexity: c.complexity,
    culprit: who.split('.')[0],
    facets: { who, what: c.facets.what_leaning, where: c.facets.where_leaning },
    cast: c.cast.map((p) => ({ name: p.name, who: p.role, motive: p.motive, hides: p.hides })),
    leads: c.leads.map((l) => ({ name: l.name, rating: l.rating, approach: l.stats })),
    clues: [
      ...c.clues.map((text, i) => ({ id: `k${i + 1}`, text })),
      ...Object.entries(c.personal).map(([hero, text]) => ({ id: `p-${hero}`, text, personal_for: heroName(hero) })),
      ...c.arc_clues.map((text, i) => ({ id: `a${i + 1}`, text, is_arc: true })),
    ],
    scheme_steps: c.scheme.map((s) => s.replace(/^\d+:\s*/, '')),
    opening: c.opening,
    hostage: c.hostage,
    confrontation: c.confrontation,
    scenes: scenes(),
  }
}

export function demoArc(): ArcSheet {
  const card = seed.case.arc_clues.find((t) => /calling card/i.test(t))
  return {
    // The third arc clue and villains.json both point to Voss.
    mastermind: 'Augustine Voss',
    endgame: '',
    tools: [
      { name: 'Delia Marsh', knows: "reports to 'A.V.'" },
      { name: 'The Butcher (Vic Saldana)', knows: "only Marsh; he has never met her boss" },
    ],
    calling_card: card ? card.replace(/\s*\(calling card\)\s*$/i, '') : '',
    arc_clues: [],
  }
}

/** GM notes: the Butcher's table details that don't fit an enemy row. */
export function demoNotes(): string {
  return seed.enemies
    .filter((e) => e.kind !== 'mooks')
    .map((e) => {
      const v = e as SeedEnemy & { trait?: string; trick?: string; weakness?: string; answer_toughness?: string }
      return [`${v.name}`, v.trait && `Trait: ${v.trait}`, v.trick && `Trick: ${v.trick}`,
        v.weakness && `Weakness: ${v.weakness}`, v.answer_toughness && `Answer to Toughness: ${v.answer_toughness}`]
        .filter(Boolean).join('\n')
    })
    .join('\n\n')
}

/** Goal clocks from the seed. Scheme and Heat come with every new campaign. */
export const demoClocks = (): Pick<Clock, 'name' | 'kind' | 'size' | 'filled' | 'visible_to_players' | 'sort'>[] =>
  seed.clocks.filter((k) => k.kind !== 'scheme' && k.kind !== 'heat').map((k) => ({ ...k, kind: k.kind as Clock['kind'] }))

type HeroRow = Omit<Character, 'id' | 'campaign_id' | 'extra_slots'>
export const demoHeroes = (): HeroRow[] =>
  seed.characters.map(({ id: _id, harm_boxes: _boxes, loadout, ...h }) => ({
    ...h,
    loadout: loadout.map(({ tier: _tier, ...item }) => item) as HeroRow['loadout'],
  }))

export const demoSettings = () => ({
  players_can_build: seed.campaign.settings.players_can_build,
  players_see_sheets: seed.campaign.settings.players_see_other_sheets,
})

export const DEMO_NAME = seed.campaign.name

/** Goal clocks from the seed that the campaign doesn't have yet (matched by name). */
export async function addDemoClocks(campaignId: string, existing: { name: string }[], db: SupabaseClient = supabase) {
  const have = new Set(existing.map((c) => c.name.toLowerCase()))
  const add = demoClocks().filter((k) => !have.has(k.name.toLowerCase()))
  if (!add.length) return
  const { error } = await db.from('clocks').insert(add.map((k) => ({ ...k, campaign_id: campaignId })))
  if (error) throw error
}

/** A new demo campaign: the five heroes, the case and arc, goal clocks, settings, and the opening scene. */
export async function seedDemoCampaign(campaignId: string, db: SupabaseClient = supabase) {
  const c = demoCase()
  const { error: e1 } = await db.from('characters').insert(demoHeroes().map((h) => ({ ...h, campaign_id: campaignId })))
  if (e1) throw e1
  const { error: e2 } = await db.from('gm_secrets').update({ case: c, arc: demoArc(), notes: demoNotes() }).eq('campaign_id', campaignId)
  if (e2) throw e2
  const { error: e3 } = await db.from('campaigns').update({ settings: demoSettings() }).eq('id', campaignId)
  if (e3) throw e3
  await addDemoClocks(campaignId, [{ name: 'Scheme' }, { name: 'Heat' }], db)
  await setUpScene(campaignId, c.scenes![0], db)
}
