// The Night: Scheme ticks, Crack the Case, Start Night (SPEC.md "GM screens", rules.md "The Night").
import { CORE } from './rules'
import { startingDrive } from './bookkeeping'
import type { Sheet } from './sheet'

const PHASES = ['patrol', 'crack', 'confrontation', 'dawn'] as const
export type Phase = (typeof PHASES)[number]
export const PHASE_NAMES: Record<Phase, string> = {
  patrol: 'Patrol', crack: 'Crack the Case', confrontation: 'Confrontation', dawn: 'Dawn',
}
export const phases = () => [...PHASES]
export const nextPhase = (p: Phase): Phase | null => PHASES[PHASES.indexOf(p) + 1] ?? null

export const crackDefense = (complexity: number) => CORE.case.crack_defense_base + complexity
export const minCluesToCrack = (complexity: number) => Math.ceil(complexity / 2)

export type TheoryClue = { id: string; personal: boolean }

/** Clues the theory counts: a personal clue counts as 2; Case Sense makes one clue count double (+1). */
export function theoryCount(clues: TheoryClue[], caseSense: boolean): number {
  const base = clues.reduce((s, c) => s + (c.personal ? CORE.case.personal_clue_worth : 1), 0)
  return base + (caseSense && clues.length > 0 ? 1 : 0)
}

export function crackWarnings(count: number, complexity: number): string[] {
  const min = minCluesToCrack(complexity)
  return count < min ? [`The team needs at least ${min} clues (half the Complexity) to try. They have ${count}.`] : []
}

export const crackResultText = (impact: number) => CORE.case.crack_results.find((r) => r.impact === impact)?.text ?? ''
export const leadResultText = (impact: number) => CORE.case.lead_results.find((r) => r.impact === impact)?.text ?? ''
export const confrontationText = (impact: number) =>
  CORE.case.confrontation.find((c) => (impact <= 0 ? c.impact === 'miss' : impact === 1 ? c.impact === '1' : c.impact === '2-3'))?.text ?? ''

/** How many Scheme ticks a missed Crack the Case costs (rules.md: "the Scheme clock ticks twice"). */
export const MISSED_CRACK_TICKS = 2

/** Where a clock is after `ticks`, and what the rules say happens at half and full. */
export function tickClock(clock: { kind: string; size: number; filled: number }, ticks: number) {
  const filled = Math.max(0, Math.min(clock.size, clock.filled + ticks))
  const rule = CORE.clocks.find((c) => c.kind === clock.kind)
  const half = Math.ceil(clock.size / 2)
  const events: string[] = []
  if (rule && clock.filled < half && filled >= half) events.push(`At half: ${rule.half}`)
  if (rule && clock.filled < clock.size && filled >= clock.size) events.push(`Full: ${rule.full}`)
  return { filled, events }
}

/** Drive at the start of a Night: anyone below their starting Drive (2, or 4 with Already Broken) goes up to it. */
export function startNightDrive(sheet: Sheet, drive: number): number {
  return Math.max(drive, startingDrive(sheet))
}
