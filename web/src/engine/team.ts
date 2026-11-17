// The team sheet: the Lair and the team's Assets (rules.md, Assets and The Lair).
// It is saved in the campaign's settings, so it needs no table of its own.
import teamFile from '../../../rules/data/team.json'

export const TEAM = teamFile
export type LairStyle = (typeof teamFile.lair.styles)[number]

export type LairSheet = {
  name?: string
  /** A style id from team.json (gym, hideout, front, watchtower). */
  style?: string
  /** Room ids from team.json. */
  rooms?: string[]
  found?: boolean
  burned?: boolean
}

export type TeamSheet = {
  lair?: LairSheet | null
  /** Asset ids from team.json. */
  assets?: string[]
  notes?: string
}

/** What the Lair does for a hero's Dawn. A burned Lair gives nothing. */
export type LairAtDawn = {
  /** The team has a Lair and it isn't burned. */
  usable: boolean
  /** The extra Dawn pick its style adds (the Gym's Train), if any. */
  pick: NonNullable<LairStyle['dawn_pick']> | null
}

export const lairStyle = (id: string | undefined) => TEAM.lair.styles.find((s) => s.id === id)

export function lairAtDawn(team: TeamSheet | null | undefined): LairAtDawn {
  const lair = team?.lair
  const usable = Boolean(lair) && !lair!.burned
  return { usable, pick: usable ? lairStyle(lair!.style)?.dawn_pick ?? null : null }
}

/** True when the team sheet has anything on it worth showing. */
export const teamHasAnything = (team: TeamSheet | null | undefined) =>
  Boolean(team?.lair) || (team?.assets?.length ?? 0) > 0 || Boolean(team?.notes?.trim())
