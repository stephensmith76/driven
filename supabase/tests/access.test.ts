/**
 * Access test (SPEC.md "Access, roles and secrets").
 * Signs in as a stranger, a player and a GM against the real project and
 * proves each row of the "Who can do what" table. Cleans up after itself.
 *
 *   npm run test:access
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_KEY from the environment or web/.env.
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
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY (or fill in web/.env).')
  process.exit(2)
}

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

async function device(): Promise<SupabaseClient> {
  const c = createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInAnonymously()
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`)
  return c
}

async function count(c: SupabaseClient, table: string, cid: string) {
  const { data, error } = await c.from(table).select('id').eq('campaign_id', cid)
  return error ? -1 : (data?.length ?? 0)
}

const GM_ONLY = ['gm_secrets', 'enemies', 'encounters', 'imports', 'helper_log']
const SHARED = ['clues', 'scene', 'rolls', 'characters', 'clocks']

async function main() {
  const gm = await device()
  const player = await device()
  const stranger = await device()
  const passcode = `test-${Math.random().toString(36).slice(2, 10)}`

  // ---- GM sets up a campaign with one of everything
  const { data: created, error: cErr } = await gm.rpc('create_campaign',
    { p_name: 'Access test (safe to delete)', p_passcode: passcode })
  if (cErr) throw new Error(`create_campaign: ${cErr.message}`)
  const { campaign_id: cid, join_code: code } = created[0] as { campaign_id: string; join_code: string }

  try {
    const { data: heroes, error: hErr } = await gm.from('characters')
      .insert([{ campaign_id: cid, name: 'Hero A' }, { campaign_id: cid, name: 'Hero B' }]).select('id')
    if (hErr) throw new Error(`insert characters: ${hErr.message}`)
    const [heroA, heroB] = heroes!.map((h) => h.id as string)

    check('GM writes gm_secrets', !(await gm.from('gm_secrets')
      .update({ case: { culprit: 'The Butcher' } }).eq('campaign_id', cid)).error)
    for (const [t, row] of [
      ['enemies', { campaign_id: cid, name: 'Saints' }],
      ['encounters', { campaign_id: cid, name: 'Pier' }],
      ['imports', { campaign_id: cid, patch: {} }],
      ['helper_log', { campaign_id: cid, question: 'q' }],
      ['clues', { campaign_id: cid, text: 'A rag' }],
      ['clocks', { campaign_id: cid, name: 'Hidden', visible_to_players: false }],
      ['rolls', { campaign_id: cid, label: 'GM roll' }],
    ] as const) {
      const { error } = await gm.from(t).insert(row)
      check(`GM inserts ${t}`, !error, error?.message)
    }

    // ---- Stranger: signed in, not a member -> reads nothing, writes nothing
    for (const t of ['campaigns', ...SHARED, ...GM_ONLY, 'members']) {
      const n = t === 'campaigns'
        ? ((await stranger.from(t).select('id').eq('id', cid)).data?.length ?? 0)
        : await count(stranger, t, cid)
      check(`stranger reads nothing from ${t}`, n <= 0, `got ${n}`)
    }
    const sIns = await stranger.from('rolls').insert({ campaign_id: cid, label: 'x' })
    check('stranger cannot add a roll', !!sIns.error)
    const sUpd = await stranger.from('characters').update({ harm: 3 }).eq('id', heroA).select('id')
    check('stranger cannot edit a character', !!sUpd.error || (sUpd.data?.length ?? 0) === 0)
    const sGm = await stranger.rpc('claim_gm', { p_campaign: code, p_passcode: 'wrong' })
    check('wrong passcode does not make a GM', !!sGm.error)
    const sMem = await stranger.from('members').insert({ campaign_id: cid, user_id: (await stranger.auth.getUser()).data.user!.id, role: 'gm' })
    check('stranger cannot insert a members row directly', !!sMem.error)

    // ---- Player joins and claims Hero A
    const j = await player.rpc('join_campaign', { p_join_code: code.toLowerCase() })
    check('player joins by code', !j.error && j.data === cid, j.error?.message)
    const cl = await player.rpc('claim_character', { p_character_id: heroA })
    check('player claims a hero', !cl.error, cl.error?.message)

    check('player reads campaign', ((await player.from('campaigns').select('id').eq('id', cid)).data?.length ?? 0) === 1)
    for (const t of ['clues', 'scene', 'rolls']) check(`player reads ${t}`, (await count(player, t, cid)) >= 1)
    check('player reads all characters (default setting)', (await count(player, 'characters', cid)) === 2)
    const clocks = (await player.from('clocks').select('name').eq('campaign_id', cid)).data ?? []
    check('player sees visible clocks only', clocks.length === 2 && !clocks.some((c) => c.name === 'Hidden'),
      JSON.stringify(clocks))
    for (const t of GM_ONLY) check(`player reads nothing from ${t}`, (await count(player, t, cid)) <= 0)

    const own = await player.from('characters').update({ harm: 2 }).eq('id', heroA).select('harm')
    check('player edits own hero', !own.error && own.data?.[0]?.harm === 2, own.error?.message)
    const other = await player.from('characters').update({ harm: 2 }).eq('id', heroB).select('id')
    check('player cannot edit another hero', !!other.error || (other.data?.length ?? 0) === 0)
    const lock = await player.from('characters').update({ locked: true }).eq('id', heroA)
    check('player cannot lock/unlock own hero', !!lock.error)

    const r1 = await player.from('rolls').insert({ campaign_id: cid, character_id: heroA, label: 'mine' })
    check('player adds a roll for own hero', !r1.error, r1.error?.message)
    const r2 = await player.from('rolls').insert({ campaign_id: cid, character_id: heroB, label: 'not mine' })
    check('player cannot add a roll for another hero', !!r2.error)
    const rd = await player.from('rolls').delete().eq('campaign_id', cid).select('id')
    check('player cannot delete rolls', !!rd.error || (rd.data?.length ?? 0) === 0)

    for (const [t, patch] of [['clues', { text: 'x' }], ['scene', { title: 'x' }], ['clocks', { filled: 3 }]] as const) {
      const u = await player.from(t).update(patch).eq('campaign_id', cid).select('id')
      check(`player cannot write ${t}`, !!u.error || (u.data?.length ?? 0) === 0)
    }
    const pc = await player.from('campaigns').update({ night: 9 }).eq('id', cid).select('id')
    check('player cannot write campaigns', !!pc.error || (pc.data?.length ?? 0) === 0)
    const pm = await player.from('members').update({ role: 'gm' }).eq('campaign_id', cid).select('id')
    check('player cannot promote themselves', !!pm.error || (pm.data?.length ?? 0) === 0)

    // Setting: players can't see other sheets -> only their own
    await gm.from('campaigns').update({ settings: { players_can_build: true, players_see_sheets: false } }).eq('id', cid)
    check('with sheets hidden, player reads only own hero', (await count(player, 'characters', cid)) === 1)

    // ---- GM: a second device with the passcode becomes GM
    const gm2 = await device()
    const g = await gm2.rpc('claim_gm', { p_campaign: code, p_passcode: passcode })
    check('passcode makes a second device GM', !g.error && g.data === cid, g.error?.message)
    for (const t of GM_ONLY) check(`GM reads ${t}`, (await count(gm2, t, cid)) === 1)
    check('GM reads hidden clocks', (await count(gm2, 'clocks', cid)) === 3)
    const gd = await gm2.from('rolls').delete().eq('campaign_id', cid).select('id')
    check('GM deletes rolls', !gd.error && (gd.data?.length ?? 0) === 2, gd.error?.message)
    const gk = await gm2.from('campaigns').select('*').eq('id', cid).single()
    check('passcode hash is not readable even by the GM', !gk.error && !('gm_code_hash' in (gk.data ?? {})))
  } finally {
    const { error } = await gm.from('campaigns').delete().eq('id', cid)
    if (error) console.warn(`cleanup failed: ${error.message}`)
  }

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll access checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
