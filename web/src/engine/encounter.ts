// Encounter lab (SPEC.md "Encounter simulator"): the config run_encounter takes,
// the result it returns, and the mapping from campaign data to that config.
import { CORE, VILLAINS } from './rules'
import { simHero, type SimHero } from './sim'
import type { Sheet } from './sheet'
import type { Enemy } from './fight'

/** villain: the usual villain turns (one per two heroes; one per hero if alone). lieutenant: one turn a round. */
export type VillainRole = 'villain' | 'lieutenant'
export type SimVillain = {
  name: string; force: number; flow: number; focus: number; presence: number
  harm_max: number; toughness_v: number; drive: number; weapon: string
  role: VillainRole
}
export type SimMooks = { name: string; count: number; attack: number; guard: number; gunner: boolean }

export type SimConfig = {
  runs: number; seed?: number | null
  heroes: SimHero[]
  villains: SimVillain[]
  mook_groups: SimMooks[]
  rules?: Record<string, unknown>
}

export type SimHeroResult = {
  down_pct: number; harm: number; hit_pct: number; stress: number
  fraying_pct: number; break_pct: number; sigs: number; drive_earned: number; drive_spent: number
}
export type SimResult = {
  win_pct: number; rounds: number; any_down_pct: number; dying_pct: number
  heroes: Record<string, SimHeroResult>
  not_simulated: string[]
  runs: number; seed: number | null; sim_version: string
}

/** What the Encounter lab saves: the choices, not the built config, so a rerun uses today's sheets. */
export type EncounterForm = {
  party: string[]                 // character ids
  mode: 'fresh' | 'now'
  villains: SimVillain[]
  mook_groups: SimMooks[]
  dark: boolean
  runs: number
}

export const DEFAULT_RUNS = 1000

/** A saved form from before several villains were allowed had one `villain`; read it as a list. */
export function normalizeForm(saved: Partial<EncounterForm> & { villain?: Omit<SimVillain, 'role'> & { role?: VillainRole } | null }, base: EncounterForm): EncounterForm {
  const { villain, ...rest } = saved
  const villains = rest.villains ?? (villain ? [{ ...villain, role: villain.role ?? 'villain' }] : [])
  return { ...base, ...rest, villains }
}

type Character = Sheet & { id: string; harm: number; stress: number; drive: number }

/** Unique simulator keys: the hero's name key, with a number on a repeat. */
function uniqueKeys(heroes: SimHero[]) {
  const seen = new Map<string, number>()
  for (const h of heroes) {
    const n = (seen.get(h.key) ?? 0) + 1
    seen.set(h.key, n)
    if (n > 1) h.key = `${h.key}_${n}`
  }
}

export function encounterConfig(form: EncounterForm, characters: Character[], seed?: number | null): SimConfig {
  const heroes = form.party
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c))
    .map((c) => {
      const h = simHero(c)
      if (form.mode === 'fresh') { h.harm = 0; h.stress = 0; h.drive = CORE.drive.start_night }
      return h
    })
  uniqueKeys(heroes)
  return {
    runs: form.runs, seed: seed ?? null,
    heroes,
    villains: form.villains,
    mook_groups: form.mook_groups,
    rules: { dark: form.dark },
  }
}

// ----------------------------------------------------------------- enemies

type LibVillain = (typeof VILLAINS.villains)[number]

/** Library villains and lieutenants as simulator records. */
export const libraryVillains = (): { id: string; name: string; sim: SimVillain }[] =>
  (VILLAINS.villains as LibVillain[]).map((v) => ({
    id: v.id, name: v.name,
    sim: { ...(v.sim as Omit<SimVillain, 'role'>), role: v.kind === 'lieutenant' ? 'lieutenant' as const : 'villain' as const },
  }))

export const libraryMooks = (): { id: string; name: string; sim: SimMooks }[] =>
  VILLAINS.mooks.map((m) => ({ id: m.id, name: m.name, sim: { ...(m.sim as SimMooks) } }))

/** A named enemy row from the Fight screen as a simulator villain. Weapon comes from its library entry. */
export function villainFromEnemy(e: Enemy): SimVillain {
  const lib = libraryVillains().find((v) => v.id === e.source_id)
  const s = e.stats
  return {
    name: e.name, force: s.force ?? 0, flow: s.flow ?? 0, focus: s.focus ?? 0, presence: s.presence ?? 0,
    harm_max: e.harm_max, toughness_v: e.toughness, drive: e.drive, weapon: lib?.sim.weapon ?? 'unarmed',
    role: e.kind === 'lieutenant' ? 'lieutenant' : 'villain',
  }
}

/** A mook-group row as a simulator group. `now` uses who is still standing; otherwise the full group. */
export function mooksFromEnemy(e: Enemy, now = false): SimMooks {
  const lib = libraryMooks().find((m) => m.id === e.source_id)
  return {
    name: e.name, count: now ? Math.max(0, e.count) : e.count_max, attack: e.stats.attack ?? 2,
    guard: e.defenses.guard ?? 13, gunner: lib ? lib.sim.gunner : /gunner/i.test(e.line),
  }
}

export function blankVillain(): SimVillain {
  return { name: 'Villain', force: 0, flow: 0, focus: 0, presence: 0,
    harm_max: CORE.harm.villain_boxes, toughness_v: 0, drive: CORE.drive.start_night, weapon: 'unarmed', role: 'villain' }
}

// ----------------------------------------------------------------- reading the result

/** Starting bands from SPEC.md, to be adjusted after real sessions. */
export const DIFFICULTY = [
  { min: 97, label: 'Walkover' },
  { min: 85, label: 'Fair' },
  { min: 65, label: 'Hard' },
  { min: -Infinity, label: 'Deadly' },
] as const

export const difficulty = (winPct: number) => DIFFICULTY.find((d) => winPct >= d.min)!.label

export const DOWN_FLAG_AT = 50
export const probablyDown = (r: Pick<SimResult, 'any_down_pct'>) => r.any_down_pct >= DOWN_FLAG_AT

export const SIM_CAVEAT = 'The simulator plays simple tactics and ignores zones and goals. A real table usually does better.'

export const SIM_LIMITS = [
  'Several named enemies work, but hero tactics focus the first one standing.',
  'No zones or goal clocks.',
  'Fixed tactics.',
  'Powered armor cuts out on a Miss and is back on at the wearer’s next turn; the Quick Action that costs is not counted.',
  'Five powers modeled: Resilience, Shadow Manipulation, Mighty, Invulnerability, Healing Factor.',
  'Four tools modeled for Specialists: Taser, Flashbang, Smoke grenades, and armor (a Kevlar vest on the belt).',
]
