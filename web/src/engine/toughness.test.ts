// The Toughness table in rules.md is the authority (Stephen, Nov 11). These tests parse the table
// from rules.md itself, so a change to the table that isn't regenerated into the data fails here.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseToughnessTable } from '../../../scripts/gen-toughness.mjs'
import { TOUGHNESS_ROWS, toughness, type AttackKind, type Sheet } from './index'

const table = parseToughnessTable(readFileSync(resolve(__dirname, '../../../rules/rules.md'), 'utf8'))
const KINDS: AttackKind[] = ['blunt', 'blade', 'gun', 'hazard']
const sheetFor = (ref: { kind: string; id?: string }): Sheet => ({
  stats: { force: ref.kind === 'force' ? 3 : 0, flow: 0, focus: 0, presence: 0 },
  loadout: ref.kind === 'force' ? [] : [{ kind: ref.kind as 'gear' | 'power', id: ref.id! }],
})

describe('Toughness table (generated from rules.md)', () => {
  it('rules/data/toughness.json matches the table in rules.md', () => {
    expect(TOUGHNESS_ROWS).toEqual(table)
  })
  for (const row of table) {
    for (const ref of row.refs) {
      it(`${row.source} (${ref.kind}${'id' in ref ? ` ${ref.id}` : ''}) gives ${KINDS.map((k) => row[k]).join(' / ')}`, () => {
        expect(KINDS.map((k) => toughness(sheetFor(ref), k).value)).toEqual(KINDS.map((k) => row[k]))
      })
    }
  }
  it('takes the single highest source and never stacks: Force +4 with Kevlar is 1 against a punch and a bullet', () => {
    const s: Sheet = { stats: { force: 4, flow: 0, focus: 0, presence: 0 }, loadout: [{ kind: 'gear', id: 'kevlar-vest' }] }
    expect(toughness(s, 'blunt').value).toBe(1)
    expect(toughness(s, 'gun').value).toBe(1)
    expect(toughness(s, 'hazard').value).toBe(0)
  })
})
