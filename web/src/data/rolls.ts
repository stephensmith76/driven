import { supabase } from './supabase'
import { useLiveRows } from './hooks'
import { queuedWrite, registerHandler } from './offline'
import type { RollRow } from './types'
import type { RollRowData } from '../engine'

/** The table's roll log, newest first. Everyone in the campaign reads it live. */
export function useRolls(campaignId: string | null) {
  const { rows, ...rest } = useLiveRows<RollRow>('rolls', campaignId, '*', { column: 'at', ascending: false })
  return { rows: [...rows].sort((a, b) => b.at.localeCompare(a.at)), ...rest }
}

/** Add one roll to the log. The database checks that a player may only roll for their own hero. */
async function rawInsertRoll(full: Record<string, unknown>) {
  const { error } = await supabase.from('rolls').insert(full)
  // A duplicate id means an earlier attempt already landed.
  if (error && error.code !== '23505') throw error
}
registerHandler('insertRoll', rawInsertRoll)
export async function logRoll(campaignId: string, row: RollRowData): Promise<string> {
  const id = crypto.randomUUID()
  const full = { id, campaign_id: campaignId, at: new Date().toISOString(), ...row }
  await queuedWrite({ kind: 'insertRoll', args: [full], table: 'rolls', id, insert: full }, () => rawInsertRoll(full), undefined)
  return id
}

export async function deleteRoll(id: string) {
  const { error } = await supabase.from('rolls').delete().eq('id', id)
  if (error) throw error
}
