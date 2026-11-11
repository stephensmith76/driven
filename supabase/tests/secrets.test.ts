/**
 * M3 check: the case file never appears in a player's network traffic (SPEC.md "Build order").
 *
 * A player device records every HTTP response body and every raw Realtime
 * frame it receives, while it does what the player screens do (read every
 * shared table, subscribe to live changes) and also tries the GM-only tables.
 * Meanwhile the GM writes a marker into the case file, the arc, GM notes,
 * enemies, a hidden clock, an encounter, the helper log and an import, and
 * reveals one clue. The marker must never reach the player; the revealed clue
 * must (that proves the recording works).
 *
 *   npm run test:secrets
 */
import { check, device, failed, newCampaign, sleep } from './lib'
import { applyPatch, exportCampaign, resolvePatch } from '../../web/src/data/campaignIO'

const SECRET = `SECRET-${Math.random().toString(36).slice(2, 10)}`
const REVEALED = `REVEALED-${Math.random().toString(36).slice(2, 10)}`

const seen: string[] = []

const recordingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  seen.push(await res.clone().text())
  return res
}

class RecordingWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)
    this.addEventListener('message', (e) => seen.push(typeof e.data === 'string' ? e.data : String(e.data)))
  }
}

async function main() {
  const gm = await device()
  const player = await device({
    global: { fetch: recordingFetch },
    realtime: { transport: RecordingWebSocket as unknown as typeof WebSocket },
  })
  const { campaign_id: cid, join_code: code } = await newCampaign(gm, 'Secrets test')
  try {
    const heroId = crypto.randomUUID()
    await gm.from('characters').insert({ id: heroId, campaign_id: cid, name: 'Rook' })
    await player.rpc('join_campaign', { p_join_code: code })
    await player.rpc('claim_character', { p_character_id: heroId })

    // The player listens to everything it can, including the GM-only tables.
    let subscribed = 0
    const tables = ['campaigns', 'characters', 'clocks', 'clues', 'scene', 'rolls', 'members',
      'gm_secrets', 'enemies', 'encounters', 'imports', 'helper_log']
    for (const table of tables) {
      player.channel(`spy-${table}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, () => {})
        .subscribe((s) => { if (s === 'SUBSCRIBED') subscribed++ })
    }
    player.channel('spy-all').on('postgres_changes', { event: '*', schema: 'public' }, () => {})
      .subscribe((s) => { if (s === 'SUBSCRIBED') subscribed++ })
    for (let i = 0; i < 40 && subscribed < tables.length + 1; i++) await sleep(250)

    // The GM writes secrets everywhere a secret can live...
    await gm.from('gm_secrets').update({
      case: { title: 'The Butcher', culprit: SECRET, clues: [{ id: 'k1', text: `${SECRET} unrevealed clue` }] },
      arc: { mastermind: SECRET }, notes: SECRET,
    }).eq('campaign_id', cid)
    await gm.from('enemies').insert({ campaign_id: cid, name: 'The Butcher', line: SECRET, harm_max: 10 })
    await gm.from('encounters').insert({ campaign_id: cid, name: SECRET })
    await gm.from('helper_log').insert({ campaign_id: cid, question: SECRET, answer: SECRET })
    await gm.from('clocks').insert({ campaign_id: cid, name: SECRET, kind: 'endgame', size: 8, visible_to_players: false })
    const patch = { format: 'street-level-patch/1', campaign: cid, note: SECRET,
      ops: [{ table: 'gm_secrets', merge: { notes: `${SECRET} again` } }] }
    await applyPatch(gm, cid, patch, resolvePatch(await exportCampaign(gm, cid), patch, cid))
    // ...shares a safe enemy summary, and reveals one clue.
    await gm.from('scene').update({ public_enemies: [{ name: 'The Butcher', zone: 'Kill Floor', state: 'fresh' }] }).eq('campaign_id', cid)
    await gm.from('clues').insert({ campaign_id: cid, text: REVEALED, night: 1 })
    await sleep(2500)

    // The player reads everything the player screens read, and tries the rest.
    for (const t of tables) {
      if (t === 'campaigns') await player.from(t).select('*').eq('id', cid)
      else await player.from(t).select('*').eq('campaign_id', cid)
    }
    await player.rpc('claim_gm', { p_campaign: code, p_passcode: 'wrong guess' })
    await sleep(500)

    const all = seen.join('\n')
    check(`player device subscribed to Realtime (${subscribed} channels)`, subscribed >= tables.length)
    check(`player recorded traffic (${seen.length} responses and frames)`, seen.length > 20)
    check('the revealed clue reached the player (recording works)', all.includes(REVEALED))
    check('the safe enemy summary reached the player', all.includes('Kill Floor'))
    check('no case file, arc, GM note, enemy, hidden clock, encounter, helper log or import reached the player',
      !all.includes(SECRET), `found "${SECRET}" in the player's traffic`)
    check('the passcode hash never reached the player', !all.includes('gm_code_hash') && !all.includes('$2a$'))
  } finally {
    const { error } = await gm.from('campaigns').delete().eq('id', cid)
    if (error) console.warn(`cleanup failed: ${error.message}`)
  }
  console.log(failed() ? `\n${failed()} check(s) failed` : '\nThe case file never reaches a player')
  process.exit(failed() ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
