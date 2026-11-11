// Export, patch import and undo (SPEC.md "How Claude updates the app").
// Takes the Supabase client as an argument (no page globals), so the test
// scripts in supabase/tests can use exactly this code.
import type { SupabaseClient } from '@supabase/supabase-js'

export const EXPORT_FORMAT = 'street-level-export/1'
export const PATCH_FORMAT = 'street-level-patch/1'

type Row = Record<string, unknown> & { id: string }

export type CampaignExport = {
  format: typeof EXPORT_FORMAT
  exported_at: string
  rules_version: string | null
  campaign: Row
  members: Row[]
  characters: Row[]
  clocks: Row[]
  clues: Row[]
  scene: Row[]
  rolls: Row[]
  gm_secrets: Row[]
  enemies: Row[]
  encounters: Row[]
  imports: Row[]
  helper_log: Row[]
}

const CAMPAIGN_TABLES = ['members', 'characters', 'clocks', 'clues', 'scene', 'rolls',
  'gm_secrets', 'enemies', 'encounters', 'imports', 'helper_log'] as const

/** Every table for the campaign, the GM-only ones included. GM only (RLS returns nothing hidden to anyone else). */
export async function exportCampaign(client: SupabaseClient, campaignId: string): Promise<CampaignExport> {
  const { data: campaign, error } = await client.from('campaigns')
    .select('id, name, join_code, rules_version, night, phase, settings, created_at, updated_at')
    .eq('id', campaignId).single()
  if (error) throw error
  const out: Record<string, unknown> = {
    format: EXPORT_FORMAT,
    exported_at: new Date().toISOString(),
    rules_version: (campaign as Row).rules_version ?? null,
    campaign,
  }
  await Promise.all(CAMPAIGN_TABLES.map(async (t) => {
    const { data, error } = await client.from(t).select('*').eq('campaign_id', campaignId)
    if (error) throw error
    out[t] = data ?? []
  }))
  return out as CampaignExport
}

// ---------------------------------------------------------------- patches

/** Columns a patch may set, per table. */
export const PATCH_COLUMNS: Record<string, string[]> = {
  campaigns: ['name', 'rules_version', 'night', 'phase', 'settings'],
  characters: ['name', 'civilian', 'archetype_id', 'trait_id', 'stats', 'flair_ids', 'loadout', 'harm', 'stress',
    'drive', 'dying', 'hidden', 'home_clock', 'extra_slots', 'fight_state', 'notes', 'is_npc', 'locked'],
  clocks: ['name', 'kind', 'size', 'filled', 'visible_to_players', 'sort'],
  clues: ['text', 'found_by', 'personal_for', 'is_arc', 'night'],
  scene: ['title', 'text', 'round', 'zones', 'positions', 'public_enemies'],
  gm_secrets: ['case', 'arc', 'notes'],
  enemies: ['name', 'kind', 'stats', 'defenses', 'toughness', 'harm', 'harm_max', 'stress', 'count', 'count_max',
    'drive', 'zone', 'line', 'source_id'],
  encounters: ['name', 'config', 'last_result'],
}
const SINGLE_ROW = new Set(['campaigns', 'scene', 'gm_secrets'])
/** Columns that point at a hero; a patch may give the hero's name instead of the id. */
const HERO_REFS = new Set(['found_by', 'personal_for', 'character_id'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ResolvedOp =
  | { op: 'update'; table: string; id: string; set: Record<string, unknown> }
  | { op: 'insert'; table: string; row: Record<string, unknown> }

export type Change = { field: string; before: unknown; after: unknown; how?: string }
export type PreviewLine = { n: number; table: string; kind: 'set' | 'merge' | 'insert'; target: string; changes: Change[] }
export type Resolution = { ok: boolean; errors: string[]; note: string; ops: ResolvedOp[]; lines: PreviewLine[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const same = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string'
    ? a.trim().toLowerCase() === b.trim().toLowerCase()
    : JSON.stringify(a) === JSON.stringify(b)

function rowsOf(data: CampaignExport, table: string): Row[] {
  if (table === 'campaigns') return [data.campaign]
  return (data as unknown as Record<string, Row[]>)[table] ?? []
}

function labelOf(table: string, r: Record<string, unknown>): string {
  if (table === 'gm_secrets') return 'case file and GM notes'
  if (table === 'scene') return 'the scene'
  const v = r.name ?? r.title ?? r.text ?? r.kind
  return typeof v === 'string' && v ? (v.length > 40 ? `${v.slice(0, 40)}…` : v) : table
}

/** Merge: objects merge key by key, lists are added to, text is appended on a new line, anything else is replaced. */
function mergeValue(before: unknown, add: unknown): { value: unknown; how: string } {
  if (isObj(before) && isObj(add)) return { value: { ...before, ...add }, how: 'merged' }
  if (Array.isArray(before) && Array.isArray(add)) return { value: [...before, ...add], how: 'added to' }
  if (typeof before === 'string' && typeof add === 'string') {
    if (!before.trim()) return { value: add, how: 'set' }
    if (before.includes(add)) return { value: before, how: 'already there' }
    return { value: `${before}\n${add}`, how: 'appended' }
  }
  return { value: add, how: 'set' }
}

/**
 * Check a patch against the campaign as it is now. Every op must target a
 * known table and columns, and every `match` must find exactly one row, or
 * the whole import is refused with the reasons. Nothing is written here.
 */
export function resolvePatch(data: CampaignExport, patch: unknown, campaignId: string): Resolution {
  const errors: string[] = []
  const ops: ResolvedOp[] = []
  const lines: PreviewLine[] = []
  const fail = (note = '') => ({ ok: false, errors, note, ops: [], lines })

  if (!isObj(patch)) { errors.push('The patch must be a JSON object.'); return fail() }
  const note = typeof patch.note === 'string' ? patch.note : ''
  if (patch.format !== PATCH_FORMAT) errors.push(`"format" must be "${PATCH_FORMAT}".`)
  if (patch.campaign !== campaignId) {
    errors.push(`This patch is for campaign ${String(patch.campaign ?? '(none)')}, not this one (${campaignId}).`)
  }
  if (!Array.isArray(patch.ops) || patch.ops.length === 0) errors.push('"ops" must be a non-empty list.')
  if (errors.length) return fail(note)

  const heroes = data.characters
  const heroRef = (v: unknown, where: string): unknown => {
    if (typeof v !== 'string' || v === '' || UUID.test(v)) return v
    const found = heroes.filter((h) => same(h.name, v))
    if (found.length !== 1) { errors.push(`${where}: ${found.length ? 'more than one' : 'no'} hero named "${v}".`); return v }
    return found[0].id
  }
  const checkCols = (table: string, obj: Record<string, unknown>, where: string) => {
    for (const k of Object.keys(obj)) {
      if (!PATCH_COLUMNS[table].includes(k)) errors.push(`${where}: ${table} has no field "${k}" a patch may change.`)
    }
  }

  ;(patch.ops as unknown[]).forEach((raw, i) => {
    const n = i + 1
    const where = `Op ${n}`
    if (!isObj(raw)) { errors.push(`${where}: must be an object.`); return }
    const table = raw.table
    if (typeof table !== 'string' || !PATCH_COLUMNS[table]) {
      errors.push(`${where}: table "${String(table)}" can't be patched. Allowed: ${Object.keys(PATCH_COLUMNS).join(', ')}.`)
      return
    }
    const kinds = (['set', 'merge', 'insert'] as const).filter((k) => k in raw)
    if (kinds.length !== 1) { errors.push(`${where}: needs exactly one of set, merge or insert.`); return }
    const kind = kinds[0]
    const body = raw[kind]
    if (!isObj(body)) { errors.push(`${where}: ${kind} must be an object.`); return }

    if (kind === 'insert') {
      if (SINGLE_ROW.has(table)) { errors.push(`${where}: ${table} has one row per campaign; use set or merge.`); return }
      checkCols(table, body, where)
      const row: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(body)) row[k] = HERO_REFS.has(k) ? heroRef(v, where) : v
      ops.push({ op: 'insert', table, row })
      lines.push({ n, table, kind, target: `new ${table} row`, changes: Object.entries(row).map(([field, after]) => ({ field, before: undefined, after })) })
      return
    }

    // set / merge: find exactly one row
    const match = raw.match
    let candidates = rowsOf(data, table)
    if (match !== undefined) {
      if (!isObj(match)) { errors.push(`${where}: match must be an object.`); return }
      candidates = candidates.filter((r) => Object.entries(match).every(([k, v]) =>
        HERO_REFS.has(k) ? same(r[k], heroRef(v, where)) : same(r[k], v)))
    } else if (!SINGLE_ROW.has(table)) {
      errors.push(`${where}: ${table} needs a "match" to say which row.`)
      return
    }
    if (candidates.length !== 1) {
      errors.push(`${where}: match ${JSON.stringify(match ?? {})} found ${candidates.length} ${table} rows; it must find exactly one.`)
      return
    }
    const target = candidates[0]
    checkCols(table, body, where)
    const set: Record<string, unknown> = {}
    const changes: Change[] = []
    for (const [field, v] of Object.entries(body)) {
      const value = HERO_REFS.has(field) ? heroRef(v, where) : v
      if (kind === 'merge') {
        const m = mergeValue(target[field], value)
        set[field] = m.value
        changes.push({ field, before: target[field], after: m.value, how: m.how })
      } else {
        set[field] = value
        changes.push({ field, before: target[field], after: value })
      }
    }
    ops.push({ op: 'update', table, id: target.id, set })
    lines.push({ n, table, kind, target: labelOf(table, target), changes })
  })

  return errors.length ? fail(note) : { ok: true, errors, note, ops, lines }
}

/** Apply a resolved patch in one transaction. Returns the import id (for undo). */
export async function applyPatch(client: SupabaseClient, campaignId: string, patch: unknown, res: Resolution): Promise<string> {
  if (!res.ok) throw new Error(res.errors.join(' '))
  const { data, error } = await client.rpc('apply_patch_ops', {
    p_campaign_id: campaignId, p_note: res.note, p_patch: patch, p_ops: res.ops,
  })
  if (error) throw error
  return data as string
}

export async function undoImport(client: SupabaseClient, importId: string) {
  const { error } = await client.rpc('undo_import', { p_import_id: importId })
  if (error) throw error
}

/** Short text for a value in a before/after line. */
export function show(v: unknown): string {
  if (v === undefined) return '—'
  if (v === null) return 'empty'
  const s = typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}
