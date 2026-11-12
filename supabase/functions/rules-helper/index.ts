// Edge Function `rules-helper` (SPEC.md "Rules helper box").
// Only the campaign's GM may call it. The Gemini key is the GEMINI_API_KEY secret and never leaves here.
// Secrets: GEMINI_API_KEY (required); GEMINI_MODEL (default below); HELPER_DAILY_CAP (default 60);
// RULES_BASE_URL (default: the published site).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { partySummary, SYSTEM_INSTRUCTION, type Hero, type RulesData } from './party.ts'

const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite'
const DAILY_CAP = Number(Deno.env.get('HELPER_DAILY_CAP') || 60)
const BASE = (Deno.env.get('RULES_BASE_URL') || 'https://stephensmith76.github.io/driven/').replace(/\/?$/, '/')
const MAX_QUESTION = 500
const TIMEOUT_MS = 20_000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// rules.md and the data files, kept in memory and reloaded when rules_version changes.
type Rules = { version: string; text: string; data: RulesData }
let cache: Rules | null = null
const getJson = async (p: string) => {
  const r = await fetch(BASE + p)
  if (!r.ok) throw new Error(`could not load ${p} (${r.status})`)
  return r.json()
}
async function loadRules(): Promise<Rules> {
  const core = await getJson('rules/data/core.json')
  if (cache && cache.version === core.rules_version) return cache
  const [md, archetypes, gear, powers] = await Promise.all([
    fetch(BASE + 'rules/rules.md').then((r) => {
      if (!r.ok) throw new Error(`could not load rules.md (${r.status})`)
      return r.text()
    }),
    getJson('rules/data/archetypes.json'), getJson('rules/data/gear.json'),
    getJson('rules/data/powers.json'),
  ])
  cache = {
    version: core.rules_version, text: md,
    data: { defenseBase: core.defense_base, archetypes, gear, powers: powers.powers },
  }
  return cache
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'POST only' })

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return reply(500, { error: 'The rules helper is not set up: GEMINI_API_KEY is missing.' })

  let body: { campaign_id?: string; question?: string; include_scene?: boolean; include_case?: boolean }
  try { body = await req.json() } catch { return reply(400, { error: 'Send JSON.' }) }
  const question = (body.question ?? '').trim()
  if (!body.campaign_id) return reply(400, { error: 'campaign_id is required.' })
  if (!question) return reply(400, { error: 'Type a question first.' })
  if (question.length > MAX_QUESTION) return reply(400, { error: `Keep the question under ${MAX_QUESTION} characters.` })

  // Everything below runs as the caller, so row-level security is the access check.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: who } = await db.auth.getUser()
  if (!who?.user) return reply(401, { error: 'Not signed in.' })
  const { data: member } = await db.from('members').select('role')
    .eq('campaign_id', body.campaign_id).eq('user_id', who.user.id).maybeSingle()
  if (member?.role !== 'gm') return reply(403, { error: 'Only the GM of this campaign can use the rules helper.' })

  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { count } = await db.from('helper_log').select('id', { count: 'exact', head: true })
    .eq('campaign_id', body.campaign_id).gte('at', since)
  if ((count ?? 0) >= DAILY_CAP) {
    return reply(429, { error: `Daily limit of ${DAILY_CAP} questions reached for this campaign. Try again tomorrow.` })
  }

  let rules: Rules
  try { rules = await loadRules() } catch (e) { return reply(502, { error: `Could not load the rules: ${(e as Error).message}` }) }

  const { data: heroes } = await db.from('characters')
    .select('name, archetype_id, stats, loadout, harm, stress, drive, dying, is_npc')
    .eq('campaign_id', body.campaign_id).eq('is_npc', false).order('name')
  let context = `PARTY\n${partySummary((heroes ?? []) as Hero[], rules.data) || '(no heroes yet)'}`
  if (body.include_scene) {
    const [{ data: scene }, { data: enemies }] = await Promise.all([
      db.from('scene').select('title, text, zones, positions').eq('campaign_id', body.campaign_id).maybeSingle(),
      db.from('enemies').select('name, kind, defenses, toughness, harm, harm_max, count, count_max, zone')
        .eq('campaign_id', body.campaign_id),
    ])
    context += `\n\nSCENE\n${JSON.stringify({ scene, enemies })}`
  }
  if (body.include_case) {
    const { data: secrets } = await db.from('gm_secrets').select('case, arc').eq('campaign_id', body.campaign_id).maybeSingle()
    context += `\n\nCASE FILE (hidden from players; use it only to advise the GM)\n${JSON.stringify(secrets)}`
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  let answer = ''
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${SYSTEM_INSTRUCTION}\n\nRULES (version ${rules.version})\n${rules.text}` }] },
        contents: [{ role: 'user', parts: [{ text: `${context}\n\nQUESTION\n${question}` }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
      }),
    })
    if (!res.ok) {
      console.error('gemini', res.status, (await res.text()).slice(0, 300))
      return reply(502, { error: res.status === 429 ? 'Gemini is rate limiting us. Retry in a minute.' : `Gemini returned an error (${res.status}). Retry.` })
    }
    const j = await res.json()
    answer = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim()
    if (!answer) return reply(502, { error: 'Gemini returned no answer. Retry, or rephrase.' })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    return reply(aborted ? 504 : 502, { error: aborted ? 'The helper took longer than 20 seconds. Retry.' : 'Could not reach Gemini. Retry.' })
  } finally { clearTimeout(timer) }

  await db.from('helper_log').insert({ campaign_id: body.campaign_id, question, answer, model: MODEL })
  return reply(200, { answer, model: MODEL, remaining: Math.max(0, DAILY_CAP - (count ?? 0) - 1) })
})
