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

const GM_ONLY = ['gm_secrets', 'enemies', 'encounters', 'imports', 'helper_log', 'night_snapshots']
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

    // New campaigns start with the clock sizes in rules/data/core.json (which match rules.md).
    const core = JSON.parse(readFileSync(resolve(here, '../../rules/data/core.json'), 'utf8')) as
      { clocks: { kind: string; size: number }[] }
    const startClocks = (await gm.from('clocks').select('kind, size').eq('campaign_id', cid)).data ?? []
    for (const kind of ['scheme', 'heat']) {
      check(`new campaign's ${kind} clock matches the rules data`,
        startClocks.find((c) => c.kind === kind)?.size === core.clocks.find((c) => c.kind === kind)?.size,
        JSON.stringify(startClocks))
    }

    check('GM writes gm_secrets', !(await gm.from('gm_secrets')
      .update({ case: { culprit: 'The Butcher' } }).eq('campaign_id', cid)).error)
    for (const [t, row] of [
      ['enemies', { campaign_id: cid, name: 'Saints' }],
      ['encounters', { campaign_id: cid, name: 'Pier' }],
      ['imports', { campaign_id: cid, patch: {} }],
      ['helper_log', { campaign_id: cid, question: 'q' }],
      ['night_snapshots', { campaign_id: cid, night: 2, state: {} }],
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

    // ---- M2: sheet functions and the GM's lock
    const heroRow = async (c: SupabaseClient, id: string) =>
      (await c.from('characters').select('*').eq('id', id).single()).data as Record<string, any> | null

    const hi = await player.rpc('bump_character', { p_character_id: heroA, p_field: 'stress', p_delta: 20 })
    check('bump_character clamps Stress at 8', !hi.error && hi.data === 8, hi.error?.message)
    const lo = await player.rpc('bump_character', { p_character_id: heroA, p_field: 'stress', p_delta: -99 })
    check('bump_character clamps Stress at 0', !lo.error && lo.data === 0)
    const otherBump = await player.rpc('bump_character', { p_character_id: heroB, p_field: 'drive', p_delta: 1 })
    check('player cannot bump another hero', !!otherBump.error || otherBump.data === null)
    const badField = await player.rpc('bump_character', { p_character_id: heroA, p_field: 'locked', p_delta: 1 })
    check('bump_character rejects unknown trackers', !!badField.error)

    await player.rpc('set_fight_flag', { p_character_id: heroA, p_key: 'uses:taser', p_value: 1 })
    await player.rpc('set_fight_flag', { p_character_id: heroA, p_key: 'second_wind_used', p_value: true })
    await player.rpc('set_fight_flag', { p_character_id: heroA, p_key: 'dawn', p_value: { night: 1 } })
    let fs = (await heroRow(player, heroA))?.fight_state ?? {}
    check('set_fight_flag sets keys', fs['uses:taser'] === 1 && fs.second_wind_used === true, JSON.stringify(fs))
    await player.rpc('new_fight', { p_character_id: heroA })
    fs = (await heroRow(player, heroA))?.fight_state ?? {}
    check('new_fight clears per-fight flags but keeps the Dawn record',
      !('uses:taser' in fs) && !('second_wind_used' in fs) && fs.dawn?.night === 1, JSON.stringify(fs))
    await player.rpc('set_fight_flag', { p_character_id: heroB, p_key: 'second_wind_used', p_value: true })
    check('player cannot set flags on another hero',
      !('second_wind_used' in ((await heroRow(gm, heroB))?.fight_state ?? {})))

    await player.from('characters').update({ loadout: [{ kind: 'gear', id: 'knife' }] }).eq('id', heroA)
    await player.rpc('set_kit', { p_character_id: heroA, p_ids: ['smoke', 'taser'] })
    const kitLoadout = (await heroRow(player, heroA))?.loadout ?? []
    check('set_kit replaces Kit picks and keeps gear',
      kitLoadout.length === 3 && kitLoadout[0].id === 'knife' && kitLoadout[1].kind === 'kit' && kitLoadout[2].id === 'taser',
      JSON.stringify(kitLoadout))

    await gm.from('characters').update({ locked: true }).eq('id', heroA)
    const lockedStats = await player.from('characters')
      .update({ stats: { force: 4, flow: 4, focus: 4, presence: 4 } }).eq('id', heroA)
    check('locked: player cannot change stats', !!lockedStats.error)
    const lockedGear = await player.from('characters')
      .update({ loadout: [{ kind: 'gear', id: 'tactical-armor' }] }).eq('id', heroA)
    check('locked: player cannot change gear', !!lockedGear.error)
    const lockedName = await player.from('characters').update({ name: 'Renamed' }).eq('id', heroA)
    check('locked: player cannot rename', !!lockedName.error)
    const lockedBump = await player.rpc('bump_character', { p_character_id: heroA, p_field: 'harm', p_delta: 1 })
    check('locked: trackers still work', !lockedBump.error && lockedBump.data !== null, lockedBump.error?.message)
    const lockedNotes = await player.from('characters').update({ notes: 'still playing' }).eq('id', heroA)
    check('locked: notes still work', !lockedNotes.error)
    const lockedKit = await player.rpc('set_kit', { p_character_id: heroA, p_ids: ['armor'] })
    check('locked: Kit picks still work', !lockedKit.error)
    const gmEdit = await gm.from('characters').update({ name: 'GM renamed' }).eq('id', heroA)
    check('locked: the GM can still edit', !gmEdit.error)
    await gm.from('characters').update({ locked: false, name: 'Hero A', harm: 2 }).eq('id', heroA)

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
