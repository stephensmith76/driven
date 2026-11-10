export type Stats = { force: number; flow: number; focus: number; presence: number }

export type LoadoutItem = {
  kind: 'gear' | 'power' | 'kit'
  id: string
  ability_level?: number
  flaw?: string
  custom_text?: string
}

export type Campaign = {
  id: string
  name: string
  join_code: string
  rules_version: string | null
  night: number
  phase: 'patrol' | 'crack' | 'confrontation' | 'dawn'
  settings: { players_can_build: boolean; players_see_sheets: boolean }
}

export type Member = {
  id: string
  campaign_id: string
  user_id: string
  role: 'player' | 'gm'
  character_id: string | null
  display_name: string
}

export type Character = {
  id: string
  campaign_id: string
  name: string
  civilian: string
  archetype_id: string | null
  trait_id: string | null
  stats: Stats
  flair_ids: string[]
  loadout: LoadoutItem[]
  harm: number
  stress: number
  drive: number
  dying: boolean
  hidden: boolean
  home_clock: number
  fight_state: Record<string, unknown>
  notes: string
  is_npc: boolean
  locked: boolean
}

export const CAMPAIGN_COLUMNS = 'id, name, join_code, rules_version, night, phase, settings'
