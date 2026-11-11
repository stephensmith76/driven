import { supabase } from './supabase'
import { useLiveRows } from './hooks'
import type { RollRow } from './types'
import type { RollRowData } from '../engine'

/** The table's roll log, newest first. Everyone in the campaign reads it live. */
export function useRolls(campaignId: string | null) {
  const { rows, ...rest } = useLiveRows<RollRow>('rolls', campaignId, '*', { column: 'at', ascending: false })
  return { rows: [...rows].sort((a, b) => b.at.localeCompare(a.at)), ...rest }
}

/** Add one roll to the log. The database checks that a player may only roll for their own hero. */
export async function logRoll(campaignId: string, row: RollRowData): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await supabase.from('rolls').insert({ id, campaign_id: campaignId, ...row })
  if (error) throw error
  return id
}

export async function deleteRoll(id: string) {
  const { error } = await supabase.from('rolls').delete().eq('id', id)
  if (error) throw error
}
