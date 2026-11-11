// The hidden case file and arc sheet (gm_secrets.case / gm_secrets.arc).
// The format is described in supabase/seed/CASE_FORMAT.md.

export type CaseClue = {
  /** Stable id within the case, e.g. "k1". */
  id: string
  text: string
  /** Lead that gives this clue, by name. */
  lead?: string
  /** Suspects or facets it fits (good clues fit more than one). */
  points_to?: string[]
  /** Hero name: a personal clue counts as 2 in a theory and ticks that hero's Home. */
  personal_for?: string
  /** Points past this case to the arc's Mastermind. */
  is_arc?: boolean
  red_herring?: boolean
  note?: string
  /** Set by the app: the id of the found-clue row once revealed. */
  revealed?: string | null
}

export type CaseFile = {
  title?: string
  mode?: 'fixed' | 'floating'
  complexity?: number
  culprit?: string
  facets?: { who?: string; what?: string; where?: string }
  cast?: { name: string; who?: string; motive?: string; hides?: string }[]
  leads?: { name: string; rating: number; approach?: string; text?: string }[]
  clues?: CaseClue[]
  scheme_steps?: string[]
  confrontation?: string
  /** Written by the Night screen. */
  crack_log?: { at: string; night: number; clues: number; dice: number[]; total: number; defense: number; impact: number; upgraded?: boolean }[]
}

export type ArcSheet = {
  mastermind?: string
  endgame?: string
  tools?: { name: string; knows?: string }[]
  calling_card?: string
  arc_clues?: string[]
}

export const blankCase = (): CaseFile => ({
  title: '',
  mode: 'fixed',
  complexity: 6,
  culprit: '',
  facets: { who: '', what: '', where: '' },
  cast: [{ name: '', who: '', motive: '', hides: '' }],
  leads: [{ name: '', rating: 1, approach: '', text: '' }],
  clues: [{ id: 'k1', text: '', lead: '', points_to: [] }],
  scheme_steps: [''],
  confrontation: '',
})

export const blankArc = (): ArcSheet => ({
  mastermind: '', endgame: '', tools: [{ name: '', knows: '' }], calling_card: '', arc_clues: [],
})

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Light checks on a pasted case file. Problems are warnings; only non-objects are refused. */
export function checkCase(v: unknown): { ok: boolean; warnings: string[] } {
  if (!isObj(v)) return { ok: false, warnings: ['The case file must be a JSON object.'] }
  const c = v as CaseFile
  const w: string[] = []
  if (c.complexity !== undefined && ![4, 6, 8].includes(c.complexity)) w.push(`Complexity is usually 4, 6 or 8 (this says ${c.complexity}).`)
  if (c.clues !== undefined && !Array.isArray(c.clues)) w.push('"clues" should be a list.')
  const ids = (c.clues ?? []).map((k) => k?.id)
  if (ids.some((id) => !id)) w.push('Every clue needs an "id" so it can be revealed.')
  if (new Set(ids).size !== ids.length) w.push('Two clues share an id.')
  for (const l of c.leads ?? []) if (typeof l?.rating !== 'number') w.push(`Lead "${l?.name ?? '?'}" needs a number "rating".`)
  return { ok: true, warnings: w }
}
