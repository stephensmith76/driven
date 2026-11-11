import { describe, expect, it } from 'vitest'
import { buildReport } from './sessionReport'

const base = {
  now: '2026-11-14T22:00:00Z',
  campaign: { id: 'c', name: 'Test', night: 3, phase: 'dawn', rules_version: 'v1' },
  characters: [{ name: 'Rook', harm: 2 }], clocks: [{ name: 'Scheme', filled: 3 }],
  rolls: [{ at: '2026-11-14T18:00:00Z', label: 'old' }, { at: '2026-11-14T21:30:00Z', label: 'b' }, { at: '2026-11-14T21:10:00Z', label: 'a' }],
  helper: [{ at: '2026-11-14T21:20:00Z', question: 'q', answer: 'a' }, { at: '2026-11-13T21:20:00Z', question: 'old', answer: null }],
  notes: 'Marsh knows.',
}

describe('session report', () => {
  it('keeps only this Night after the start snapshot, in time order', () => {
    const r = buildReport({ ...base, snapshot: { at: '2026-11-14T21:00:00Z', state: { characters: [{ name: 'Rook', harm: 0 }] } } })
    expect(r.rolls.map((x) => x.label)).toEqual(['a', 'b'])
    expect(r.helper_questions.map((x) => x.question)).toEqual(['q'])
    expect(r.start_of_night).toEqual({ characters: [{ name: 'Rook', harm: 0 }] })
    expect(r.end_of_night.characters[0]).toMatchObject({ harm: 2 })
    expect(r.gm_notes).toBe('Marsh knows.')
    expect(r.rules_version).toBe('v1')
  })
  it('without a snapshot keeps everything and says there is no start state', () => {
    const r = buildReport({ ...base, snapshot: null })
    expect(r.rolls).toHaveLength(3)
    expect(r.start_of_night).toBeNull()
  })
})
