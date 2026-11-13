// The bank: a private, shared store of heroes and villains (migration 20261112230000_bank.sql).
// A campaign's GM links the campaign to a bank with the bank's code and passcode.
// Entries are copies: adding one to a campaign makes a separate row there.
import { supabase } from './supabase'
import type { Character } from './types'
import type { Enemy } from '../engine'
import { saveVillain, type VillainData, type VillainSheet } from './villains'
import { deletePortrait, enemyKey, heroKey, portraitUrl, putPortrait } from './portraits'

export type Bank = { id: string; name: string; code: string }
export type BankEntry = {
  id: string; bank_id: string; kind: 'hero' | 'enemy'; name: string
  data: Record<string, unknown>; portrait: string | null; updated_at: string
}

/** The bank this campaign is linked to (or null), and everything in it. */
export async function loadBank(campaignId: string): Promise<{ bank: Bank | null; entries: BankEntry[] }> {
  const link = await supabase.from('campaign_banks').select('bank_id').eq('campaign_id', campaignId).maybeSingle()
  if (link.error) throw link.error
  if (!link.data) return { bank: null, entries: [] }
  const bank = await supabase.from('banks').select('id, name, code').eq('id', link.data.bank_id).maybeSingle()
  if (bank.error) throw bank.error
  if (!bank.data) return { bank: null, entries: [] }
  const entries = await supabase.from('bank_entries').select('*').eq('bank_id', bank.data.id).order('name')
  if (entries.error) throw entries.error
  return { bank: bank.data as Bank, entries: (entries.data ?? []) as BankEntry[] }
}

export async function createBank(campaignId: string, name: string, passcode: string) {
  const { error } = await supabase.rpc('create_bank', { p_campaign_id: campaignId, p_name: name, p_passcode: passcode })
  if (error) throw error
}

export async function linkBank(campaignId: string, code: string, passcode: string) {
  const { error } = await supabase.rpc('link_bank', { p_campaign_id: campaignId, p_code: code, p_passcode: passcode })
  if (error) throw error
}

/** Stop using the bank in this campaign. The bank and its entries stay. */
export async function unlinkBank(campaignId: string) {
  const { error } = await supabase.from('campaign_banks').delete().eq('campaign_id', campaignId)
  if (error) throw error
}

/** The build of a hero, without anything that belongs to one campaign (Harm, Stress, Drive, notes). */
export const heroData = (c: Character) => ({
  civilian: c.civilian, archetype_id: c.archetype_id, trait_id: c.trait_id, stats: c.stats,
  flair_ids: c.flair_ids, loadout: c.loadout, extra_slots: c.extra_slots, connections: c.connections,
  ...(c.custom_trait ? { custom_trait: c.custom_trait } : {}),
})

/** An enemy's stat block, fresh: no Harm, no Stress, nobody down, no zone. */
export const enemyData = (e: Enemy) => ({
  kind: e.kind, stats: e.stats, defenses: e.defenses, toughness: e.toughness, harm_max: e.harm_max,
  count_max: e.count_max, drive: e.drive, line: e.line, source_id: e.source_id,
  ...(e.details ? { details: e.details } : {}),
})

/** Copy a picture into another folder of the bucket. Returns the new stored value, or null if there is none. */
async function copyPortrait(value: string | null | undefined, folder: string, key: string): Promise<string | null> {
  const url = portraitUrl(value)
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await putPortrait(folder, key, await res.blob())
  } catch {
    return null   // the entry is still worth saving without its picture
  }
}

/** Save a hero or an enemy to the bank. An entry of the same kind and name is replaced. */
async function saveEntry(bank: Bank, entries: BankEntry[], kind: 'hero' | 'enemy', name: string,
  data: Record<string, unknown>, portrait: string | null | undefined): Promise<'added' | 'updated'> {
  const existing = entries.find((x) => x.kind === kind && x.name.trim().toLowerCase() === name.trim().toLowerCase())
  let id = existing?.id
  if (existing) {
    const { error } = await supabase.from('bank_entries').update({ name, data }).eq('id', existing.id)
    if (error) throw error
  } else {
    const { data: row, error } = await supabase.from('bank_entries')
      .insert({ bank_id: bank.id, kind, name, data }).select('id').single()
    if (error) throw error
    id = row.id as string
  }
  const copied = await copyPortrait(portrait, bank.id, `entry-${id}`)
  if (copied || (existing?.portrait && !portrait)) {
    const { error } = await supabase.from('bank_entries').update({ portrait: copied }).eq('id', id!)
    if (error) throw error
  }
  return existing ? 'updated' : 'added'
}

export const saveHero = (bank: Bank, entries: BankEntry[], c: Character) =>
  saveEntry(bank, entries, 'hero', c.name, heroData(c), c.portrait)

export const saveEnemy = (bank: Bank, entries: BankEntry[], e: Enemy) =>
  saveEntry(bank, entries, 'enemy', e.name, enemyData(e), e.portrait)

/** Save a built villain from a campaign's roster to the bank. */
export const saveVillainSheet = (bank: Bank, entries: BankEntry[], v: VillainSheet) =>
  saveEntry(bank, entries, 'enemy', v.name, v.data as unknown as Record<string, unknown>, v.portrait)

/** Create or replace one bank entry as it stands (used by the builders that work straight in the bank). */
export async function saveBankEntry(entry: { id: string; bank_id: string; kind: 'hero' | 'enemy'; name: string; data: object; portrait: string | null }) {
  const { error } = await supabase.from('bank_entries').upsert(entry)
  if (error) throw error
}

/** Add a banked hero to this campaign as a new, separate hero. */
export async function addHeroToCampaign(campaignId: string, entry: BankEntry) {
  const { data: row, error } = await supabase.from('characters')
    .insert({ campaign_id: campaignId, name: entry.name, ...entry.data }).select('id').single()
  if (error) throw error
  const portrait = await copyPortrait(entry.portrait, campaignId, heroKey(row.id as string))
  if (portrait) {
    const { error: e2 } = await supabase.from('characters').update({ portrait }).eq('id', row.id)
    if (e2) throw e2
  }
}

/** Add a banked villain to this campaign's roster as a separate sheet. From there it can join a fight. */
export async function addVillainToCampaign(campaignId: string, entry: BankEntry) {
  const d = entry.data as unknown as VillainData
  const portrait = await copyPortrait(entry.portrait, campaignId, enemyKey(entry.name))
  await saveVillain({
    id: crypto.randomUUID(), campaign_id: campaignId, name: entry.name, kind: d.kind ?? 'villain',
    data: { ...d, kind: d.kind ?? 'villain' }, portrait,
  })
}

export async function removeEntry(entry: BankEntry) {
  const { error } = await supabase.from('bank_entries').delete().eq('id', entry.id)
  if (error) throw error
  await deletePortrait(entry.portrait)
}
