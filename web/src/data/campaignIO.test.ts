import { describe, expect, it } from 'vitest'
import { resolvePatch, type CampaignExport } from './campaignIO'

const CID = '11111111-1111-4111-8111-111111111111'
const ROOK = '22222222-2222-4222-8222-222222222222'
const NIGHTJAR = '33333333-3333-4333-8333-333333333333'

const data = (): CampaignExport => ({
  format: 'street-level-export/1', exported_at: '', rules_version: '2026-11-10',
  campaign: { id: CID, name: 'Test', night: 3, phase: 'patrol', settings: {} },
  members: [],
  characters: [
    { id: ROOK, name: 'Rook', harm: 0, stress: 1, drive: 2 },
    { id: NIGHTJAR, name: 'Nightjar', harm: 1, stress: 0, drive: 3 },
  ],
  clocks: [
    { id: 'c1', kind: 'scheme', name: 'Scheme', filled: 1, size: 6 },
    { id: 'c2', kind: 'heat', name: 'Heat', filled: 2, size: 6 },
  ],
  clues: [], scene: [{ id: 's1', title: '' }],
  rolls: [],
  gm_secrets: [{ id: 'g1', case: { title: 'The Butcher', clues: [] }, arc: {}, notes: 'Saints run scared.' }],
  enemies: [], encounters: [], imports: [], helper_log: [],
})

// The example from SPEC.md "Import".
const specExample = {
  format: 'street-level-patch/1',
  campaign: CID,
  note: 'After the Nov 14 voice session, Night 3',
  ops: [
    { table: 'characters', match: { name: 'Rook' }, set: { harm: 2, stress: 4, drive: 1 } },
    { table: 'clocks', match: { kind: 'scheme' }, set: { filled: 3 } },
    { table: 'clues', insert: { text: 'A gas-soaked rag with a Tidewater Seafood logo', night: 3 } },
    { table: 'gm_secrets', merge: { notes: 'Marsh knows someone is digging.' } },
  ],
}

describe('resolvePatch', () => {
  it('resolves the spec example, with a before/after line for every op', () => {
    const r = resolvePatch(data(), specExample, CID)
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.ops).toEqual([
      { op: 'update', table: 'characters', id: ROOK, set: { harm: 2, stress: 4, drive: 1 } },
      { op: 'update', table: 'clocks', id: 'c1', set: { filled: 3 } },
      { op: 'insert', table: 'clues', row: { text: 'A gas-soaked rag with a Tidewater Seafood logo', night: 3 } },
      { op: 'update', table: 'gm_secrets', id: 'g1', set: { notes: 'Saints run scared.\nMarsh knows someone is digging.' } },
    ])
    expect(r.lines).toHaveLength(4)
    expect(r.lines[0].changes).toContainEqual({ field: 'harm', before: 0, after: 2 })
    expect(r.lines[3].changes[0].how).toBe('appended')
  })

  it('refuses the whole import when a match finds no row, with the reason', () => {
    const p = { ...specExample, ops: [...specExample.ops, { table: 'characters', match: { name: 'Bulwark' }, set: { harm: 1 } }] }
    const r = resolvePatch(data(), p, CID)
    expect(r.ok).toBe(false)
    expect(r.ops).toEqual([])
    expect(r.errors[0]).toMatch(/Op 5: .*found 0 characters rows/)
  })

  it('refuses when a match finds more than one row', () => {
    const p = { ...specExample, ops: [{ table: 'clocks', match: { size: 6 }, set: { filled: 0 } }] }
    expect(resolvePatch(data(), p, CID).errors[0]).toMatch(/found 2 clocks rows/)
  })

  it('refuses a patch for another campaign, an unknown table or an unknown field', () => {
    expect(resolvePatch(data(), { ...specExample, campaign: 'someone-else' }, CID).errors[0]).toMatch(/not this one/)
    expect(resolvePatch(data(), { ...specExample, ops: [{ table: 'members', match: {}, set: { role: 'gm' } }] }, CID).errors[0])
      .toMatch(/can't be patched/)
    expect(resolvePatch(data(), { ...specExample, ops: [{ table: 'characters', match: { name: 'Rook' }, set: { campaign_id: 'x' } }] }, CID).errors[0])
      .toMatch(/no field "campaign_id"/)
    expect(resolvePatch(data(), { ...specExample, format: 'nope' }, CID).ok).toBe(false)
  })

  it('needs a match except on one-row tables', () => {
    expect(resolvePatch(data(), { ...specExample, ops: [{ table: 'characters', set: { harm: 1 } }] }, CID).errors[0]).toMatch(/needs a "match"/)
    expect(resolvePatch(data(), { ...specExample, ops: [{ table: 'campaigns', set: { night: 4 } }] }, CID).ok).toBe(true)
  })

  it('accepts a hero name where an id is expected', () => {
    const p = { ...specExample, ops: [{ table: 'clues', insert: { text: 'Plate number', personal_for: 'Nightjar' } }] }
    const r = resolvePatch(data(), p, CID)
    expect(r.ops[0]).toEqual({ op: 'insert', table: 'clues', row: { text: 'Plate number', personal_for: NIGHTJAR } })
  })

  it('merges objects key by key and adds to lists', () => {
    const p = { ...specExample, ops: [{ table: 'gm_secrets', merge: { case: { culprit: 'D. Marsh' } } }] }
    const r = resolvePatch(data(), p, CID)
    expect(r.ops[0]).toMatchObject({ set: { case: { title: 'The Butcher', clues: [], culprit: 'D. Marsh' } } })
  })

  it('matches names without caring about case', () => {
    const p = { ...specExample, ops: [{ table: 'characters', match: { name: 'rook' }, set: { harm: 1 } }] }
    expect(resolvePatch(data(), p, CID).ok).toBe(true)
  })
})
