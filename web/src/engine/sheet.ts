// Derived numbers for a character sheet. Pure functions, no network.
import {
  CORE, archetype, flair, gearItem, kitItem, power, tableToughness,
  type AttackKind, type GearEntry, type KitEntry, type PowerEffect, type PowerEntry, type ToughnessMap,
} from './rules'

export type Stats = { force: number; flow: number; focus: number; presence: number }
export type LoadoutItem = {
  kind: 'gear' | 'power' | 'kit'
  id: string
  ability_level?: number
  flaw?: string
  custom_text?: string
}
/** The parts of a `characters` row the engine reads. */
export type Sheet = {
  name?: string
  archetype_id?: string | null
  trait_id?: string | null
  stats: Stats
  flair_ids?: string[]
  loadout?: LoadoutItem[]
  harm?: number
  stress?: number
  drive?: number
  /** Slots gained through Advancement, on top of the 3 at creation. */
  extra_slots?: number
  fight_state?: Record<string, unknown>
}

export type Modifier = { source: string; value: number }
export type Defense = { base: number; total: number; mods: Modifier[] }

type Resolved =
  | { item: LoadoutItem; kind: 'gear'; entry: GearEntry }
  | { item: LoadoutItem; kind: 'kit'; entry: KitEntry }
  | { item: LoadoutItem; kind: 'power'; entry: PowerEntry }
  | { item: LoadoutItem; kind: 'unknown'; entry: undefined }

/** Look up every loadout item in the rules data. Unknown ids are kept and flagged. */
export function resolveLoadout(sheet: Sheet): Resolved[] {
  return (sheet.loadout ?? []).map((item) => {
    if (item.kind === 'gear') { const e = gearItem(item.id); if (e) return { item, kind: 'gear', entry: e } }
    if (item.kind === 'kit') { const e = kitItem(item.id); if (e) return { item, kind: 'kit', entry: e } }
    if (item.kind === 'power') { const e = power(item.id); if (e) return { item, kind: 'power', entry: e } }
    return { item, kind: 'unknown', entry: undefined }
  })
}

/** Power effects unlocked at the item's ability level (default: first ability). */
function powerEffects(entry: PowerEntry, item: LoadoutItem): PowerEffect[] {
  const level = item.ability_level ?? 1
  return (entry.effects ?? []).filter((e) => e.level <= level)
}

const label = (r: Resolved) => r.entry?.name ?? r.item.id

/** Guard, Wits and Poise: 12 + stat, plus any listed bonuses (riot shield, Danger Sense). */
export function defenses(sheet: Sheet): { guard: Defense; wits: Defense; poise: Defense } {
  const base = CORE.defense_base
  const guardMods: Modifier[] = []
  for (const r of resolveLoadout(sheet)) {
    if (r.kind === 'gear' && r.entry.guard) guardMods.push({ source: r.entry.name, value: r.entry.guard })
    if (r.kind === 'power') {
      for (const e of powerEffects(r.entry, r.item)) if (e.guard) guardMods.push({ source: r.entry.name, value: e.guard })
    }
  }
  const make = (stat: number, mods: Modifier[]): Defense => ({
    base: base + stat,
    total: base + stat + mods.reduce((s, m) => s + m.value, 0),
    mods,
  })
  return {
    guard: make(sheet.stats.flow, guardMods),
    wits: make(sheet.stats.focus, []),
    poise: make(sheet.stats.presence, []),
  }
}

export type ToughnessResult = { value: number; source: string | null; sources: Modifier[] }

/**
 * Toughness against one kind of attack. Sources don't stack: the single
 * highest applies. Only explicit "+1 Toughness" effects (Stand Your Ground,
 * Hold the line) add on top, via `plus`. Capped at 2. Hazards ignore it.
 * `active` lists toggled powers that are on (e.g. Iron Skin's armor).
 */
export function toughness(
  sheet: Sheet,
  attackKind: AttackKind,
  opts: { plus?: number; active?: string[] } = {},
): ToughnessResult {
  const t = CORE.toughness
  const sources: Modifier[] = []
  const add = (source: string, map: ToughnessMap | undefined) => {
    const v = map?.[attackKind]
    if (v) sources.push({ source, value: v })
  }
  if (attackKind !== 'hazard') {
    if (sheet.stats.force >= t.force_threshold) add(`Force +${sheet.stats.force}`, tableToughness('force'))
    for (const r of resolveLoadout(sheet)) {
      if (r.kind === 'gear') add(r.entry.name, tableToughness('gear', r.item.id) ?? r.entry.toughness)
      if (r.kind === 'kit') add(`Kit: ${r.entry.name}`, r.entry.toughness)
      if (r.kind === 'power') {
        add(r.entry.name, tableToughness('power', r.item.id))
        for (const e of powerEffects(r.entry, r.item)) add(r.entry.name, e.toughness)
        if (r.entry.toggle && opts.active?.includes(r.entry.id)) add(`${r.entry.name} (${r.entry.toggle.name})`, r.entry.toggle.toughness)
      }
    }
  }
  const best = sources.reduce<Modifier | null>((a, b) => (!a || b.value > a.value ? b : a), null)
  const plus = attackKind === 'hazard' ? 0 : (opts.plus ?? 0)
  const value = Math.min(t.max, (best?.value ?? 0) + plus)
  return { value, source: best?.source ?? null, sources }
}

/** Harm box names, top to bottom. Hard to Kill and the Toughness power add Battered after Hurt. */
export function harmBoxes(sheet: Sheet): string[] {
  const h = CORE.harm
  let extra = 0
  for (const id of sheet.flair_ids ?? []) extra += flair(id)?.sim?.boxes_bonus ?? 0
  for (const r of resolveLoadout(sheet)) {
    if (r.kind === 'power') for (const e of powerEffects(r.entry, r.item)) extra += e.boxes_bonus ?? 0
  }
  const boxes = [...h.hero_boxes]
  const at = boxes.indexOf(h.extra_box.after) + 1
  const added = Array.from({ length: extra }, (_, i) => (i === 0 ? h.extra_box.name : `${h.extra_box.name} ${i + 1}`))
  boxes.splice(at, 0, ...added)
  return boxes
}

export type SlotReport = { used: number; max: number; strange: number; warnings: string[] }

/** Slots used out of the max (3 at creation). Breaking a rule is a warning, never a block. */
export function slotsUsed(sheet: Sheet, opts: { creation?: boolean } = {}): SlotReport {
  const creation = opts.creation ?? true
  const max = CORE.slots.at_creation + (sheet.extra_slots ?? 0)
  const costs = CORE.slots.costs
  let used = 0
  let strange = 0
  const warnings: string[] = []
  for (const r of resolveLoadout(sheet)) {
    if (r.kind === 'gear') used += r.entry.slots ?? costs.gear
    else if (r.kind === 'power') {
      used += r.entry.tier === 'strange' ? costs.strange : costs.street
      if (r.entry.tier === 'strange') {
        strange++
        if (!r.item.flaw) warnings.push(`${r.entry.name} needs a flaw (Allergy, Unstable or Marked).`)
        else if (r.entry.required_flaw && !r.item.flaw.toLowerCase().startsWith(r.entry.required_flaw)) {
          warnings.push(`${r.entry.name} must take ${r.entry.required_flaw[0].toUpperCase()}${r.entry.required_flaw.slice(1)}.`)
        }
      }
    } else if (r.kind === 'unknown') {
      warnings.push(`"${r.item.id}" isn't in the rules data.`)
    }
    // Kit sits outside the slots.
  }
  if (used > max) warnings.unshift(`Uses ${used} slots; the limit is ${max}.`)
  if (creation && strange > CORE.slots.max_strange_at_creation) warnings.push('Only one strange power is allowed at creation.')
  const isSpecialist = sheet.archetype_id === 'specialist'
  const kitCount = (sheet.loadout ?? []).filter((i) => i.kind === 'kit').length
  const kitMax = kitPicks(sheet)
  if (kitCount > kitMax) warnings.push(`${kitCount} Kit items picked; the limit is ${kitMax}.`)
  if (kitCount > 0 && kitMax === 0 && !isSpecialist) warnings.push('Only Specialists (or Gadgeteers) get Kit.')
  return { used, max, strange, warnings }
}

/** How many Kit items this hero picks each Night. */
export function kitPicks(sheet: Sheet): number {
  const k = CORE.kit_picks
  const spec = sheet.archetype_id === 'specialist'
  const gadg = (sheet.loadout ?? []).some((i) => i.kind === 'power' && i.id === 'gadgeteer')
  return spec && gadg ? k.specialist_gadgeteer : spec ? k.specialist : gadg ? k.gadgeteer : 0
}

/** Steady / Fraying / Breaking for a Stress value. */
export function stressStage(stress: number) {
  const stages = CORE.stress.stages
  return stages.find((s) => stress >= s.min && stress <= s.max) ?? stages[stages.length - 1]
}

/** The hero's attack weapon: the first weapon in the loadout (or a power that grants one). */
export function weaponOf(sheet: Sheet): { id: 'unarmed' | 'light' | 'heavy' | 'pistol' | 'knife'; source: string | null } {
  for (const r of resolveLoadout(sheet)) {
    if (r.kind === 'gear' && r.entry.weapon) return { id: r.entry.weapon, source: r.entry.name }
    if (r.kind === 'power') {
      const w = powerEffects(r.entry, r.item).find((e) => e.weapon)?.weapon
      if (w) return { id: w, source: r.entry.name }
    }
  }
  return { id: 'unarmed', source: null }
}

export function hasMighty(sheet: Sheet): boolean {
  return resolveLoadout(sheet).some((r) => r.kind === 'power' && powerEffects(r.entry, r.item).some((e) => e.mighty))
}

export const archetypeName = (sheet: Sheet) => archetype(sheet.archetype_id)?.name ?? ''
export { label as loadoutLabel }
