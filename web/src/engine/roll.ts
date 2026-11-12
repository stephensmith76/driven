// Roll and Harm math. Pure functions; the dice come in as numbers so typed
// (real) dice and app dice go through exactly the same code.
import { CORE, type WeaponId } from './rules'

export type Adv = -1 | 0 | 1

/** Advantage and Disadvantage cancel and never stack. */
export function netAdv(...flags: number[]): Adv {
  const a = flags.some((f) => f > 0)
  const d = flags.some((f) => f < 0)
  return a === d ? 0 : a ? 1 : -1
}

export function impactFor(margin: number): number {
  for (const b of CORE.impact_bands) {
    const lo = b.min_margin ?? -Infinity
    const hi = b.max_margin ?? Infinity
    if (margin >= lo && margin <= hi) return b.impact
  }
  return 0
}

export function impactBand(impact: number) {
  return CORE.impact_bands.find((b) => b.impact === impact)!
}

export type RollInput = {
  dice: number[]
  bonus: number
  /** Any number of Edge sources: only one ever applies (+2). */
  edge?: boolean | number
  adv?: Adv
  defense: number
  /** Jab: -2 to the roll, and a hit is always Impact 1. */
  jab?: boolean
  /** The Jab is with light melee (or bare hands that count as it): no -2. */
  lightJab?: boolean
}

export type RollResult = {
  dice: number[]
  kept: number[]
  total: number
  margin: number
  impact: number
  label: string
  errors: string[]
}

export function resolveRoll({ dice, bonus, edge, adv = 0, defense, jab, lightJab }: RollInput): RollResult {
  const errors: string[] = []
  const need = adv ? CORE.dice.advantage_count : CORE.dice.count
  if (dice.length !== need) errors.push(`Expected ${need} dice, got ${dice.length}.`)
  if (dice.some((d) => !Number.isInteger(d) || d < 1 || d > CORE.dice.sides)) {
    errors.push(`Each die must be 1 to ${CORE.dice.sides}.`)
  }
  const sorted = [...dice].sort((a, b) => a - b)
  const kept = adv > 0 ? sorted.slice(-2) : adv < 0 ? sorted.slice(0, 2) : dice.slice(0, 2)
  const hasEdge = typeof edge === 'number' ? edge > 0 : Boolean(edge)
  const total = kept.reduce((s, d) => s + d, 0) + bonus
    + (hasEdge ? CORE.edge_bonus : 0)
    + (jab && !lightJab ? CORE.jab_penalty : 0)
  const margin = total - defense
  let impact = impactFor(margin)
  if (jab && impact > 0) impact = 1
  return { dice, kept, total, margin, impact, label: impactBand(impact).label, errors }
}

/** Raise a hit by one Impact level (2 Drive). Impact 3 is the top; a miss can't be upgraded. */
export function upgrade(impact: number): number {
  return impact <= 0 ? impact : Math.min(CORE.impact_max, impact + 1)
}

export type HarmInput = {
  impact: number
  weapon?: WeaponId
  targetToughness: number
  /** The attack is a gun (also implied by weapon 'pistol'). Guns ignore innate Toughness (Force, powers) but not armor, so pass the target's Toughness against guns. */
  gun?: boolean
  fromMook?: boolean
  jab?: boolean
  /** Mighty Force attack: +1 Harm on Impact 2+ and ignores Toughness. */
  mighty?: boolean
  /** Ignores Toughness for another reason (a Read on the weakness, electricity, Prepared's trap). */
  pierce?: boolean
  /** Other flat Harm bonuses (Haymaker, Vengeance while Fraying), with a label each. */
  extra?: { source: string; value: number }[]
}

export type HarmStep = { label: string; change: number; running: number }
export type HarmResult = { harm: number; steps: HarmStep[] }

/**
 * Harm from a hit, with each step shown. Impact sets the base; weapon and power
 * bonuses add Harm (never Impact); Toughness subtracts; a hit always does at
 * least 1; mook attacks cap at 2, applied last.
 */
export function harm(input: HarmInput): HarmResult {
  const steps: HarmStep[] = []
  if (input.impact <= 0) return { harm: 0, steps: [{ label: 'Miss', change: 0, running: 0 }] }

  const impact = input.jab ? 1 : Math.min(CORE.impact_max, input.impact)
  let h = impact
  steps.push({ label: input.jab ? 'Impact 1 (Jab)' : `Impact ${impact}`, change: impact, running: h })

  const weapon = input.weapon ?? 'unarmed'
  const gun = Boolean(input.gun) || weapon === 'pistol'
  const bump = (label: string, v: number) => {
    h += v
    steps.push({ label, change: v, running: h })
  }

  if (weapon === 'light' && impact >= 2) bump('Light weapon (+1 on Impact 2+)', 1)
  if (weapon === 'heavy' && !input.jab) bump('Heavy weapon (+1 on a Strike)', 1)
  if (weapon === 'knife' && impact >= 2 && input.targetToughness === 0) bump('Blade vs no Toughness (+1 on Impact 2+)', 1)
  if (gun && impact >= 2) bump('Gun (+1 on Impact 2+)', 1)
  if (input.mighty && impact >= 2) bump('Mighty (+1 on Impact 2+)', 1)
  for (const e of input.extra ?? []) if (e.value) bump(e.source, e.value)

  const ignores = input.mighty ? 'Mighty ignores Toughness' : input.pierce ? 'ignores Toughness' : null
  if (input.targetToughness > 0) {
    if (ignores) steps.push({ label: `Toughness ${input.targetToughness}: ${ignores}`, change: 0, running: h })
    else bump(`Toughness ${input.targetToughness}`, -input.targetToughness)
  }

  const min = CORE.toughness.min_harm_on_hit
  if (h < min) bump('A hit always does at least 1', min - h)

  const cap = CORE.harm.mook_attack_cap
  if (input.fromMook && h > cap) bump(`Mook attacks cap at ${cap}`, cap - h)

  return { harm: h, steps }
}

/** A fair d10 from crypto.getRandomValues with rejection sampling. */
export function rollDie(sides: number = CORE.dice.sides): number {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / sides) * sides
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return (buf[0] % sides) + 1
  }
}

export function rollDice(adv: Adv = 0): number[] {
  const n = adv ? CORE.dice.advantage_count : CORE.dice.count
  return Array.from({ length: n }, () => rollDie())
}
