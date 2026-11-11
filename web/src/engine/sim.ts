// Character sheet -> the simulator's Hero record (SPEC.md "Encounter simulator").
import { archetype, flair, trait, type SimFields } from './rules'
import { resolveLoadout, type Sheet } from './sheet'
import { CORE } from './rules'

export type SimHero = {
  key: string; name: string; arch: string; trait: string
  force: number; flow: number; focus: number; presence: number
  boxes: number
  weapon: string
  armor_guns: number; armor_all: number; tough_blunt: number
  /** Only present when true (powered armor). */
  armor_flaky?: boolean
  guard_bonus: number; medkit: number
  flairs: string[]
  power: string; strange: boolean
  kit: string[]
  harm: number; stress: number; drive: number
  not_simulated: string[]
}

export function simHero(sheet: Sheet, key?: string): SimHero {
  const name = sheet.name ?? 'Hero'
  const h: SimHero = {
    key: key ?? name.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    name,
    arch: archetype(sheet.archetype_id)?.name ?? '',
    trait: trait(sheet.trait_id)?.name ?? '',
    ...sheet.stats,
    boxes: CORE.harm.hero_boxes.length,
    weapon: 'unarmed',
    armor_guns: 0, armor_all: 0, tough_blunt: 0,
    guard_bonus: 0, medkit: 0,
    flairs: [],
    power: '', strange: false,
    kit: [],
    harm: sheet.harm ?? 0, stress: sheet.stress ?? 0, drive: sheet.drive ?? CORE.drive.start_night,
    not_simulated: [],
  }

  const apply = (label: string, sim: SimFields) => {
    if (sim === null) { h.not_simulated.push(`${name}: ${label}`); return }
    if (sim.weapon && h.weapon === 'unarmed') h.weapon = sim.weapon
    if (sim.armor_guns) h.armor_guns = Math.max(h.armor_guns, sim.armor_guns)
    if (sim.armor_all) h.armor_all = Math.max(h.armor_all, sim.armor_all)
    if (sim.armor_flaky) h.armor_flaky = true
    if (sim.tough_blunt) h.tough_blunt = Math.max(h.tough_blunt, sim.tough_blunt)
    if (sim.guard_bonus) h.guard_bonus += sim.guard_bonus
    if (sim.boxes_bonus) h.boxes += sim.boxes_bonus
    if (sim.medkit) h.medkit += sim.medkit
    if (sim.power && !h.power) h.power = sim.power
    if (sim.strange) h.strange = true
    if (sim.flair) h.flairs.push(sim.flair)
    if (sim.kit) h.kit.push(sim.kit)
  }

  for (const id of sheet.flair_ids ?? []) {
    const f = flair(id)
    if (f) apply(f.name, f.sim)
    else h.not_simulated.push(`${name}: ${id}`)
  }
  for (const r of resolveLoadout(sheet)) {
    if (r.kind === 'unknown') { h.not_simulated.push(`${name}: ${r.item.id}`); continue }
    // Only a power's first ability is modeled; unlocked extras go on the list.
    apply(r.entry.name, r.entry.sim)
    if (r.kind === 'power' && r.entry.sim !== null && (r.item.ability_level ?? 1) > 1) {
      h.not_simulated.push(`${name}: ${r.entry.name} (abilities past the first)`)
    }
  }
  return h
}
