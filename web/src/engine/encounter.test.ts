import { describe, expect, it } from 'vitest'
import demo from '../../../supabase/seed/demo-heroes.json'
import check from '../../../sim/tests/encounter_check.json'
import {
  difficulty, encounterConfig, libraryMooks, normalizeForm, libraryVillains, mooksFromEnemy, probablyDown, villainFromEnemy,
  type EncounterForm, type Enemy, type Sheet,
} from './index'

const chars = (demo as unknown as Sheet[]).map((s, i) => ({ ...s, id: `c${i}`, harm: 1, stress: 2, drive: 4 }))
const id = (name: string) => chars.find((c) => c.name === name)!.id
const butcher = libraryVillains().find((v) => v.id === 'the-butcher')!.sim
const saints = libraryMooks()[0].sim

const form = (over: Partial<EncounterForm> = {}): EncounterForm => ({
  party: [id('Rook'), id('Nightjar'), id('The Ledger')], mode: 'fresh',
  villains: [butcher], mook_groups: [saints], dark: false, runs: 2000, ...over,
})

describe('encounterConfig', () => {
  it('builds the same config the pytest and browser checks use, from the demo sheets', () => {
    const c = encounterConfig(form(), chars, 7)
    const { villain, ...rest } = check
    expect(c).toEqual({ ...rest, villains: [{ ...villain, role: 'villain' }] })
  })

  it('fresh resets Harm, Stress and Drive; as-they-are-now keeps them', () => {
    expect(encounterConfig(form(), chars).heroes[0]).toMatchObject({ harm: 0, stress: 0, drive: 2 })
    expect(encounterConfig(form({ mode: 'now' }), chars).heroes[0]).toMatchObject({ harm: 1, stress: 2, drive: 4 })
  })

  it('a hero with an unmodeled power carries it in not_simulated', () => {
    const psychic = { ...chars[0], id: 'x', name: 'Mara', loadout: [{ kind: 'power' as const, id: 'telepathy', ability_level: 1, flaw: 'Unstable' }] }
    const c = encounterConfig(form({ party: ['x'] }), [psychic])
    expect(c.heroes[0].not_simulated).toContain('Mara: Telepathy')
  })

  it('gives two heroes with the same name different keys', () => {
    const twin = { ...chars[1], id: 'twin' }
    const keys = encounterConfig(form({ party: [chars[1].id, 'twin'] }), [...chars, twin]).heroes.map((h) => h.key)
    expect(keys).toEqual(['rook', 'rook_2'])
  })
})

describe('several named enemies', () => {
  it('library entries carry their role', () => {
    expect(libraryVillains().map((v) => v.sim.role)).toEqual(['villain', 'villain', 'lieutenant'])
  })
  it('a form saved with one villain reads back as a list', () => {
    const old = { party: ['a'], villain: { ...butcher, role: undefined } }
    expect(normalizeForm(old as never, form({ villains: [] })).villains).toEqual([{ ...butcher, role: 'villain' }])
    expect(normalizeForm({ villain: null } as never, form({ villains: [] })).villains).toEqual([])
  })
})

describe('enemies from the Fight screen', () => {
  const row = (over: Partial<Enemy>): Enemy => ({
    id: 'e', campaign_id: 'c', name: 'X', kind: 'villain', stats: {}, defenses: {}, toughness: 0, harm: 0, harm_max: 5,
    stress: 0, count: 1, count_max: 1, drive: 2, zone: null, line: '', source_id: null, ...over,
  })
  it('a library villain keeps its weapon and stats', () => {
    const v = villainFromEnemy(row({ name: 'The Butcher', stats: { force: 4, flow: 0, focus: 1, presence: 2 }, toughness: 1, harm_max: 10, source_id: 'the-butcher' }))
    expect(v).toEqual(butcher)
  })
  it('a mook group uses its full size fresh, or who is standing now', () => {
    const m = row({ kind: 'mooks', name: 'Fifth Street Saints', stats: { attack: 2 }, defenses: { guard: 13 }, count: 1, count_max: 3, source_id: 'fifth-street-saints' })
    expect(mooksFromEnemy(m)).toMatchObject({ count: 3, gunner: true })
    expect(mooksFromEnemy(m, true)).toMatchObject({ count: 1 })
  })
})

describe('difficulty labels (SPEC.md bands)', () => {
  it.each([[100, 'Walkover'], [97, 'Walkover'], [96.9, 'Fair'], [85, 'Fair'], [84.9, 'Hard'], [65, 'Hard'], [64.9, 'Deadly'], [0, 'Deadly']])(
    '%s%% is %s', (w, label) => expect(difficulty(w)).toBe(label))
  it('flags Someone probably goes Down at 50%', () => {
    expect(probablyDown({ any_down_pct: 50 })).toBe(true)
    expect(probablyDown({ any_down_pct: 49.9 })).toBe(false)
  })
})
