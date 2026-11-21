import { describe, expect, it } from 'vitest'
import {
  ADVANCEMENT_LIMITS, CORE, advancementOptions, usesToTrack, advancementWarnings, buildWarnings, pickLabel, sheetAfterPick, teamAfterPick,
  type AdvancementPick, type Sheet,
} from '.'

const hero = (over: Partial<Sheet> = {}): Sheet => ({
  name: 'Test', archetype_id: 'brawler', trait_id: 'justice',
  stats: { force: 3, flow: 2, focus: 1, presence: 0 }, flair_ids: ['scrapper'],
  loadout: [{ kind: 'power', id: 'telepathy', ability_level: 1, flaw: 'Unstable' }], extra_slots: 0, ...over,
})
const opt = (s: Sheet, h: AdvancementPick[] = [], team = null) => Object.fromEntries(advancementOptions(s, h, team).map((o) => [o.kind, o]))

describe('Advancement', () => {
  it('limits match the rules data', () => {
    const [stat, flair, , slot] = CORE.advancement
    expect(stat).toContain(`max +${ADVANCEMENT_LIMITS.stat_max}`)
    expect(stat).toContain(`more than +${ADVANCEMENT_LIMITS.stat_total}`)
    expect(flair).toContain('four at most')
    expect(slot).toContain('six at most')
    expect(ADVANCEMENT_LIMITS.flairs).toBe(4)
    expect(ADVANCEMENT_LIMITS.slots).toBe(6)
  })

  it('never a stat two cases in a row', () => {
    expect(opt(hero()).stat.ok).toBe(true)
    expect(opt(hero(), [{ kind: 'stat', id: 'flow', label: '' }]).stat.ok).toBe(false)
    expect(opt(hero(), [{ kind: 'stat', id: 'flow', label: '' }, { kind: 'flair', id: 'chill', label: '' }]).stat.ok).toBe(true)
  })

  it('stat cap +4 and total +10', () => {
    const capped = opt(hero({ stats: { force: 4, flow: 2, focus: 1, presence: 0 } })).stat
    expect(capped.choices.find((c) => c.id === 'force')!.ok).toBe(false)
    expect(capped.ok).toBe(true)
    expect(opt(hero({ stats: { force: 4, flow: 4, focus: 2, presence: 0 } })).stat.ok).toBe(false)
  })

  it('Flairs, slots and abilities close at their limits', () => {
    expect(opt(hero({ flair_ids: ['scrapper', 'chill', 'smarmy', 'acrobat'] })).flair.ok).toBe(false)
    expect(opt(hero({ extra_slots: 3 })).slot.ok).toBe(false)
    expect(opt(hero({ extra_slots: 2 })).slot.ok).toBe(true)
    expect(opt(hero({ loadout: [] })).ability.ok).toBe(false)
    expect(opt(hero({ loadout: [{ kind: 'power', id: 'telepathy', ability_level: 3 }] })).ability.ok).toBe(false)
  })

  it('a pick and its undo round-trip', () => {
    const s = hero()
    for (const pick of [{ kind: 'stat', id: 'flow' }, { kind: 'flair', id: 'chill' }, { kind: 'ability', id: 'telepathy' }, { kind: 'slot' }] as const) {
      const after = { ...s, ...sheetAfterPick(s, pick, 1) }
      expect(after).not.toEqual(s)
      expect({ ...after, ...sheetAfterPick(after, pick, -1) }).toEqual(s)
    }
    expect(sheetAfterPick(s, { kind: 'ability', id: 'telepathy' }).loadout![0].ability_level).toBe(2)
  })

  it('labels say what was taken', () => {
    const s = hero()
    expect(pickLabel('stat', 'flow', s)).toBe('+1 Flow (to +3)')
    expect(pickLabel('ability', 'telepathy', s)).toMatch(/^Telepathy: /)
    expect(pickLabel('asset', 'vehicle')).toBe('Asset: Vehicle')
  })

  it('Assets and rooms go on the team sheet', () => {
    expect(teamAfterPick({}, { kind: 'asset', id: 'vehicle' })!.assets).toEqual(['vehicle'])
    expect(teamAfterPick({ assets: ['vehicle'] }, { kind: 'asset', id: 'vehicle' }, -1)!.assets).toEqual([])
    expect(teamAfterPick({}, { kind: 'asset', id: 'room:garage' })).toBeNull()
    expect(teamAfterPick({ lair: { style: 'gym' } }, { kind: 'asset', id: 'room:garage' })!.lair!.rooms).toEqual(['garage'])
    expect(teamAfterPick({}, { kind: 'stat', id: 'flow' })).toBeNull()
  })

  it('past creation, the limits are warnings', () => {
    expect(advancementWarnings(hero({ stats: { force: 4, flow: 4, focus: 3, presence: 0 } }))).toHaveLength(1)
    expect(buildWarnings(hero({ extra_slots: 4 }), { creation: false }).some((w) => w.includes('limit is 6'))).toBe(true)
  })
})

describe('usesToTrack', () => {
  it('finds per-fight, per-scene and per-Night limits, with counts', () => {
    const uses = usesToTrack({
      archetype_id: 'leader', trait_id: 'duty', stats: { force: 0, flow: 0, focus: 0, presence: 0 },
      flair_ids: ['bodyguard'],
      loadout: [{ kind: 'power', id: 'armored', ability_level: 3, flaw: 'Allergy' }, { kind: 'gear', id: 'smoke-grenades' }],
    })
    const by = Object.fromEntries(uses.map((u) => [u.source, u]))
    expect(by['Carry the weight']).toMatchObject({ count: 1, period: 'scene' })
    expect(by['Duty perk']).toMatchObject({ period: 'scene' })
    expect(by['Bodyguard']).toBeDefined()
    expect(by['Armored: first hit stopped (1 Stress)']).toBeDefined()
    expect(by['Armored: Let it take the hit']).toMatchObject({ period: 'fight' })
    expect(by['Second Wind (3 Drive)']).toBeDefined()
    expect(uses.filter((u) => u.source === 'Duty perk')).toHaveLength(1)
    expect(by['Rally']).toBeUndefined() // once per round: no boxes
  })
})
