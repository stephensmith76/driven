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

/** Complexity scales with the team (rules.md, Case prep): one-Night 4; normal 2 + twice the heroes (never under 6); finale 2 more. */
export type CaseSize = 'one_night' | 'normal' | 'finale'
export function caseComplexity(size: CaseSize, heroes: number): number {
  const k = CORE.case.complexity
  if (size === 'one_night') return k.one_night
  const normal = Math.max(k.normal_min, k.normal_base + k.normal_per_hero * heroes)
  return size === 'finale' ? normal + k.finale_extra : normal
}
export function complexityOptions(heroes: number): { size: CaseSize; value: number; text: string }[] {
  const who = `${heroes} ${heroes === 1 ? 'hero' : 'heroes'}`
  return [
    { size: 'one_night', value: caseComplexity('one_night', heroes), text: 'A one-Night job' },
    { size: 'normal', value: caseComplexity('normal', heroes), text: `A normal case for ${who}` },
    { size: 'finale', value: caseComplexity('finale', heroes), text: `An arc finale for ${who}` },
  ]
}
/** How many clues case prep should hold (Complexity plus 4). */
export const prepClues = (complexity: number) => complexity + CORE.case.complexity.prep_clues_extra

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

/** A missed Crack the Case: Regroup ticks the Scheme twice; Go in anyway ticks it once and springs a trap. */
export const MISSED_CRACK_TICKS = CORE.case.missed_crack.regroup_ticks
export const TRAP_TICKS = CORE.case.missed_crack.trap_ticks
export const trapText = () => CORE.case.missed_crack.trap_text

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
