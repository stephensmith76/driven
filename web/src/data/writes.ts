import { supabase } from './supabase'
import { queuedWrite, registerHandler } from './offline'

/** Small writes (SPEC.md principle 6): each call changes one value, never the whole row. */

async function rawSetField(table: string, id: string, field: string, value: unknown) {
  const { error } = await supabase.from(table).update({ [field]: value }).eq('id', id)
  if (error) throw error
}
registerHandler('setField', rawSetField)
export const setField = (table: string, id: string, field: string, value: unknown) =>
  queuedWrite({ kind: 'setField', args: [table, id, field, value], table, id, set: { [field]: value } },
    () => rawSetField(table, id, field, value), undefined)

export type Tracker = 'harm' | 'stress' | 'drive' | 'home_clock'

/** Add or subtract from a tracker. Returns the new, clamped value. */
async function rawBump(characterId: string, field: Tracker, delta: number): Promise<number | null> {
  const { data, error } = await supabase.rpc('bump_character', {
    p_character_id: characterId, p_field: field, p_delta: delta,
  })
  if (error) throw error
  return data as number | null
}
registerHandler('bump', rawBump)
/** While offline the change shows at once and is sent later; the result is then null. */
export const bump = (characterId: string, field: Tracker, delta: number) =>
  queuedWrite<number | null>({ kind: 'bump', args: [characterId, field, delta], table: 'characters', id: characterId, add: { [field]: delta } },
    () => rawBump(characterId, field, delta), null)

/** Set one key in fight_state. null removes it. Keys: strange_used, second_wind_used, uses:<item>, kit:<item>, dawn. */
async function rawSetFlag(characterId: string, key: string, value: unknown) {
  const { error } = await supabase.rpc('set_fight_flag', {
    p_character_id: characterId, p_key: key, p_value: value === undefined ? null : value,
  })
  if (error) throw error
}
registerHandler('setFlag', rawSetFlag)
export const setFlag = (characterId: string, key: string, value: unknown) =>
  queuedWrite({ kind: 'setFlag', args: [characterId, key, value], table: 'characters', id: characterId }, () => rawSetFlag(characterId, key, value), undefined)

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
