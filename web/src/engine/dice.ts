// The roller form's math and the roll log's CSV (SPEC.md "Dice roller and roll log").
// Pure functions. The form collects a setup, the dice come from the app or from
// real dice typed in, and both go through `evaluate`, so they can never disagree.
import { CORE } from './rules'
import { netAdv, resolveRoll, type Adv, type RollResult } from './roll'

export type RollSetup = {
  /** Stat bonus or typed bonus, before Edge and Jab. */
  bonus: number
  edge: boolean
  /** Any source of Advantage / Disadvantage. They cancel and never stack. */
  advantage: boolean
  disadvantage: boolean
  jab: boolean
  /** The Jab is with light melee: no -2 (rules.md, Your turn). */
  lightJab?: boolean
  defense: number
}

export const setupAdv = (s: Pick<RollSetup, 'advantage' | 'disadvantage'>): Adv =>
  netAdv(s.advantage ? 1 : 0, s.disadvantage ? -1 : 0)

/** Two dice, or three with Advantage or Disadvantage. */
export const diceNeeded = (s: Pick<RollSetup, 'advantage' | 'disadvantage'>) =>
  setupAdv(s) ? CORE.dice.advantage_count : CORE.dice.count

export function evaluate(s: RollSetup, dice: number[]): RollResult {
  return resolveRoll({ dice, bonus: s.bonus, edge: s.edge, adv: setupAdv(s), defense: s.defense, jab: s.jab, lightJab: s.lightJab })
}

/** The defense an obstacle rating gives: 12 + rating. Ratings run from -1 to +5. */
export const obstacleDefense = (rating: number) => CORE.defense_base + rating
export const OBSTACLE_RATINGS = [-1, 0, 1, 2, 3, 4, 5] as const

/** Turn the boxes of typed dice into numbers; null where a box is empty. */
export function parseDice(texts: string[]): (number | null)[] {
  return texts.map((t) => (t.trim() === '' ? null : Number(t)))
}

export type RollRowData = {
  actor_name: string
  character_id: string | null
  label: string
  stat: string | null
  bonus: number
  edge: boolean
  adv: Adv
  defense: number | null
  dice: number[]
  kept: number[]
  total: number | null
  margin: number | null
  impact: number | null
  mode: 'app' | 'manual'
  note: string
  rules_version: string
}

/**
 * The log row for a roll. A Jab's -2 is folded into `bonus` and named in the
 * note, so total = kept dice + bonus + Edge can be rebuilt from any row.
 */
export function rollRow(args: {
  actorName: string
  characterId: string | null
  label: string
  stat: string | null
  setup: RollSetup
  result: RollResult
  mode: 'app' | 'manual'
  note?: string
}): RollRowData {
  const { setup, result } = args
  const notes = [args.note?.trim(), setup.jab ? (setup.lightJab ? 'Jab (light melee, no penalty)' : 'Jab (-2)') : ''].filter(Boolean)
  return {
    actor_name: args.actorName,
    character_id: args.characterId,
    label: args.label.trim(),
    stat: args.stat,
    bonus: setup.bonus + (setup.jab && !setup.lightJab ? CORE.jab_penalty : 0),
    edge: setup.edge,
    adv: setupAdv(setup),
    defense: setup.defense,
    dice: result.dice,
    kept: result.kept,
    total: result.total,
    margin: result.margin,
    impact: result.impact,
    mode: args.mode,
    note: notes.join('. '),
    rules_version: CORE.rules_version,
  }
}

export type LogRow = {
  at: string
  actor_name: string
  label: string
  stat: string | null
  bonus: number
  edge: boolean
  adv: number
  defense: number | null
  dice: number[]
  kept: number[]
  total: number | null
  margin: number | null
  impact: number | null
  mode: string
  note: string
}

export const CSV_COLUMNS = ['actor', 'action', 'stat', 'bonus', 'adv', 'defense', 'dice', 'kept', 'total', 'margin', 'result', 'note'] as const

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The log as CSV, in the column order of the playtest logs, oldest first. Typed rolls are marked in the note. */
export function rollsCsv(rows: LogRow[]): string {
  const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at))
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of sorted) {
    const result = r.impact == null ? '' : CORE.impact_bands.find((b) => b.impact === r.impact)?.label ?? ''
    const note = [r.mode === 'manual' ? 'manual' : '', r.edge ? 'Edge' : '', r.note].filter(Boolean).join('. ')
    lines.push([
      r.actor_name, r.label, r.stat ?? '', r.bonus, r.adv > 0 ? 'adv' : r.adv < 0 ? 'dis' : '',
      r.defense ?? '', r.dice.join(' '), r.kept.join(' '), r.total ?? '', r.margin ?? '', result, note,
    ].map(csvCell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
