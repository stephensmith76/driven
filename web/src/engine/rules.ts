// The one source of rules data (SPEC.md principle 2): every number the app
// shows comes from rules/data/*.json. Nothing here may hardcode a rule value.
import core from '../../../rules/data/core.json'
import archetypes from '../../../rules/data/archetypes.json'
import traits from '../../../rules/data/traits.json'
import flairs from '../../../rules/data/flairs.json'
import gear from '../../../rules/data/gear.json'
import kit from '../../../rules/data/kit.json'
import powersFile from '../../../rules/data/powers.json'
import villainsFile from '../../../rules/data/villains.json'
import tagsFile from '../../../rules/data/tags.json'

export type AttackKind = 'blunt' | 'blade' | 'gun' | 'hazard'
export type WeaponId = 'unarmed' | 'light' | 'heavy' | 'pistol' | 'knife'
export type ToughnessMap = Partial<Record<AttackKind, number>>

/** What the simulator knows about an entry. null = can't model it; {} = nothing to model. */
export type SimFields = {
  weapon?: WeaponId
  armor_guns?: number
  armor_all?: number
  tough_blunt?: number
  guard_bonus?: number
  boxes_bonus?: number
  medkit?: number
  power?: string
  strange?: boolean
  flair?: string
  kit?: string
} | null

export type GearEntry = {
  id: string; name: string; slots: number; text: string
  group?: string; trial?: boolean
  weapon?: WeaponId; toughness?: ToughnessMap; guard?: number; uses_per_fight?: number
  sim: SimFields
}
export type KitEntry = { id: string; name: string; text: string; toughness?: ToughnessMap; sim: SimFields }
export type PowerEffect = {
  level: number; toughness?: ToughnessMap; guard?: number; boxes_bonus?: number
  weapon?: WeaponId; mighty?: boolean
}
export type PowerEntry = {
  id: string; name: string; tier: 'street' | 'strange'; slots: number; note?: string
  abilities: { name: string; text: string }[]
  always_on?: boolean; required_flaw?: string
  /** false: no first-use Stress (Invulnerability, Levitation have their own cost). */
  first_use_stress?: boolean
  effects?: PowerEffect[]
  toggle?: { name: string; toughness?: ToughnessMap; weapon?: WeaponId }
  counter?: { name: string; min: number; max: number }
  extra?: string
  sim: SimFields
}
export type FlairEntry = {
  id: string; name: string; text: string; trial?: boolean
  start_drive?: number; stress_floor?: number
  sim: SimFields
}
export type ArchetypeEntry = (typeof archetypes)[number]
export type TraitEntry = (typeof traits)[number]

export const CORE = core
export const RULES_VERSION: string = core.rules_version
export const ARCHETYPES: ArchetypeEntry[] = archetypes
export const TRAITS: TraitEntry[] = traits
export const FLAIRS = flairs as FlairEntry[]
export const GEAR = gear as GearEntry[]
export const KIT = kit as KitEntry[]
export const POWERS = powersFile.powers as PowerEntry[]
export const POWER_RULES = powersFile.rules
export const POWER_FLAWS = powersFile.flaws
export const VILLAINS = villainsFile
export const TAGS = tagsFile

const index = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))
const byId = {
  archetype: index(ARCHETYPES),
  trait: index(TRAITS),
  flair: index(FLAIRS),
  gear: index(GEAR),
  kit: index(KIT),
  power: index(POWERS),
}

export const archetype = (id: string | null | undefined) => (id ? byId.archetype.get(id) : undefined)
export const trait = (id: string | null | undefined) => (id ? byId.trait.get(id) : undefined)
export const flair = (id: string) => byId.flair.get(id)
export const gearItem = (id: string) => byId.gear.get(id)
export const kitItem = (id: string) => byId.kit.get(id)
export const power = (id: string) => byId.power.get(id)
