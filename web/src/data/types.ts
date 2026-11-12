export type Stats = { force: number; flow: number; focus: number; presence: number }

export type LoadoutItem = {
  kind: 'gear' | 'power' | 'kit'
  id: string
  ability_level?: number
  flaw?: string
  custom_text?: string
  /** The hero's one free weapon: costs no slot. */
  free?: boolean
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
  extra_slots: number
  fight_state: Record<string, unknown>
  notes: string
  is_npc: boolean
  locked: boolean
}

export const CAMPAIGN_COLUMNS = 'id, name, join_code, rules_version, night, phase, settings'

export type Clock = {
  id: string; campaign_id: string; name: string
  kind: 'scheme' | 'heat' | 'goal' | 'endgame' | 'custom'
  size: number; filled: number; visible_to_players: boolean; sort: number
}

export type Clue = {
  id: string; campaign_id: string; text: string
  found_by: string | null; personal_for: string | null; is_arc: boolean; night: number | null
}

export type RollRow = {
  id: string; campaign_id: string; at: string
  actor_name: string; character_id: string | null; label: string; stat: string | null
  bonus: number; edge: boolean; adv: number; defense: number | null
  dice: number[]; kept: number[]; total: number | null; margin: number | null; impact: number | null
  mode: 'app' | 'manual'; note: string; rules_version: string | null
}

export type Zone = { id: string; name: string; tags: string[]; links: string[] }

export type Scene = {
  id: string; campaign_id: string; title: string; text: string; round: number
  zones: Zone[]
  /** Hero id -> zone id. Enemies keep their zone on the enemies row. */
  positions: Record<string, string>
  public_enemies: import('../engine').PublicEnemy[]
}
