// Fight bookkeeping (SPEC.md "GM screens: Fight"): enemies, what players may see of
// them, applying Harm, the End fight shortcut, and the villain-turn and gang-size reminders.
import { CORE, VILLAINS } from './rules'
import { harmBoxes, type Sheet } from './sheet'

export type EnemyKind = 'mooks' | 'lieutenant' | 'villain'

/** A row of the GM-only `enemies` table. */
export type Enemy = {
  id: string
  campaign_id: string
  name: string
  kind: EnemyKind
  stats: Record<string, number>
  defenses: { guard?: number; wits?: number; poise?: number }
  toughness: number
  harm: number
  harm_max: number
  stress: number
  count: number
  count_max: number
  drive: number
  zone: string | null
  line: string
  source_id: string | null
}

export type EnemyState = 'fresh' | 'hurt' | 'badly hurt' | 'down'

/** A rough state for players: never a number. */
export function enemyState(e: Pick<Enemy, 'kind' | 'harm' | 'harm_max' | 'count' | 'count_max'>): EnemyState {
  if (e.kind === 'mooks') {
    if (e.count <= 0) return 'down'
    if (e.count >= e.count_max) return 'fresh'
    return e.count * 2 > e.count_max ? 'hurt' : 'badly hurt'
  }
  if (e.harm >= e.harm_max) return 'down'
  if (e.harm <= 0) return 'fresh'
  return e.harm * 2 < e.harm_max ? 'hurt' : 'badly hurt'
}

/** What `scene.public_enemies` holds for one enemy: name, zone, mooks standing, a rough state. */
export type PublicEnemy = { id: string; name: string; zone: string | null; standing: number | null; state: EnemyState }

export const publicEnemy = (e: Enemy): PublicEnemy => ({
  id: e.id, name: e.name, zone: e.zone,
  standing: e.kind === 'mooks' ? Math.max(0, e.count) : null,
  state: enemyState(e),
})

// ----------------------------------------------------------------- reminders

/** Turns a named villain gets each round (rules.md: one per two heroes rounded up; alone, one per hero). */
export function villainTurns(heroes: number, alone: boolean): number {
  if (heroes <= 0) return 0
  return alone ? heroes : Math.ceil(heroes / CORE.villain_scaling.turns_per_heroes)
}

/**
 * Turns each named enemy gets this round (rules.md "Lieutenants and several named enemies"):
 * a lieutenant gets one; a villain the usual count, one per hero only if it is the
 * only enemy in the fight.
 */
export function namedTurns(enemies: Pick<Enemy, 'kind' | 'name'>[], heroes: number): { name: string; kind: EnemyKind; turns: number }[] {
  const named = enemies.filter((e) => e.kind !== 'mooks')
  const alone = named.length === 1 && enemies.length === 1
  return named.map((e) => ({
    name: e.name, kind: e.kind,
    turns: heroes <= 0 ? 0 : e.kind === 'lieutenant' ? CORE.villain_scaling.lieutenant_turns : villainTurns(heroes, alone),
  }))
}

/** How many mook groups of 3 to start with (rules.md "Villain scaling"). */
export function gangGroups(heroes: number, hasNamedVillain: boolean): number {
  if (heroes <= 0) return 0
  return hasNamedVillain ? Math.max(1, Math.floor(heroes / 2)) : heroes
}

// ----------------------------------------------------------------- applying hits

/** Mooks dropped by a hit: any hit drops one, a real Impact 3 drops a second. */
export const mooksDropped = (impact: number) => (impact <= 0 ? 0 : impact >= 3 ? 2 : 1)

/** The change a hit makes to an enemy row. Named enemies take Harm; mook groups lose bodies. */
export function enemyHit(e: Pick<Enemy, 'kind' | 'harm' | 'harm_max' | 'count'>, impact: number, harm: number):
  { patch: Partial<Pick<Enemy, 'harm' | 'count'>>; note: string } {
  if (impact <= 0) return { patch: {}, note: 'A miss does nothing.' }
  if (e.kind === 'mooks' && e.harm_max > 1) {
    // Bruisers: every `harm_max` Harm drops one, and leftover Harm carries to the next (rules.md, Mooks).
    const total = e.harm + harm
    const drop = Math.min(e.count, Math.floor(total / e.harm_max))
    const left = e.count - drop
    const carry = left > 0 ? total - drop * e.harm_max : 0
    return { patch: { count: left, harm: carry },
      note: `${harm} Harm: ${drop} down, ${left} standing${carry > 0 ? ', the next one is staggered' : ''}.` }
  }
  if (e.kind === 'mooks') {
    const drop = Math.min(e.count, mooksDropped(impact))
    return { patch: { count: e.count - drop }, note: `${drop} mook${drop === 1 ? '' : 's'} down, ${e.count - drop} standing.` }
  }
  const to = Math.min(e.harm_max, e.harm + harm)
  return { patch: { harm: to }, note: `${to - e.harm} Harm (${to} of ${e.harm_max})${to >= e.harm_max ? ': out of the fight' : ''}.` }
}

/**
 * Harm on a hero. A single hit stops at Down however big it is; only a later hit
 * on someone already Down makes them Dying (rules.md "Past Down").
 */
export function heroHit(h: Sheet & { harm: number; dying?: boolean }, harm: number):
  { harmDelta: number; dying: boolean; notes: string[] } {
  const boxes = harmBoxes(h)
  const notes: string[] = []
  if (harm <= 0) return { harmDelta: 0, dying: Boolean(h.dying), notes }
  if (h.harm >= boxes.length) {
    notes.push(`${h.name ?? 'The hero'} was already Down: now Dying. Dies at the end of the scene unless an ally stabilizes them. Say so out loud first.`)
    return { harmDelta: 0, dying: true, notes }
  }
  const to = Math.min(boxes.length, h.harm + harm)
  if (to >= boxes.length) {
    notes.push(`${h.name ?? 'The hero'} goes Down: 2 Stress for them, and 1 Stress for each ally who sees it (first time this fight).`)
  }
  return { harmDelta: to - h.harm, dying: Boolean(h.dying), notes }
}

/** End fight: a hero who is Down but not Dying stands back up at Wounded. Null if nothing changes. */
export function standDown(h: Sheet & { harm: number; dying?: boolean }): number | null {
  const boxes = harmBoxes(h)
  if (h.dying || h.harm < boxes.length) return null
  return boxes.indexOf('Wounded') + 1
}

// ----------------------------------------------------------------- new enemies

type LibraryVillain = (typeof VILLAINS.villains)[number]
type LibraryMooks = (typeof VILLAINS.mooks)[number]

export const libraryEntries = () => [...VILLAINS.villains, ...VILLAINS.mooks]

type Draft = Omit<Enemy, 'id' | 'campaign_id'>

export function enemyFromLibrary(entry: LibraryVillain | LibraryMooks): Draft {
  if (entry.kind === 'mooks') {
    const m = entry as LibraryMooks
    return {
      name: m.name, kind: 'mooks', stats: { attack: m.attack },
      defenses: { guard: m.guard, wits: m.wits, poise: m.poise },
      toughness: 0, harm: 0, harm_max: m.harm_each ?? CORE.harm.mook_boxes, stress: 0,
      count: m.group_size, count_max: m.group_size, drive: 0, zone: null,
      line: m.gunner ? 'Gunner in the group' : '', source_id: m.id,
    }
  }
  const v = entry as LibraryVillain
  return {
    name: v.name, kind: v.kind as EnemyKind, stats: { ...v.stats },
    defenses: { guard: 12 + v.stats.flow, wits: 12 + v.stats.focus, poise: 12 + v.stats.presence },
    toughness: v.toughness, harm: 0, harm_max: v.harm_max, stress: 0,
    count: 1, count_max: 1, drive: v.drive, zone: null, line: v.line, source_id: v.id,
  }
}

export type CustomEnemy = {
  name: string; kind: EnemyKind
  stats?: { force: number; flow: number; focus: number; presence: number }
  attack?: number; guard?: number; count?: number
  toughness?: number; harm_max?: number
}

export function customEnemy(c: CustomEnemy): Draft {
  if (c.kind === 'mooks') {
    const n = Math.max(1, c.count ?? CORE.villain_scaling.mook_group_size)
    return {
      name: c.name || 'Mooks', kind: 'mooks', stats: { attack: c.attack ?? 2 },
      defenses: { guard: c.guard ?? 13, wits: 12, poise: 12 }, toughness: 0,
      harm: 0, harm_max: CORE.harm.mook_boxes, stress: 0, count: n, count_max: n, drive: 0, zone: null, line: '', source_id: null,
    }
  }
  const s = c.stats ?? { force: 0, flow: 0, focus: 0, presence: 0 }
  return {
    name: c.name || (c.kind === 'lieutenant' ? 'Lieutenant' : 'Villain'), kind: c.kind, stats: { ...s },
    defenses: { guard: 12 + s.flow, wits: 12 + s.focus, poise: 12 + s.presence },
    toughness: c.toughness ?? 0,
    harm: 0, harm_max: c.harm_max ?? (c.kind === 'lieutenant' ? CORE.harm.lieutenant_boxes : CORE.harm.villain_boxes),
    stress: 0, count: 1, count_max: 1, drive: CORE.drive.start_night, zone: null, line: '', source_id: null,
  }
}

/** A named enemy's Stress track: a lieutenant has 4 boxes (Fraying 2), a case villain 6 (Fraying 3). */
export function villainStress(kind: string): { max: number; fraying: number; breaking: number } {
  const s = CORE.stress
  return kind === 'lieutenant'
    ? { max: s.villain_boxes, fraying: s.villain_fraying_at, breaking: s.villain_breaking_at }
    : { max: s.case_villain_boxes, fraying: s.case_villain_fraying_at, breaking: s.case_villain_breaking_at }
}
