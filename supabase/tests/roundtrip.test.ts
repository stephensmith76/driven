/**
 * M3 check: an export, a patch import and an undo all round-trip (SPEC.md "Build order").
 * Uses the same export/patch code as the Admin screen (web/src/data/campaignIO.ts).
 *
 *   npm run test:roundtrip
 */
import { check, demoHeroes, device, failed, newCampaign } from './lib'
import { applyPatch, exportCampaign, resolvePatch, undoImport, type CampaignExport } from '../../web/src/data/campaignIO'

const hero = (d: CampaignExport, name: string) => d.characters.find((c) => c.name === name)!
const scheme = (d: CampaignExport) => d.clocks.find((c) => c.kind === 'scheme')!

async function main() {
  const gm = await device()
  const player = await device()
  const { campaign_id: cid, join_code: code } = await newCampaign(gm, 'Round-trip test')
  try {
    const ins = await gm.from('characters').insert(demoHeroes().map((h) => ({ ...h, campaign_id: cid })))
    if (ins.error) throw new Error(ins.error.message)
    await gm.from('gm_secrets').update({ notes: 'Saints run scared.' }).eq('campaign_id', cid)

    // ---- export, and the file survives being saved and read back
    const before = JSON.parse(JSON.stringify(await exportCampaign(gm, cid))) as CampaignExport
    check('export has every table, hidden ones included',
      ['members', 'characters', 'clocks', 'clues', 'scene', 'rolls', 'gm_secrets', 'enemies', 'encounters', 'imports', 'helper_log']
        .every((t) => Array.isArray((before as unknown as Record<string, unknown>)[t])) && before.gm_secrets.length === 1)
    check('export carries rules_version and the export time', 'rules_version' in before && Boolean(before.exported_at))
    check('export never contains the passcode hash', !JSON.stringify(before).includes('gm_code_hash'))

    // ---- the spec's example patch
    const patch = {
      format: 'street-level-patch/1', campaign: cid, note: 'After the Nov 14 voice session, Night 3',
      ops: [
        { table: 'characters', match: { name: 'Rook' }, set: { harm: 2, stress: 4, drive: 1 } },
        { table: 'clocks', match: { kind: 'scheme' }, set: { filled: 3 } },
        { table: 'clues', insert: { text: 'A gas-soaked rag with a Tidewater Seafood logo', night: 3 } },
        { table: 'gm_secrets', merge: { notes: 'Marsh knows someone is digging.' } },
      ],
    }
    const res = resolvePatch(before, patch, cid)
    check('patch resolves with a before/after line per op', res.ok && res.lines.length === 4, res.errors.join(' '))
    const importId = await applyPatch(gm, cid, patch, res)

    const after = await exportCampaign(gm, cid)
    const rook = hero(after, 'Rook')
    check('import: Rook set to Harm 2, Stress 4, Drive 1', rook.harm === 2 && rook.stress === 4 && rook.drive === 1)
    check('import: Scheme set to 3', scheme(after).filled === 3)
    check('import: clue inserted', after.clues.some((c) => c.text === 'A gas-soaked rag with a Tidewater Seafood logo' && c.night === 3))
    check('import: GM notes appended', after.gm_secrets[0].notes === 'Saints run scared.\nMarsh knows someone is digging.')
    const imp = after.imports.find((i) => i.id === importId)
    check('import is logged with its old values', Boolean(imp?.applied) && Array.isArray(imp?.before) && (imp!.before as unknown[]).length === 4)

    // ---- undo puts everything back
    await undoImport(gm, importId)
    const undone = await exportCampaign(gm, cid)
    const r0 = hero(before, 'Rook'), r2 = hero(undone, 'Rook')
    check('undo: Rook back as he was', r2.harm === r0.harm && r2.stress === r0.stress && r2.drive === r0.drive)
    check('undo: Scheme back', scheme(undone).filled === scheme(before).filled)
    check('undo: inserted clue removed', undone.clues.length === before.clues.length)
    check('undo: notes back', undone.gm_secrets[0].notes === before.gm_secrets[0].notes)
    check('undo: import marked undone', undone.imports.find((i) => i.id === importId)?.applied === false)
    const again = await gm.rpc('undo_import', { p_import_id: importId })
    check('an import cannot be undone twice', Boolean(again.error))

    // ---- all or none: one bad op and nothing is written
    const bad = { ...patch, ops: [patch.ops[0], { table: 'characters', match: { name: 'Nightjar' }, set: { harm: 'lots' } }] }
    const badRes = resolvePatch(undone, bad, cid)
    let threw = false
    try { await applyPatch(gm, cid, bad, badRes) } catch { threw = true }
    const afterBad = await exportCampaign(gm, cid)
    check('a failing op rolls back the whole import', threw && hero(afterBad, 'Rook').harm === r0.harm)

    // ---- players can't import, undo, or read the import log
    await player.rpc('join_campaign', { p_join_code: code })
    const pApply = await player.rpc('apply_patch_ops', { p_campaign_id: cid, p_note: '', p_patch: patch, p_ops: res.ops })
    check('a player cannot apply a patch', Boolean(pApply.error))
    const pUndo = await player.rpc('undo_import', { p_import_id: importId })
    check('a player cannot undo an import', Boolean(pUndo.error))
    const pRead = await player.from('imports').select('id').eq('campaign_id', cid)
    check('a player cannot read the import log', (pRead.data?.length ?? 0) === 0)
  } finally {
    const { error } = await gm.from('campaigns').delete().eq('id', cid)
    if (error) console.warn(`cleanup failed: ${error.message}`)
  }
  console.log(failed() ? `\n${failed()} check(s) failed` : '\nExport, import and undo all round-trip')
  process.exit(failed() ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
