// Advancement (rules.md, "Advancement"): when a case closes, each hero takes one pick.
// Pure functions: what each pick allows, and the sheet change it makes.
import { CORE, FLAIRS, power } from './rules'
import type { LoadoutItem, Sheet, Stats } from './sheet'
import { TEAM, type TeamSheet } from './team'

export type AdvancementKind = 'stat' | 'flair' | 'ability' | 'slot' | 'asset'

/** One pick, as kept in the characters.advancements column, oldest first. */
export type AdvancementPick = {
  kind: AdvancementKind
  /** stat: the stat id. flair: the Flair id. ability: the power id. asset: an Asset id, or "room:<id>" for a Lair room. */
  id?: string
  /** What it was, in words, for the sheet and the printout. */
  label: string
  /** The campaign Night when it was taken. */
  night?: number
  at?: string
}

/** The limits from the Advancement table (checked against core.json in the tests). */
export const ADVANCEMENT_LIMITS = { stat_max: 4, stat_total: 10, flairs: 4, slots: 6 } as const

export const ADVANCEMENT_KINDS: { kind: AdvancementKind; name: string; text: string }[] = [
  { kind: 'stat', name: 'A stat', text: CORE.advancement[0] },
  { kind: 'flair', name: 'A Flair', text: CORE.advancement[1] },
  { kind: 'ability', name: 'A power ability', text: CORE.advancement[2] },
  { kind: 'slot', name: 'A slot', text: CORE.advancement[3] },
  { kind: 'asset', name: 'An Asset or a Lair room', text: CORE.advancement[4] },
]

const STATS = ['force', 'flow', 'focus', 'presence'] as const
const statName = (id: string) => CORE.stats.find((s) => s.id === id)?.name ?? id

export type Choice = { id: string; label: string; ok: boolean; reason?: string }
export type KindOptions = { kind: AdvancementKind; ok: boolean; reason?: string; choices: Choice[] }

/** Every pick kind with its choices, and why a kind or choice is closed right now. */
export function advancementOptions(sheet: Sheet, history: AdvancementPick[], team?: TeamSheet | null): KindOptions[] {
  const L = ADVANCEMENT_LIMITS
  const last = history[history.length - 1]
  const total = STATS.reduce((s, k) => s + sheet.stats[k], 0)

  const statChoices: Choice[] = STATS.map((k) => {
    const v = sheet.stats[k]
    return v >= L.stat_max
      ? { id: k, label: `${statName(k)} +${v} to +${v + 1}`, ok: false, reason: `already +${L.stat_max}` }
      : { id: k, label: `${statName(k)} ${v > 0 ? '+' : ''}${v} to +${v + 1}`, ok: true }
  })
  const statReason = last?.kind === 'stat' ? 'You took a stat last case: never two cases in a row.'
    : total >= L.stat_total ? `Your stats already total +${L.stat_total}.`
    : statChoices.every((c) => !c.ok) ? 'Every stat is at the limit.' : undefined

  const flairs = sheet.flair_ids ?? []
  const flairChoices: Choice[] = FLAIRS.filter((f) => !flairs.includes(f.id)).map((f) => ({ id: f.id, label: f.name + (f.trial ? ' (trial)' : ''), ok: true }))
  const flairReason = flairs.length >= L.flairs ? `You have ${L.flairs} Flairs, the most allowed.` : undefined

  const abilityChoices: Choice[] = (sheet.loadout ?? []).filter((i) => i.kind === 'power').flatMap((i): Choice[] => {
    const p = power(i.id)
    if (!p) return []
    const level = i.ability_level ?? 1
    const next = p.abilities[level]
    return next ? [{ id: p.id, label: `${p.name}: ${next.name}`, ok: true }] : [{ id: p.id, label: `${p.name}: all abilities unlocked`, ok: false }]
  })
  const abilityReason = abilityChoices.length === 0 ? 'You have no powers.'
    : abilityChoices.every((c) => !c.ok) ? 'Every power is fully unlocked.' : undefined

  const slotMax = CORE.slots.at_creation + (sheet.extra_slots ?? 0)
  const slotReason = slotMax >= L.slots ? `You have ${L.slots} slots, the most allowed.` : undefined

  const owned = new Set(team?.assets ?? [])
  const rooms = new Set(team?.lair?.rooms ?? [])
  const assetChoices: Choice[] = [
    ...TEAM.assets.map((a) => ({ id: a.id, label: `Asset: ${a.name}${a.trial ? ' (trial)' : ''}`, ok: !owned.has(a.id), reason: owned.has(a.id) ? 'the team has it' : undefined })),
    ...TEAM.lair.rooms.map((r) => ({
      id: `room:${r.id}`, label: `Lair room: ${r.name}`,
      ok: Boolean(team?.lair) && !rooms.has(r.id),
      reason: !team?.lair ? 'the team has no Lair' : rooms.has(r.id) ? 'the Lair has it' : undefined,
    })),
  ]

  return [
    { kind: 'stat', ok: !statReason, reason: statReason, choices: statChoices },
    { kind: 'flair', ok: !flairReason, reason: flairReason, choices: flairChoices },
    { kind: 'ability', ok: !abilityReason, reason: abilityReason, choices: abilityChoices },
    { kind: 'slot', ok: !slotReason, reason: slotReason, choices: [] },
    { kind: 'asset', ok: true, choices: assetChoices },
  ]
}

/** The sheet columns a pick changes. Asset and room picks change the team sheet instead (see teamAfterPick). */
export type SheetPatch = Partial<{ stats: Stats; flair_ids: string[]; loadout: LoadoutItem[]; extra_slots: number }>

/** The pick in words, for the history. */
export function pickLabel(kind: AdvancementKind, id?: string, sheet?: Sheet): string {
  if (kind === 'stat') return `+1 ${statName(id ?? '')}${sheet ? ` (to +${(sheet.stats[id as keyof Stats] ?? 0) + 1})` : ''}`
  if (kind === 'flair') return `Flair: ${FLAIRS.find((f) => f.id === id)?.name ?? id}`
  if (kind === 'ability') {
    const p = power(id ?? '')
    const level = sheet?.loadout?.find((i) => i.kind === 'power' && i.id === id)?.ability_level ?? 1
    return `${p?.name ?? id}: ${p?.abilities[level]?.name ?? 'next ability'}`
  }
  if (kind === 'slot') return 'A new slot'
  if (id?.startsWith('room:')) return `Lair room: ${TEAM.lair.rooms.find((r) => `room:${r.id}` === id)?.name ?? id.slice(5)}`
  return `Asset: ${TEAM.assets.find((a) => a.id === id)?.name ?? id ?? 'to be chosen'}`
}

/** Apply a pick (direction 1) or undo it (direction -1). */
export function sheetAfterPick(sheet: Sheet, pick: Pick<AdvancementPick, 'kind' | 'id'>, direction: 1 | -1 = 1): SheetPatch {
  if (pick.kind === 'stat' && pick.id) {
    const k = pick.id as keyof Stats
    return { stats: { ...sheet.stats, [k]: sheet.stats[k] + direction } }
  }
  if (pick.kind === 'flair' && pick.id) {
    const f = sheet.flair_ids ?? []
    return { flair_ids: direction > 0 ? (f.includes(pick.id) ? f : [...f, pick.id]) : f.filter((x) => x !== pick.id) }
  }
  if (pick.kind === 'ability' && pick.id) {
    return {
      loadout: (sheet.loadout ?? []).map((i) => {
        if (i.kind !== 'power' || i.id !== pick.id) return i
        const max = power(i.id)?.abilities.length ?? 3
        return { ...i, ability_level: Math.max(1, Math.min(max, (i.ability_level ?? 1) + direction)) }
      }),
    }
  }
  if (pick.kind === 'slot') return { extra_slots: Math.max(0, (sheet.extra_slots ?? 0) + direction) }
  return {}
}

/** The team sheet after an Asset or room pick (or its undo). Null when the pick doesn't touch the team. */
export function teamAfterPick(team: TeamSheet | null | undefined, pick: Pick<AdvancementPick, 'kind' | 'id'>, direction: 1 | -1 = 1): TeamSheet | null {
  if (pick.kind !== 'asset' || !pick.id) return null
  const t: TeamSheet = { ...(team ?? {}) }
  if (pick.id.startsWith('room:')) {
    if (!t.lair) return null
    const id = pick.id.slice(5)
    const rooms = t.lair.rooms ?? []
    t.lair = { ...t.lair, rooms: direction > 0 ? (rooms.includes(id) ? rooms : [...rooms, id]) : rooms.filter((r) => r !== id) }
    return t
  }
  const assets = t.assets ?? []
  t.assets = direction > 0 ? (assets.includes(pick.id) ? assets : [...assets, pick.id]) : assets.filter((a) => a !== pick.id)
  return t
}

/** Warnings for a sheet past creation: the Advancement limits. Warnings, never blocks. */
export function advancementWarnings(sheet: Sheet): string[] {
  const L = ADVANCEMENT_LIMITS
  const w: string[] = []
  const total = STATS.reduce((s, k) => s + sheet.stats[k], 0)
  if (total > L.stat_total) w.push(`Stats total +${total}; the limit is +${L.stat_total}.`)
  if ((sheet.flair_ids ?? []).length > L.flairs) w.push(`${(sheet.flair_ids ?? []).length} Flairs; the limit is ${L.flairs}.`)
  if (CORE.slots.at_creation + (sheet.extra_slots ?? 0) > L.slots) w.push(`${CORE.slots.at_creation + (sheet.extra_slots ?? 0)} slots; the limit is ${L.slots}.`)
  return w
}
