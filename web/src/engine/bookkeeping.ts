// Bookkeeping for the buttons on a sheet (SPEC.md "Player screens"). Pure
// functions: they work out what changes, the screen writes it. Nothing here
// blocks anything; a broken rule comes back as a warning string.
import { CORE, CUSTOM_TRAIT_ID, CUSTOM_TRAIT_PARTS, archetype, flair, heroTrait } from './rules'
import { harmBoxes, resolveLoadout, slotsUsed, type Sheet } from './sheet'
import { TEAM, type LairAtDawn } from './team'
import { advancementWarnings } from './advancement'

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
export function dawn(sheet: Sheet, t: Trackers, picks: string[], lair?: LairAtDawn): DawnResult {
  const patch: Partial<Trackers> = {}
  const notes: string[] = []
  const gmTasks: string[] = []
  const has = (id: string) => picks.includes(id)
  const name = (id: string) => CORE.dawn.options.find((o) => o.id === id)?.name ?? (lair?.pick?.id === id ? lair.pick.name : id)
  const atLair = Boolean(lair?.usable)

  // Sleep It Off clears 3 Stress and Show Up clears 1 (rules.md, Dawn). Stress never drops below the hero's floor.
  const floor = stressFloor(sheet)
  let stress = t.stress
  for (const id of ['sleep_it_off', 'show_up']) {
    const base = (CORE.dawn.options.find((o) => o.id === id) as { stress_clear?: number } | undefined)?.stress_clear ?? 0
    const rest = atLair && id === 'sleep_it_off' ? TEAM.lair.rest.stress : 0
    const clear = base + rest
    if (!has(id) || clear === 0 || stress <= floor) continue
    const next = Math.max(floor, stress - clear)
    notes.push(`${name(id)}: Stress ${stress} to ${next}${rest ? ` (${rest} more at the Lair)` : ''}${next === floor && floor > 0 ? ' (it never drops lower)' : ''}.`)
    stress = next
  }
  if (stress !== t.stress) patch.stress = stress

  if (has('patch_up')) {
    const boxes = harmBoxes(sheet).length
    const down = t.harm >= boxes
    if (down && !has('sleep_it_off')) {
      notes.push(`${name('patch_up')}: still Down. Clearing Down needs ${name('patch_up')} and ${name('sleep_it_off')} together.`)
    } else {
      patch.harm = Math.min(t.harm, Math.max(0, 1 - (atLair ? TEAM.lair.rest.harm : 0)))
      if (down) patch.dying = false
      notes.push(`${name('patch_up')}: ${down ? 'Down, Wounded and Hurt' : 'Hurt and Wounded'} cleared. ${atLair ? 'The Lair clears the Bruise too.' : 'A Bruise can stay until a breather.'}`)
    }
  }

  if (!has('show_up')) {
    patch.home_clock = Math.min(CORE.clocks.find((c) => c.kind === 'home')!.size, t.home_clock + 1)
    notes.push(`You didn't pick ${name('show_up')}: Home ticks to ${patch.home_clock}.`)
  } else {
    notes.push(`${name('show_up')}: Home stays at ${t.home_clock}.`)
  }

  if (has('lay_low')) gmTasks.push(`${name('lay_low')}: GM clears 1 Heat.${atLair ? ' At the Lair, nobody can find you until the next Night.' : ''}`)
  if (has('work_the_case')) gmTasks.push(`${name('work_the_case')}: GM gives 1 clue.`)

  const cap = CORE.drive.dawn_cap
  let drive = t.drive
  if (drive > cap) {
    drive = cap
    notes.push(`Drive ${t.drive} drops to ${cap}.`)
  }
  // The Gym's Train: 1 more Drive than the hero would otherwise start the next Night with.
  const extra = lair?.pick && has(lair.pick.id) ? lair.pick.drive : 0
  if (extra) {
    const to = Math.min(CORE.drive.max, Math.max(drive, startingDrive(sheet)) + extra)
    notes.push(`${lair!.pick!.name}: you start the next Night with ${to} Drive.`)
    drive = to
  }
  if (drive !== t.drive) patch.drive = drive
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
  } else {
    w.push(...advancementWarnings(sheet))
  }
  w.push(...slotsUsed(sheet, { creation: opts.creation }).warnings)
  return w
}

export type UsePeriod = 'fight' | 'scene' | 'Night' | 'case'
/** Something with a limited number of uses that a paper sheet should give tick boxes for. */
export type TrackedUse = { source: string; count: number; period: UsePeriod }

const USE_RE = /\b(once|twice) per (fight|scene|night|case)\b/i

/**
 * Every "once per fight / scene / Night / case" on a hero, for tick boxes on a
 * printed sheet. Faster limits (per turn, per round) don't need boxes.
 */
export function usesToTrack(sheet: Sheet): TrackedUse[] {
  const out: TrackedUse[] = []
  const seen = new Set<string>()
  const add = (source: string, text: string | undefined, fixed?: number) => {
    if (seen.has(source)) return
    if (fixed) { seen.add(source); out.push({ source, count: fixed, period: 'fight' }); return }
    const m = text && USE_RE.exec(text)
    if (!m) return
    seen.add(source)
    const period = m[2].toLowerCase()
    out.push({ source, count: m[1].toLowerCase() === 'twice' ? 2 : 1, period: period === 'night' ? 'Night' : (period as UsePeriod) })
  }
  const arch = archetype(sheet.archetype_id)
  if (arch) {
    if (arch.feature) add(arch.feature.name, arch.feature.text)
    for (const q of arch.quick_actions) add(q.name, q.text)
  }
  const t = heroTrait(sheet)
  if (t) {
    // One row for the Trait: the Fraying perk replaces the Steady one, and they share a limit.
    add(`${t.name} perk`, t.steady)
    add(`${t.name} perk`, t.fraying)
  }
  for (const id of sheet.flair_ids ?? []) { const f = flair(id); if (f) add(f.name, f.text) }
  for (const r of resolveLoadout(sheet)) {
    if (r.kind === 'gear' || r.kind === 'kit') add(r.entry.name, r.entry.text, r.entry.uses_per_fight)
    if (r.kind === 'power') {
      const level = r.item.ability_level ?? 1
      r.entry.abilities.slice(0, level).forEach((a) => add(`${r.entry.name}: ${a.name}`, a.text))
      if (r.entry.tier === 'strange' && r.entry.first_use_stress !== false) {
        out.push({ source: `${r.entry.name}: ${r.entry.always_on ? 'first hit stopped' : 'first use'} (1 Stress)`, count: 1, period: 'fight' })
      }
    }
  }
  out.push({ source: 'Second Wind (3 Drive)', count: 1, period: 'fight' })
  return out
}

