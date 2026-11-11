/**
 * Sync test (SPEC.md M2 "Done when": a change on a phone shows on a second device within 2 seconds).
 * A player's tap goes through the same RPC the Sheet uses; a second player device and the GM
 * both listen on Realtime, and we time how long each takes to see it.
 *
 *   npm run test:sync
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const envFile = resolve(here, '../../web/.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.VITE_SUPABASE_KEY
if (!URL || !KEY) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY.')
  process.exit(2)
}

const LIMIT_MS = 2000
const ROUNDS = 6

async function device(): Promise<SupabaseClient> {
  const c = createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInAnonymously()
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`)
  // Make sure Realtime joins as this signed-in user (RLS decides which changes it may see).
  await c.realtime.setAuth(data.session!.access_token)
  return c
}

/** Subscribes to a campaign's character updates; returns a function that waits for `harm` to become a value. */
async function listen(c: SupabaseClient, cid: string, heroId: string) {
  const waiting = new Map<number, (t: number) => void>()
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('Realtime did not subscribe within 10s')), 10000)
    c.channel(`sync-${Math.random()}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'characters', filter: `campaign_id=eq.${cid}` },
        (p) => {
          const row = p.new as { id: string; harm: number }
          if (row.id === heroId) waiting.get(row.harm)?.(Date.now())
        })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); ok() }
      })
  })
  return (value: number) => new Promise<number>((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`no update for harm=${value} within 5s`)), 5000)
    waiting.set(value, (at) => { clearTimeout(t); ok(at) })
  })
}

async function main() {
  const gm = await device()
  const phoneA = await device()
  const phoneB = await device()
  const { data: created, error } = await gm.rpc('create_campaign',
    { p_name: 'Sync test (safe to delete)', p_passcode: 'sync-test-1234' })
  if (error) throw new Error(error.message)
  const { campaign_id: cid, join_code: code } = created[0] as { campaign_id: string; join_code: string }
  let failed = false
  try {
    const heroId = crypto.randomUUID()
    const ins = await gm.from('characters').insert({ id: heroId, campaign_id: cid, name: 'Sync hero' })
    if (ins.error) throw new Error(ins.error.message)
    for (const p of [phoneA, phoneB]) await p.rpc('join_campaign', { p_join_code: code })
    await phoneA.rpc('claim_character', { p_character_id: heroId })

    const onB = await listen(phoneB, cid, heroId)
    const onGm = await listen(gm, cid, heroId)
    const toB: number[] = []
    const toGm: number[] = []

    for (let i = 1; i <= ROUNDS; i++) {
      const b = onB(i)
      const g = onGm(i)
      const t0 = Date.now()
      const { error } = await phoneA.rpc('bump_character', { p_character_id: heroId, p_field: 'harm', p_delta: 1 })
      if (error) throw new Error(error.message)
      toB.push((await b) - t0)
      toGm.push((await g) - t0)
    }
    const report = (name: string, xs: number[]) => {
      const max = Math.max(...xs)
      const ok = max <= LIMIT_MS
      if (!ok) failed = true
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${xs.join(', ')} ms (max ${max}, limit ${LIMIT_MS})`)
    }
    report('player phone A -> player phone B', toB)
    report('player phone A -> GM', toGm)
  } finally {
    const { error } = await gm.from('campaigns').delete().eq('id', cid)
    if (error) console.warn(`cleanup failed: ${error.message}`)
  }
  console.log(failed ? '\nSync is slower than 2 seconds' : '\nChanges reach other devices within 2 seconds')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
