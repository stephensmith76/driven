/**
 * M4 check, the live half (SPEC.md "Build order"): app rolls and manual rolls both reach every device.
 *
 * A player rolls with app dice (the same engine and row builder the roller uses), the GM logs a roll
 * typed in from real dice, and a second player's phone and the GM's screen listen on Realtime. Each
 * must see every roll within 2 seconds. Then the access rules around rolls and enemies:
 * a player can't roll for someone else's hero or delete a roll, a stranger reads nothing,
 * and what players see of an enemy is only the safe summary.
 *
 *   npm run test:dice
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { check, device, failed, newCampaign, sleep } from './lib'
import { evaluate, publicEnemy, rollDice, rollRow, enemyFromLibrary, VILLAINS, type RollSetup } from '../../web/src/engine'

const LIMIT_MS = 2000

type Heard = { rolls: Map<string, number>; on: (id: string) => Promise<number> }

/** Listens to roll inserts for a campaign; `on(id)` resolves with the time the roll arrived. */
async function listen(c: SupabaseClient, cid: string): Promise<Heard> {
  const rolls = new Map<string, number>()
  const waiting = new Map<string, (t: number) => void>()
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('Realtime did not subscribe within 10s')), 10000)
    c.channel(`dice-${Math.random()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rolls', filter: `campaign_id=eq.${cid}` }, (p) => {
        const id = (p.new as { id: string }).id
        const now = Date.now()
        rolls.set(id, now)
        waiting.get(id)?.(now)
      })
      .subscribe((s) => { if (s === 'SUBSCRIBED') { clearTimeout(timer); ok() } })
  })
  const on = (id: string) => new Promise<number>((ok, fail) => {
    if (rolls.has(id)) return ok(rolls.get(id)!)
    const t = setTimeout(() => fail(new Error(`roll ${id} did not arrive within 5s`)), 5000)
    waiting.set(id, (at) => { clearTimeout(t); ok(at) })
  })
  return { rolls, on }
}

async function main() {
  const gm = await device()
  const phoneA = await device()
  const phoneB = await device()
  const stranger = await device()
  const { campaign_id: cid, join_code: code } = await newCampaign(gm, 'Dice test')
  try {
    const rook = crypto.randomUUID()
    const nightjar = crypto.randomUUID()
    for (const [id, name] of [[rook, 'Rook'], [nightjar, 'Nightjar']]) {
      const { error } = await gm.from('characters').insert({ id, campaign_id: cid, name })
      if (error) throw new Error(error.message)
    }
    for (const p of [phoneA, phoneB]) await p.rpc('join_campaign', { p_join_code: code })
    await phoneA.rpc('claim_character', { p_character_id: rook })
    await phoneB.rpc('claim_character', { p_character_id: nightjar })

    const onB = await listen(phoneB, cid)
    const onGm = await listen(gm, cid)
    const onA = await listen(phoneA, cid)
    await sleep(1500) // let Realtime finish wiring the three listeners

    // ---- an app roll from a player's phone
    const setup: RollSetup = { bonus: 4, edge: true, advantage: false, disadvantage: false, jab: false, defense: 12 }
    const appResult = evaluate(setup, rollDice(0))
    const appRow = rollRow({ actorName: 'Rook', characterId: rook, label: 'Haymaker on the Butcher', stat: 'force', setup, result: appResult, mode: 'app' })
    const appId = crypto.randomUUID()
    const t0 = Date.now()
    const ins = await phoneA.from('rolls').insert({ id: appId, campaign_id: cid, ...appRow })
    check('a player can add an app roll for their own hero', !ins.error, ins.error?.message)
    const [toB, toGm] = [(await onB.on(appId)) - t0, (await onGm.on(appId)) - t0]
    check(`app roll reaches the other phone in under 2s (${toB} ms)`, toB <= LIMIT_MS)
    check(`app roll reaches the GM in under 2s (${toGm} ms)`, toGm <= LIMIT_MS)

    // ---- a manual roll typed in by the GM from real dice (a Saint's pistol at Rook)
    const gmSetup: RollSetup = { bonus: 2, edge: false, advantage: false, disadvantage: false, jab: false, defense: 12 }
    const typed = evaluate(gmSetup, [9, 7])
    const manualRow = rollRow({ actorName: 'Saints', characterId: null, label: 'Pistol at Rook', stat: 'attack', setup: gmSetup, result: typed, mode: 'manual' })
    const manualId = crypto.randomUUID()
    const t1 = Date.now()
    const ins2 = await gm.from('rolls').insert({ id: manualId, campaign_id: cid, ...manualRow })
    check('the GM can add a manual roll for an enemy', !ins2.error, ins2.error?.message)
    const [mA, mB] = [(await onA.on(manualId)) - t1, (await onB.on(manualId)) - t1]
    check(`manual roll reaches phone A in under 2s (${mA} ms)`, mA <= LIMIT_MS)
    check(`manual roll reaches phone B in under 2s (${mB} ms)`, mB <= LIMIT_MS)

    // ---- what each device stored
    const { data: stored } = await phoneB.from('rolls').select('*').eq('campaign_id', cid).order('at')
    const app = stored?.find((r) => r.id === appId)
    const man = stored?.find((r) => r.id === manualId)
    check('the app roll is stored with its dice, total, margin, Impact and mode',
      app?.mode === 'app' && app.total === appResult.total && app.margin === appResult.margin && app.impact === appResult.impact
      && app.dice.length === 2 && app.rules_version != null)
    check('the manual roll is stored as 18 vs 12, margin 6, Impact 2, mode manual',
      man?.mode === 'manual' && man.total === 18 && man.margin === 6 && man.impact === 2)

    // ---- access
    const other = await phoneA.from('rolls').insert({ campaign_id: cid, ...manualRow, character_id: nightjar })
    check("a player can't roll for another player's hero", Boolean(other.error))
    const noHero = await phoneA.from('rolls').insert({ campaign_id: cid, ...manualRow, character_id: null })
    check("a player can't add a roll that belongs to nobody (enemy rolls are the GM's)", Boolean(noHero.error))
    const delByPlayer = await phoneA.from('rolls').delete().eq('id', appId).select()
    check("a player can't delete a roll", (delByPlayer.data ?? []).length === 0)
    const strangerRead = await stranger.from('rolls').select('id').eq('campaign_id', cid)
    check('a stranger reads no rolls', (strangerRead.data ?? []).length === 0)
    const delByGm = await gm.from('rolls').delete().eq('id', manualId).select()
    check('the GM can delete a roll', (delByGm.data ?? []).length === 1)

    // ---- the database keeps the log honest (needs the M4 migration)
    const bad = await phoneA.from('rolls').insert({ campaign_id: cid, ...appRow, dice: [11, 3] })
    check('a die outside 1 to 10 is refused (run `supabase db push` for the M4 migration if this fails)', Boolean(bad.error))
    const four = await phoneA.from('rolls').insert({ campaign_id: cid, ...appRow, dice: [1, 2, 3, 4] })
    check('four dice are refused', Boolean(four.error))

    // ---- enemies: GM only, and players get only the safe summary
    const butcher = VILLAINS.villains.find((v) => v.id === 'the-butcher')!
    const secretLine = `SECRET-${Math.random().toString(36).slice(2, 10)}`
    const zoneId = 'dock'
    const draft = { ...enemyFromLibrary(butcher), line: secretLine, zone: zoneId, harm: 6 }
    const insE = await gm.from('enemies').insert({ campaign_id: cid, ...draft }).select().single()
    check('the GM can add an enemy', !insE.error, insE.error?.message)
    const peek = await phoneA.from('enemies').select('*').eq('campaign_id', cid)
    check('a player reads no enemies', (peek.data ?? []).length === 0)
    const sneak = await phoneA.from('enemies').insert({ campaign_id: cid, name: 'Cheat' })
    check("a player can't add an enemy", Boolean(sneak.error))

    const summary = [publicEnemy(insE.data!)]
    const wr = await gm.from('scene').update({ public_enemies: summary }).eq('campaign_id', cid)
    check('the GM can publish the safe summary to the scene', !wr.error, wr.error?.message)
    await sleep(300)
    const { data: scene } = await phoneA.from('scene').select('public_enemies').eq('campaign_id', cid).single()
    const text = JSON.stringify(scene?.public_enemies)
    check('players see the enemy: name, zone and a rough state',
      scene?.public_enemies?.[0]?.name === butcher.name && scene.public_enemies[0].zone === zoneId && scene.public_enemies[0].state === 'badly hurt')
    check('players see no numbers or notes about it', !text.includes(secretLine) && !/harm|toughness|drive|stress|guard|wits|poise/i.test(text), text)
  } finally {
    const { error } = await gm.from('campaigns').delete().eq('id', cid)
    if (error) console.warn(`cleanup failed: ${error.message}`)
  }
  console.log(failed() ? `\n${failed()} check(s) failed` : '\nApp and manual rolls reach every device; the access rules hold')
  process.exit(failed() ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
