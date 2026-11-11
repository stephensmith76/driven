/**
 * The demo campaign seed (supabase/seed/butcher_case.json) against the real project:
 * a GM device seeds a new campaign exactly as "Create campaign" with Demo does, then
 * sets up the Cannery scene the way the Case file's Scenes button does. A player who
 * joins sees the heroes, the visible clocks and the scene, and none of the hidden case.
 *
 *   npm run test:demo
 */
import { check, device, failed, newCampaign } from './lib'
import { demoCase, seedDemoCampaign } from '../../web/src/data/demoSeed'
import { setUpScene } from '../../web/src/data/fight'

async function main() {
  const gm = await device()
  const player = await device()
  const { campaign_id: cid, join_code: code } = await newCampaign(gm, 'Demo seed test')
  try {
    await seedDemoCampaign(cid, gm)

    const heroes = (await gm.from('characters').select('name, flair_ids').eq('campaign_id', cid)).data ?? []
    check('five heroes', heroes.length === 5, heroes.map((h) => h.name).join(', '))
    check('the Ledger has Connected', heroes.find((h) => h.name === 'The Ledger')?.flair_ids?.includes('connected') === true)

    const secrets = (await gm.from('gm_secrets').select('case, arc, notes').eq('campaign_id', cid).single()).data
    check('case file saved', secrets?.case?.title === 'The Butcher of Fifth Street' && secrets.case.clues.length === 18)
    check('arc and notes saved', secrets?.arc?.mastermind === 'Augustine Voss' && /Meat hook/.test(secrets?.notes ?? ''))

    const clocks = (await gm.from('clocks').select('name, visible_to_players').eq('campaign_id', cid)).data ?? []
    check('clocks: Scheme, Heat, Annex collapses, Hostage',
      ['Scheme', 'Heat', 'Annex collapses', 'Hostage'].every((n) => clocks.some((c) => c.name === n)), clocks.map((c) => c.name).join(', '))

    let scene = (await gm.from('scene').select('title, zones, public_enemies').eq('campaign_id', cid).single()).data
    check('opening scene set up', scene?.title === 'The Calloway Annex is on fire' && scene.zones.length === 4)
    let enemies = (await gm.from('enemies').select('name, zone').eq('campaign_id', cid)).data ?? []
    check('opening: one Saints group in the alley', enemies.length === 1 && enemies[0].zone === 'alley')

    await setUpScene(cid, demoCase().scenes![1], gm)
    scene = (await gm.from('scene').select('title, zones, public_enemies').eq('campaign_id', cid).single()).data
    enemies = (await gm.from('enemies').select('name, zone').eq('campaign_id', cid)).data ?? []
    check('Cannery set up: the Butcher on the Kill Floor, Saints at the dock',
      scene?.title === 'The Tidewater Cannery' && enemies.length === 2
      && enemies.some((e) => e.zone === 'killfloor') && enemies.some((e) => e.zone === 'dock'))
    check('players get a safe enemy summary', scene?.public_enemies?.length === 2
      && scene.public_enemies.every((e: Record<string, unknown>) => !('harm' in e) && !('line' in e)))

    // The player's view.
    await player.rpc('join_campaign', { p_join_code: code })
    const pHeroes = (await player.from('characters').select('id').eq('campaign_id', cid)).data ?? []
    const pClocks = (await player.from('clocks').select('name').eq('campaign_id', cid)).data ?? []
    const pSecrets = (await player.from('gm_secrets').select('*').eq('campaign_id', cid)).data ?? []
    const pEnemies = (await player.from('enemies').select('*').eq('campaign_id', cid)).data ?? []
    const pScene = (await player.from('scene').select('title').eq('campaign_id', cid)).data ?? []
    check('player sees the five heroes', pHeroes.length === 5)
    check('player sees Scheme, Heat and Annex collapses, not Hostage',
      pClocks.length === 3 && !pClocks.some((c) => c.name === 'Hostage'), pClocks.map((c) => c.name).join(', '))
    check('player reads no case file and no enemy rows', pSecrets.length === 0 && pEnemies.length === 0)
    check('player sees the scene', pScene[0]?.title === 'The Tidewater Cannery')
  } finally {
    const { error } = await gm.from('campaigns').delete().eq('id', cid)
    if (error) console.warn(`cleanup failed: ${error.message}`)
  }
  console.log(failed() ? `\n${failed()} check(s) failed` : '\nThe demo seed loads, and the hidden parts stay hidden')
  process.exit(failed() ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
