/**
 * M6 check (SPEC.md "Build order" and "Rules helper box"): against the live Edge Function,
 * the three test questions each return a named roll, a defense number and two costs,
 * and a player account (and a stranger) is refused.
 *
 *   npm run test:helper
 *
 * Uses the real Gemini API, so it spends 3 of the campaign's daily questions. The
 * throwaway campaign is deleted afterwards. The answers are printed so you can read them.
 */
import { check, demoHeroes, device, failed, newCampaign, URL } from './lib'
import { defenseNumbers, type Hero, type RulesData } from '../functions/rules-helper/party'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { repo } from './lib'

const QUESTIONS = [
  'How do we sneak past the guards into a building?',
  'How do we save people from a burning building?',
  'Rook wants to throw a dumpster at the Butcher.',
]

const data = (f: string) => JSON.parse(readFileSync(resolve(repo, 'rules/data', f), 'utf8'))
const rules: RulesData = {
  defenseBase: data('core.json').defense_base, archetypes: data('archetypes.json'),
  gear: data('gear.json'), kit: data('kit.json'), powers: data('powers.json').powers,
}

async function ask(client: Awaited<ReturnType<typeof device>>, campaign_id: string, question: string, extra = {}) {
  const { data: session } = await client.auth.getSession()
  const res = await fetch(`${URL}/functions/v1/rules-helper`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', apikey: process.env.VITE_SUPABASE_KEY!,
      Authorization: `Bearer ${session.session!.access_token}`,
    },
    body: JSON.stringify({ campaign_id, question, ...extra }),
  })
  return { status: res.status, body: (await res.json()) as { answer?: string; error?: string } }
}

async function main() {
  const gm = await device()
  const player = await device()
  const stranger = await device()
  const { campaign_id: cid, join_code: code } = await newCampaign(gm, 'Helper test')
  try {
    const heroes = demoHeroes()
    const { error } = await gm.from('characters').insert(heroes.map((h) => ({ ...h, campaign_id: cid })))
    if (error) throw new Error(`seeding heroes: ${error.message}`)
    await player.rpc('join_campaign', { p_join_code: code })

    const names = heroes.map((h) => String(h.name))
    const numbers = heroes.flatMap((h) => Object.values(defenseNumbers(h as unknown as Hero, rules)))
    for (const q of QUESTIONS) {
      const { status, body } = await ask(gm, cid, q)
      const a = body.answer ?? ''
      console.log(`\n> ${q}\n${status === 200 ? a : `(${status}) ${body.error}`}\n`)
      check(`GM gets an answer: "${q}"`, status === 200 && a.length > 0, `${status} ${body.error ?? ''}`)
      check('  names a roll (a hero and a stat)', names.some((n) => a.includes(n)) && /(Force|Flow|Focus|Presence)/.test(a))
      const against = [...a.matchAll(/against\s+(?:a\s+|the\s+)?(?:\w+\s+)?(\d{2})\b|\b(?:Guard|Wits|Poise|defense)\s*(?:of\s*)?(\d{2})\b/gi)]
        .map((m) => Number(m[1] ?? m[2]))
      check('  gives a defense number', against.length > 0 && against.every((n) => n >= 10 && n <= 25),
        `found ${JSON.stringify(against)}; party defenses are ${[...new Set(numbers)].join(', ')}`)
      check('  offers two costs', /cost/i.test(a) && /Impact 1/i.test(a) && (/\bor\b/i.test(a) || /\b(1\)|2\)|first|second)\b/i.test(a)))
      check('  says what a Miss means', /miss/i.test(a))
      check('  under about 150 words', a.split(/\s+/).length <= 190, `${a.split(/\s+/).length} words`)
    }

    // The GM can also ask with the scene and case file attached.
    const withCtx = await ask(gm, cid, 'Sneak past the guards.', { include_scene: true, include_case: true })
    check('GM can attach the scene and case file', withCtx.status === 200, `${withCtx.status} ${withCtx.body.error ?? ''}`)

    // Refusals: a player in this campaign, a stranger, no token, bad input.
    const p = await ask(player, cid, QUESTIONS[0])
    check('a player account is refused (403)', p.status === 403, `${p.status} ${p.body.error ?? ''}`)
    check('a player never sees an answer', !p.body.answer)
    const s = await ask(stranger, cid, QUESTIONS[0])
    check('a stranger is refused (403)', s.status === 403, `${s.status}`)
    const anon = await fetch(`${URL}/functions/v1/rules-helper`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: process.env.VITE_SUPABASE_KEY! },
      body: JSON.stringify({ campaign_id: cid, question: 'hi' }),
    })
    check('a request with no sign-in is refused (401)', anon.status === 401, `${anon.status}`)
    const long = await ask(gm, cid, 'x'.repeat(501))
    check('a 501-character question is rejected (400)', long.status === 400, `${long.status}`)

    const { data: log } = await gm.from('helper_log').select('question, model').eq('campaign_id', cid)
    check('the GM questions and answers are saved to helper_log', (log?.length ?? 0) === QUESTIONS.length + 1, `${log?.length} rows`)
    const { data: pLog } = await player.from('helper_log').select('id').eq('campaign_id', cid)
    check('a player cannot read helper_log', (pLog?.length ?? 0) === 0)
  } finally {
    const { error } = await gm.from('campaigns').delete().eq('id', cid)
    if (error) console.warn(`cleanup failed: ${error.message}`)
  }
  console.log(failed() ? `\n${failed()} check(s) failed` : '\nThe rules helper answers the GM and refuses everyone else')
  process.exit(failed() ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
