// Shared helpers for the scripts in supabase/tests (they run against the real project).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = dirname(fileURLToPath(import.meta.url))
export const repo = resolve(here, '../..')

const envFile = resolve(repo, 'web/.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
export const URL = process.env.VITE_SUPABASE_URL!
export const KEY = process.env.VITE_SUPABASE_KEY!
if (!URL || !KEY) {
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY (or fill in web/.env).')
  process.exit(2)
}

type DeviceOptions = Parameters<typeof createClient>[2]

/** A fresh anonymous device. */
export async function device(options: DeviceOptions = {}): Promise<SupabaseClient> {
  const c = createClient(URL, KEY, { ...options, auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await c.auth.signInAnonymously()
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`)
  await c.realtime.setAuth(data.session!.access_token)
  return c
}

let failures = 0
export function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}
export const failed = () => failures

export const demoHeroes = () =>
  JSON.parse(readFileSync(resolve(repo, 'supabase/seed/demo-heroes.json'), 'utf8')) as Record<string, unknown>[]

/** Creates a throwaway campaign as `gm`; returns its id and join code. */
export async function newCampaign(gm: SupabaseClient, name: string) {
  const { data, error } = await gm.rpc('create_campaign',
    { p_name: `${name} (safe to delete)`, p_passcode: `t-${Math.random().toString(36).slice(2, 12)}` })
  if (error) throw new Error(`create_campaign: ${error.message}`)
  return data[0] as { campaign_id: string; join_code: string }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
