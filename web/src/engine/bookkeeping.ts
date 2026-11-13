// Bookkeeping for the buttons on a sheet (SPEC.md "Player screens"). Pure
// functions: they work out what changes, the screen writes it. Nothing here
// blocks anything; a broken rule comes back as a warning string.
import { CORE, CUSTOM_TRAIT_ID, CUSTOM_TRAIT_PARTS, flair } from './rules'
import { harmBoxes, slotsUsed, type Sheet } from './sheet'

/** Drive at the start of a Night: 2, or 4 with Already Broken. */
export function startingDrive(sheet: Sheet): number {
  const fromFlairs = (sheet.flair_ids ?? []).map((id) => flair(id)?.start_drive ?? 0)
  return Math.max(CORE.drive.start_night, ...fromFlairs)
}

/** Stress never drops below this (Already Broken: 4). */
export function stressFloor(sheet: Sheet): number {
  return Math.max(0, ...(sheet.flair_ids ?? []).map((id) => flair(id)?.stress_floor ?? 0))
}

export type Trackers = { harm: number; stress: number; drive: number; home_clock: number; dying?: boolean }
export type DawnResult = {
  patch: Partial<Trackers>
  /** What the app did, in plain words, for the confirmation line. */
  notes: string[]
  /** Things only the GM can apply (Heat and clues live on the table, not the sheet). */
  gmTasks: string[]
}

/**
 * Dawn: the hero picks two options. Applies the ones a sheet can (Stress, Harm,
 * Home) and lists the ones the GM has to apply (Heat, a clue). Then Drive above
 * 3 drops to 3.
 */
export function dawn(sheet: Sheet, t: Trackers, picks: string[]): DawnResult {
  const patch: Partial<Trackers> = {}
  const notes: string[] = []
  const gmTasks: string[] = []
  const has = (id: string) => picks.includes(id)
  const name = (id: string) => CORE.dawn.options.find((o) => o.id === id)?.name ?? id

  // Sleep It Off clears 3 Stress and Show Up clears 1 (rules.md, Dawn). Stress never drops below the hero's floor.
  const floor = stressFloor(sheet)
  let stress = t.stress
  for (const id of ['sleep_it_off', 'show_up']) {
    const clear = (CORE.dawn.options.find((o) => o.id === id) as { stress_clear?: number } | undefined)?.stress_clear ?? 0
    if (!has(id) || clear === 0 || stress <= floor) continue
    const next = Math.max(floor, stress - clear)
    notes.push(`${name(id)}: Stress ${stress} to ${next}${next === floor && floor > 0 ? ' (it never drops lower)' : ''}.`)
    stress = next
  }
  if (stress !== t.stress) patch.stress = stress

  if (has('patch_up')) {
    const boxes = harmBoxes(sheet).length
    const down = t.harm >= boxes
    if (down && !has('sleep_it_off')) {
      notes.push(`${name('patch_up')}: still Down. Clearing Down needs ${name('patch_up')} and ${name('sleep_it_off')} together.`)
    } else {
      patch.harm = Math.min(t.harm, 1)
      if (down) patch.dying = false
      notes.push(`${name('patch_up')}: ${down ? 'Down, Wounded and Hurt' : 'Hurt and Wounded'} cleared. A Bruise can stay until a breather.`)
    }
  }

  if (!has('show_up')) {
    patch.home_clock = Math.min(CORE.clocks.find((c) => c.kind === 'home')!.size, t.home_clock + 1)
    notes.push(`You didn't pick ${name('show_up')}: Home ticks to ${patch.home_clock}.`)
  } else {
    notes.push(`${name('show_up')}: Home stays at ${t.home_clock}.`)
  }

  if (has('lay_low')) gmTasks.push(`${name('lay_low')}: GM clears 1 Heat.`)
  if (has('work_the_case')) gmTasks.push(`${name('work_the_case')}: GM gives 1 clue.`)

  const cap = CORE.drive.dawn_cap
  if (t.drive > cap) {
    patch.drive = cap
    notes.push(`Drive ${t.drive} drops to ${cap}.`)
  }
  return { patch, notes, gmTasks }
}

/** Second Wind (3 Drive, once per fight): clear one Harm box. A Down hero comes back up at Wounded, which is one box less. */
export function secondWind(t: { harm: number; drive: number }, alreadyUsed: boolean) {
  const cost = CORE.drive.prices.find((p) => p.id === 'second_wind')!.cost
  const warnings: string[] = []
  if (alreadyUsed) warnings.push('Second Wind was already used this fight.')
  if (t.drive < cost) warnings.push(`Second Wind costs ${cost} Drive; you have ${t.drive}.`)
  if (t.harm <= 0) warnings.push('There is no Harm to clear.')
  return { cost, harmDelta: t.harm > 0 ? -1 : 0, warnings }
}

export const priceOf = (id: 'edge' | 'upgrade' | 'signature' | 'second_wind') =>
  CORE.drive.prices.find((p) => p.id === id)!.cost

/** How many times a limited-use item has been used this fight, and its limit. */
export function usesLeft(fightState: Record<string, unknown> | undefined, itemId: string, perFight: number) {
  const used = Number(fightState?.[`uses:${itemId}`] ?? 0)
  return { used, perFight, left: Math.max(0, perFight - used) }
}

const STAT_MIN = () => CORE.stat_min
const STAT_MAX = () => CORE.stat_max

/** Warnings for the Builder. Saving is never blocked. */
export function buildWarnings(sheet: Sheet, opts: { creation: boolean }): string[] {
  const w: string[] = []
  if (!sheet.name?.trim()) w.push('Give the hero a name.')
  if (!sheet.archetype_id) w.push('Pick an archetype.')
  if (!sheet.trait_id) w.push('Pick a Trait.')
  else if (sheet.trait_id === CUSTOM_TRAIT_ID) {
    const c = sheet.custom_trait ?? {}
    if (!c.name?.trim() || CUSTOM_TRAIT_PARTS.some((k) => !c[k]?.trim())) w.push('Your own Trait needs a name and all five parts.')
  }

  const vals = [sheet.stats.force, sheet.stats.flow, sheet.stats.focus, sheet.stats.presence]
  if (vals.some((v) => v < STAT_MIN() || v > STAT_MAX())) w.push(`Stats run from ${STAT_MIN()} to +${STAT_MAX()}.`)
  if (opts.creation) {
    const sorted = [...vals].sort((a, b) => b - a).join(',')
    const fits = CORE.stat_arrays.some((a) => [...a.values].sort((x, y) => y - x).join(',') === sorted)
    if (!fits) {
      const names = CORE.stat_arrays.map((a) => `${a.name} (${a.values.map((v) => (v > 0 ? `+${v}` : v)).join(', ')})`).join(' or ')
      w.push(`Stats don't match a starting array: ${names}.`)
    }
    const flairs = sheet.flair_ids ?? []
    if (flairs.length !== 1) w.push(`Pick one Flair at creation (you have ${flairs.length}).`)
  }
  w.push(...slotsUsed(sheet, { creation: opts.creation }).warnings)
  return w
}
