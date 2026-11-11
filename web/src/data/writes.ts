import { supabase } from './supabase'

/** Small writes (SPEC.md principle 6): each call changes one value, never the whole row. */

export async function setField(table: string, id: string, field: string, value: unknown) {
  const { error } = await supabase.from(table).update({ [field]: value }).eq('id', id)
  if (error) throw error
}

export type Tracker = 'harm' | 'stress' | 'drive' | 'home_clock'

/** Add or subtract from a tracker. Returns the new, clamped value. */
export async function bump(characterId: string, field: Tracker, delta: number): Promise<number | null> {
  const { data, error } = await supabase.rpc('bump_character', {
    p_character_id: characterId, p_field: field, p_delta: delta,
  })
  if (error) throw error
  return data as number | null
}

/** Set one key in fight_state. null removes it. Keys: strange_used, second_wind_used, uses:<item>, kit:<item>, dawn. */
export async function setFlag(characterId: string, key: string, value: unknown) {
  const { error } = await supabase.rpc('set_fight_flag', {
    p_character_id: characterId, p_key: key, p_value: value === undefined ? null : value,
  })
  if (error) throw error
}

export async function newFight(characterId: string) {
  const { error } = await supabase.rpc('new_fight', { p_character_id: characterId })
  if (error) throw error
}

export async function setKit(characterId: string, ids: string[]) {
  const { error } = await supabase.rpc('set_kit', { p_character_id: characterId, p_ids: ids })
  if (error) throw error
}

/** Update only the columns that changed. */
export async function updateColumns(characterId: string, patch: Record<string, unknown>) {
  if (Object.keys(patch).length === 0) return
  const { error } = await supabase.from('characters').update(patch).eq('id', characterId)
  if (error) throw error
}
