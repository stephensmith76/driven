import { useEffect, useState } from 'react'
import { ensureSignedIn, supabase } from './supabase'
import { CAMPAIGN_COLUMNS, type Campaign, type Character, type Member } from './types'

type Row = { id: string }

/**
 * Loads a campaign's rows from one table and keeps them live via Realtime.
 * RLS decides what comes back, so the same hook serves players and the GM.
 */
export function useLiveRows<T extends Row>(
  table: string,
  campaignId: string | null,
  columns = '*',
  order?: { column: string; ascending?: boolean },
) {
  const [rows, setRows] = useState<T[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    setLoading(true)

    const load = async () => {
      let q = supabase.from(table).select(columns).eq('campaign_id', campaignId)
      if (order) q = q.order(order.column, { ascending: order.ascending ?? true })
      const { data, error } = await q
      if (cancelled) return
      if (error) setError(error.message)
      else setRows((data ?? []) as unknown as T[])
      setLoading(false)
    }

    const channel = supabase
      .channel(`${table}:${campaignId}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          setRows((prev) => {
            if (payload.eventType === 'DELETE') {
              const old = payload.old as Row
              return prev.filter((r) => r.id !== old.id)
            }
            const row = payload.new as T
            const i = prev.findIndex((r) => r.id === row.id)
            if (i === -1) return [...prev, row]
            const next = prev.slice()
            next[i] = { ...prev[i], ...row }
            return next
          })
        },
      )
      .subscribe((status) => {
        // Reload after (re)connecting so nothing missed while offline is lost.
        if (status === 'SUBSCRIBED') void load()
      })

    void load()
    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [table, campaignId, columns, order?.column, order?.ascending])

  return { rows, error, loading }
}

export function useCampaign(campaignId: string | null) {
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase
        .from('campaigns').select(CAMPAIGN_COLUMNS).eq('id', campaignId).maybeSingle()
      if (cancelled) return
      if (error) setError(error.message)
      else if (!data) setError('Campaign not found, or this device has not joined it.')
      else setCampaign(data as unknown as Campaign)
    }
    const channel = supabase
      .channel(`campaign:${campaignId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` },
        () => void load())
      .subscribe()
    void load()
    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [campaignId])

  return { campaign, error }
}

export const useCharacters = (cid: string | null) =>
  useLiveRows<Character>('characters', cid, '*', { column: 'name' })

export function useMembers(cid: string | null) {
  // members isn't on Realtime; poll lightly so claims show up.
  const [rows, setRows] = useState<Member[]>([])
  useEffect(() => {
    if (!cid) return
    let cancelled = false
    const load = async () => {
      const { data } = await supabase.from('members').select('*').eq('campaign_id', cid)
      if (!cancelled && data) setRows(data as Member[])
    }
    void load()
    const t = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [cid])
  return rows
}

/** This device's user id and, once loaded, its membership (role, claimed hero) in the campaign. */
export function useMe(cid: string | null) {
  const [uid, setUid] = useState<string | null>(null)
  useEffect(() => { void ensureSignedIn().then(setUid) }, [])
  const members = useMembers(cid)
  const member = members.find((m) => m.user_id === uid) ?? null
  return { uid, member, role: member?.role ?? null, members }
}
