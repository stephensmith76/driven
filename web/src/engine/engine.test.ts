import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import demo from '../../../supabase/seed/demo-heroes.json'
import {
  CORE, FLAIRS, GEAR, KIT, POWERS, ARCHETYPES, TRAITS,
  defenses, harm, harmBoxes, netAdv, resolveRoll, simHero, slotsUsed, stressStage, toughness, upgrade,
  type Sheet,
} from './index'

const heroes = demo as unknown as Sheet[]
const hero = (name: string) => heroes.find((h) => h.name === name)!

describe('M1 check: sample hero defenses (Guard / Wits / Poise)', () => {
  // SPEC.md M1 "Done when". These are 12 + stat, as in the rules' Sample heroes table.
  const expected: Record<string, [number, number, number]> = {
    Bulwark: [12, 13, 14],
    Rook: [14, 11, 13],
    Nightjar: [16, 14, 11],
    Patchwork: [14, 15, 13],
    'The Ledger': [13, 16, 14],
  }
  for (const [name, [g, w, p]] of Object.entries(expected)) {
    it(`${name} ${g} / ${w} / ${p}`, () => {
      const d = defenses(hero(name))
      expect([d.guard.base, d.wits.base, d.poise.base]).toEqual([g, w, p])
    })
  }

  it("Bulwark's riot shield shows as +1 Guard on top (13 total)", () => {
    const d = defenses(hero('Bulwark'))
    expect(d.guard.total).toBe(13)
    expect(d.guard.mods).toEqual([{ source: 'Riot shield', value: 1 }])
  })
})

describe('Toughness', () => {
  it('Force +3 gives 1 against fists and blades, not guns', () => {
    const b = hero('Bulwark')
    expect(toughness(b, 'blunt').value).toBe(1)
    expect(toughness(b, 'blade').value).toBe(1)
  })
  it('Kevlar covers guns and blades; sources do not stack', () => {
    const r = hero('Rook') // Force +4 and Kevlar
    expect(toughness(r, 'gun')).toMatchObject({ value: 1, source: 'Kevlar vest' })
    expect(toughness(r, 'blade').value).toBe(1)
    expect(toughness(r, 'blunt').value).toBe(1)
  })
  it('Powered armor is Toughness 2 against blunt, blades and guns, costs 2 slots, and cuts out', () => {
    const suit: Sheet = { stats: { force: 0, flow: 0, focus: 0, presence: 0 }, loadout: [{ kind: 'gear', id: 'powered-armor' }] }
    for (const k of ['blunt', 'blade', 'gun'] as const) expect(toughness(suit, k)).toMatchObject({ value: 2, source: 'Powered armor' })
    expect(toughness(suit, 'hazard').value).toBe(0)
    expect(slotsUsed(suit).used).toBe(2)
    const off: Sheet = { ...suit, fight_state: { 'offline:powered-armor': true } }
    for (const k of ['blunt', 'blade', 'gun'] as const) expect(toughness(off, k).value).toBe(0)
    // Force +3 still gives its own 1 against blunt and blades while the suit is out; it never stacks past the best source.
    const strong: Sheet = { stats: { force: 3, flow: 0, focus: 0, presence: 0 }, loadout: [{ kind: 'gear', id: 'powered-armor' }] }
    expect(toughness(strong, 'blunt').value).toBe(2)
    expect(toughness({ ...strong, fight_state: { 'offline:powered-armor': true } }, 'blunt').value).toBe(1)
    expect(simHero(suit)).toMatchObject({ armor_all: 2, armor_flaky: true })
  })
  it('Resilience covers blunt only: blades and bullets still go through', () => {
    const r: Sheet = { stats: { force: 0, flow: 0, focus: 0, presence: 0 }, loadout: [{ kind: 'power', id: 'toughness' }] }
    expect(toughness(r, 'blunt').value).toBe(1)
    expect(toughness(r, 'blade').value).toBe(0)
    expect(toughness(r, 'gun').value).toBe(0)
  })
  it('Hazards ignore Toughness', () => {
    expect(toughness(hero('Rook'), 'hazard').value).toBe(0)
  })
  it('+1 Toughness effects add on top, capped at 2', () => {
    expect(toughness(hero('Bulwark'), 'blunt', { plus: 1 }).value).toBe(2)
    const armored: Sheet = { stats: { force: 3, flow: 0, focus: 0, presence: 0 },
      loadout: [{ kind: 'power', id: 'armored', ability_level: 2, flaw: 'allergy: salt' }] }
    expect(toughness(armored, 'gun').value).toBe(2)
    expect(toughness(armored, 'gun', { plus: 1 }).value).toBe(2)
  })
  it('Nightjar has none', () => {
    expect(toughness(hero('Nightjar'), 'blunt').value).toBe(0)
  })
  it('Iron Skin only counts while switched on', () => {
    const s: Sheet = { stats: { force: 0, flow: 0, focus: 0, presence: 0 },
      loadout: [{ kind: 'power', id: 'iron-skin', flaw: 'allergy: acid' }] }
    expect(toughness(s, 'gun').value).toBe(0)
    expect(toughness(s, 'gun', { active: ['iron-skin'] }).value).toBe(1)
  })
})

describe('Harm boxes and slots', () => {
  it('4 boxes by default; Hard to Kill and Toughness add Battered after Hurt', () => {
    expect(harmBoxes(hero('Nightjar'))).toEqual(['Bruised', 'Hurt', 'Wounded', 'Down'])
    expect(harmBoxes(hero('Rook'))).toEqual(['Bruised', 'Hurt', 'Battered', 'Wounded', 'Down'])
    expect(harmBoxes(hero('Bulwark'))).toEqual(['Bruised', 'Hurt', 'Battered', 'Wounded', 'Down'])
  })
  it('every sample hero uses exactly 3 slots with no warnings', () => {
    for (const h of heroes) expect(slotsUsed(h), h.name).toMatchObject({ used: 3, warnings: [] })
  })
  it('a build using 4 slots warns but is not blocked', () => {
    const s: Sheet = { stats: { force: 0, flow: 0, focus: 0, presence: 0 }, loadout: [
      { kind: 'power', id: 'mighty', flaw: 'marked' },
      { kind: 'gear', id: 'knife' }, { kind: 'gear', id: 'med-kit' },
    ] }
    const r = slotsUsed(s)
    expect(r.used).toBe(4)
    expect(r.warnings[0]).toMatch(/4 slots/)
  })
  it('strange powers need a flaw, and only one at creation', () => {
    const s: Sheet = { stats: { force: 0, flow: 0, focus: 0, presence: 0 }, loadout: [
      { kind: 'power', id: 'mighty' }, { kind: 'power', id: 'luck', flaw: 'unstable' },
    ] }
    const r = slotsUsed(s)
    expect(r.warnings.some((w) => /Mighty needs a flaw/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /one strange power/.test(w))).toBe(true)
  })
  it("a Specialist's Kit sits outside the slots", () => {
    const p = { ...hero('Patchwork'), loadout: [...hero('Patchwork').loadout!,
      { kind: 'kit' as const, id: 'smoke' }, { kind: 'kit' as const, id: 'taser' }, { kind: 'kit' as const, id: 'armor' }] }
    expect(slotsUsed(p)).toMatchObject({ used: 3, warnings: [] })
  })
  it('Stress stages', () => {
    expect([0, 3, 4, 7, 8].map((s) => stressStage(s).name)).toEqual(['Steady', 'Steady', 'Fraying', 'Fraying', 'Breaking'])
  })
})

describe('Rolls (SPEC.md "Rules the engine must get right")', () => {
  it('margin bands: miss, 0-3, 4-7, 8+', () => {
    const at = (total: number) => resolveRoll({ dice: [total - 2, 2].map((x) => Math.max(1, x)), bonus: 0, defense: 12 })
    expect(resolveRoll({ dice: [5, 6], bonus: 0, defense: 12 }).impact).toBe(0)
    expect(resolveRoll({ dice: [6, 6], bonus: 0, defense: 12 }).impact).toBe(1)
    expect(resolveRoll({ dice: [9, 6], bonus: 0, defense: 12 }).impact).toBe(1)
    expect(resolveRoll({ dice: [10, 6], bonus: 0, defense: 12 }).impact).toBe(2)
    expect(resolveRoll({ dice: [10, 9], bonus: 0, defense: 12 }).impact).toBe(2)
    expect(resolveRoll({ dice: [10, 10], bonus: 0, defense: 12 }).impact).toBe(3)
    expect(at(12).margin).toBe(0)
  })
  it('Advantage keeps the best two of three, Disadvantage the worst two', () => {
    expect(resolveRoll({ dice: [2, 9, 7], bonus: 0, adv: 1, defense: 12 }).kept).toEqual([7, 9])
    expect(resolveRoll({ dice: [2, 9, 7], bonus: 0, adv: -1, defense: 12 }).kept).toEqual([2, 7])
  })
  it('Advantage and Disadvantage cancel and never stack', () => {
    expect(netAdv(1, -1)).toBe(0)
    expect(netAdv(1, 1, -1)).toBe(0)
    expect(netAdv(1, 1)).toBe(1)
    expect(netAdv(-1, -1)).toBe(-1)
    expect(netAdv()).toBe(0)
  })
  it('Only one Edge applies; Edge and Advantage stack', () => {
    expect(resolveRoll({ dice: [5, 5], bonus: 1, edge: 3, defense: 12 }).total).toBe(13)
    const r = resolveRoll({ dice: [1, 5, 5], bonus: 1, edge: true, adv: 1, defense: 12 })
    expect(r.total).toBe(13)
  })
  it('Impact tops out at 3; upgrades stop at 3 and never turn a miss into a hit', () => {
    expect(resolveRoll({ dice: [10, 10], bonus: 4, defense: 11 }).impact).toBe(3)
    expect(upgrade(1)).toBe(2)
    expect(upgrade(3)).toBe(3)
    expect(upgrade(0)).toBe(0)
  })
  it('A Jab is -2 and a hit is always Impact 1', () => {
    const r = resolveRoll({ dice: [10, 10], bonus: 4, defense: 12, jab: true })
    expect(r.total).toBe(22)
    expect(r.impact).toBe(1)
  })
  it('flags dice that are out of range or the wrong count', () => {
    expect(resolveRoll({ dice: [0, 11], bonus: 0, defense: 12 }).errors.length).toBeGreaterThan(0)
    expect(resolveRoll({ dice: [5, 5], bonus: 0, adv: 1, defense: 12 }).errors.length).toBeGreaterThan(0)
  })
})

describe('Harm', () => {
  it('Weapon bonuses add Harm, never Impact', () => {
    expect(harm({ impact: 2, weapon: 'light', targetToughness: 0 }).harm).toBe(3)
    expect(harm({ impact: 1, weapon: 'light', targetToughness: 0 }).harm).toBe(1)
    expect(harm({ impact: 1, weapon: 'heavy', targetToughness: 0 }).harm).toBe(2)
    expect(harm({ impact: 3, weapon: 'heavy', targetToughness: 0 }).harm).toBe(4)
  })
  it('A Jab never gets Impact 2 bonuses', () => {
    expect(harm({ impact: 3, weapon: 'light', targetToughness: 0, jab: true }).harm).toBe(1)
    expect(harm({ impact: 2, weapon: 'pistol', targetToughness: 0, jab: true }).harm).toBe(1)
  })
  it('Guns add 1 on Impact 2+; only armor Toughness (passed in) reduces them', () => {
    expect(harm({ impact: 1, weapon: 'pistol', targetToughness: 1 }).harm).toBe(1)
    expect(harm({ impact: 2, weapon: 'pistol', targetToughness: 1 }).harm).toBe(2)
    expect(harm({ impact: 2, gun: true, targetToughness: 2 }).harm).toBe(1)
  })
  it('Mighty adds 1 on Impact 2+ and ignores Toughness', () => {
    expect(harm({ impact: 2, mighty: true, targetToughness: 1 }).harm).toBe(3)
  })
  it('Toughness subtracts, but a hit always does at least 1', () => {
    expect(harm({ impact: 1, targetToughness: 1 }).harm).toBe(1)
    expect(harm({ impact: 2, targetToughness: 1 }).harm).toBe(1)
    expect(harm({ impact: 3, targetToughness: 2 }).harm).toBe(1)
  })
  it('Blades add 1 only against no Toughness', () => {
    expect(harm({ impact: 1, weapon: 'knife', targetToughness: 0 }).harm).toBe(2)
    expect(harm({ impact: 1, weapon: 'knife', targetToughness: 1 }).harm).toBe(1)
  })
  it('Mook attacks cap at 2, applied last', () => {
    const r = harm({ impact: 3, gun: true, targetToughness: 0, fromMook: true })
    expect(r.harm).toBe(2)
    expect(r.steps.at(-1)!.label).toMatch(/cap/)
  })
  it('a miss does nothing', () => {
    expect(harm({ impact: 0, weapon: 'heavy', targetToughness: 0 }).harm).toBe(0)
  })
  it('shows its working', () => {
    const r = harm({ impact: 2, weapon: 'light', targetToughness: 1, extra: [{ source: 'Haymaker', value: 1 }] })
    expect(r.steps.map((s) => s.running)).toEqual([2, 3, 4, 3])
    expect(r.harm).toBe(3)
  })
})

describe('simHero matches the simulator\'s own sample heroes (make_heroes, gear on)', () => {
  it('Bulwark', () => expect(simHero(hero('Bulwark'))).toMatchObject({
    key: 'bulwark', arch: 'Protector', trait: 'Mercy', force: 3, flow: 0, focus: 1, presence: 2,
    boxes: 5, medkit: 1, power: 'Toughness', tough_blunt: 1, guard_bonus: 1, weapon: 'unarmed', strange: false,
  }))
  it('Rook', () => expect(simHero(hero('Rook'))).toMatchObject({
    key: 'rook', boxes: 5, weapon: 'light', armor_guns: 1, medkit: 1, flairs: ['hard_to_kill'], not_simulated: [],
  }))
  it('Nightjar', () => expect(simHero(hero('Nightjar'))).toMatchObject({
    weapon: 'light', flairs: ['opportunist'], power: 'Shadow Manipulation', strange: true, boxes: 4,
  }))
  it('Patchwork lists what the simulator leaves out', () => expect(simHero(hero('Patchwork'))).toMatchObject({
    weapon: 'unarmed',
    not_simulated: ['Patchwork: Night-vision goggles', 'Patchwork: Grapple line', 'Patchwork: Earpiece comms'],
  }))
  it('The Ledger', () => expect(simHero(hero('The Ledger'))).toMatchObject({
    key: 'ledger', weapon: 'pistol', armor_guns: 1, not_simulated: [],
  }))
  it('carries current Harm, Stress and Drive', () => {
    expect(simHero({ ...hero('Rook'), harm: 2, stress: 4, drive: 1 })).toMatchObject({ harm: 2, stress: 4, drive: 1 })
  })
})

describe('Rules data stays in step with rules.md', () => {
  const md = readFileSync(resolve(import.meta.dirname, '../../../rules/rules.md'), 'utf8').toLowerCase()
  const base = (n: string) => n.replace(/\s*\(.*\)\s*$/, '').toLowerCase()
  const cases: [string, { name: string }[]][] = [
    ['gear', GEAR], ['kit', KIT], ['power', POWERS], ['flair', FLAIRS], ['archetype', ARCHETYPES], ['trait', TRAITS],
  ]
  for (const [kind, list] of cases) {
    it(`every ${kind} named in the data appears in rules.md`, () => {
      const missing = list.map((x) => x.name).filter((n) => !md.includes(base(n)))
      expect(missing).toEqual([])
    })
  }
  it('ids are unique within each file', () => {
    for (const [, list] of cases) {
      const ids = (list as { id?: string }[]).map((x) => x.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
  it('clock sizes match the clocks table in rules.md', () => {
    // | **Scheme** (team) | 6 | ...   (the Endgame clock lives in the Arcs chapter: "Endgame clock: 8 segments")
    const fromTable = (name: string) => Number(md.match(new RegExp(`\\|\\s*\\*\\*${name}\\*\\*[^|]*\\|\\s*(\\d+)\\s*\\|`, 'i'))?.[1])
    for (const [kind, name] of [['scheme', 'scheme'], ['heat', 'heat'], ['home', 'home']] as const) {
      const clock = CORE.clocks.find((c) => c.kind === kind)!
      expect(clock.size, `${clock.name} clock`).toBe(fromTable(name))
    }
    expect(CORE.clocks.find((c) => c.kind === 'endgame')!.size).toBe(Number(md.match(/endgame clock:\*\*\s*(\d+) segments/)?.[1]))
  })
  it('every demo hero loadout id exists in the data', () => {
    for (const h of heroes) expect(slotsUsed(h).warnings.filter((w) => /isn't in the rules data/.test(w))).toEqual([])
  })
})

import { buildWarnings, dawn, priceOf, secondWind, startingDrive, stressFloor, usesLeft } from './index'

describe('Sheet bookkeeping', () => {
  const t = (o: Partial<{ harm: number; stress: number; drive: number; home_clock: number; dying: boolean }> = {}) =>
    ({ harm: 0, stress: 0, drive: 2, home_clock: 0, ...o })

  it('prices come from the rules data', () => {
    expect([priceOf('edge'), priceOf('upgrade'), priceOf('signature'), priceOf('second_wind')]).toEqual([1, 2, 3, 3])
  })
  it('Dawn: Sleep It Off clears Stress; Patch Up leaves at most a Bruise; Show Up spares Home', () => {
    const r = dawn(hero('Rook'), t({ harm: 3, stress: 6, home_clock: 2 }), ['sleep_it_off', 'patch_up'])
    expect(r.patch).toMatchObject({ stress: 0, harm: 1, home_clock: 3 }) // didn't Show Up -> Home +1
    const s = dawn(hero('Rook'), t({ harm: 3, stress: 6, home_clock: 2 }), ['patch_up', 'show_up'])
    expect(s.patch.home_clock).toBeUndefined()
    expect(s.patch.stress).toBeUndefined()
  })
  it('Dawn: Down needs Patch Up and Sleep It Off together', () => {
    const down = t({ harm: 5 }) // Rook has 5 boxes
    expect(dawn(hero('Rook'), down, ['patch_up', 'show_up']).patch.harm).toBeUndefined()
    expect(dawn(hero('Rook'), { ...down, dying: true }, ['patch_up', 'sleep_it_off']).patch).toMatchObject({ harm: 1, dying: false })
  })
  it('Dawn: Lay Low and Work the Case are for the GM; Drive above 3 drops to 3', () => {
    const r = dawn(hero('Rook'), t({ drive: 5 }), ['lay_low', 'work_the_case'])
    expect(r.gmTasks).toHaveLength(2)
    expect(r.patch.drive).toBe(3)
    expect(dawn(hero('Rook'), t({ drive: 3 }), ['show_up', 'lay_low']).patch.drive).toBeUndefined()
  })
  it('Home never goes past 6', () => {
    expect(dawn(hero('Rook'), t({ home_clock: 6 }), ['sleep_it_off', 'lay_low']).patch.home_clock).toBe(6)
  })
  it('Already Broken: Stress floor 4 and 4 Drive at the start of a Night', () => {
    const ab = { ...hero('Rook'), flair_ids: ['already-broken'] }
    expect(stressFloor(ab)).toBe(4)
    expect(startingDrive(ab)).toBe(4)
    expect(startingDrive(hero('Rook'))).toBe(2)
    expect(dawn(ab, t({ stress: 8 }), ['sleep_it_off', 'show_up']).patch.stress).toBe(4)
  })
  it('Second Wind clears one Harm box (a Down hero comes back up at Wounded) and warns, never blocks', () => {
    expect(secondWind({ harm: 5, drive: 3 }, false)).toMatchObject({ cost: 3, harmDelta: -1, warnings: [] })
    expect(secondWind({ harm: 0, drive: 1 }, true).warnings).toHaveLength(3)
  })
  it('item uses per fight', () => {
    expect(usesLeft({ 'uses:taser': 1 }, 'taser', 2)).toEqual({ used: 1, perFight: 2, left: 1 })
    expect(usesLeft(undefined, 'taser', 2).left).toBe(2)
  })
  it('Builder warnings: sample heroes are clean; a rule break warns', () => {
    // rules.md gives Rook and Nightjar a Flair in the simulator, but not Bulwark, Patchwork or the Ledger,
    // so the only warning a sample hero may have is the one-Flair reminder.
    for (const h of heroes) {
      const w = buildWarnings(h, { creation: true }).filter((x) => !/one Flair/.test(x))
      expect(w, h.name).toEqual([])
    }
    const bad = { ...hero('Rook'), stats: { force: 4, flow: 4, focus: 4, presence: 4 }, flair_ids: [] }
    const w = buildWarnings(bad, { creation: true })
    expect(w.some((x) => /starting array/.test(x))).toBe(true)
    expect(w.some((x) => /one Flair/.test(x))).toBe(true)
  })
  it('Advancement: extra slots raise the limit, and a second strange power is fine after creation', () => {
    const s: Sheet = { ...hero('Nightjar'), extra_slots: 3,
      loadout: [...hero('Nightjar').loadout!, { kind: 'power', id: 'mighty', flaw: 'marked' }, { kind: 'gear', id: 'knife' }] }
    expect(slotsUsed(s, { creation: false })).toMatchObject({ used: 6, max: 6, warnings: [] })
    expect(slotsUsed(s).warnings.some((x) => /one strange power/.test(x))).toBe(true)
  })
})

import { confrontationText, crackDefense, crackResultText, crackWarnings, minCluesToCrack, nextPhase, startNightDrive, theoryCount, tickClock } from './index'

describe('The Night', () => {
  it('Crack the Case: 2d10 + clues against 10 + Complexity; need half the Complexity in clues', () => {
    expect(crackDefense(6)).toBe(16)
    expect(minCluesToCrack(6)).toBe(3)
    expect(minCluesToCrack(5)).toBe(3)
    expect(crackWarnings(2, 6)).toHaveLength(1)
    expect(crackWarnings(3, 6)).toEqual([])
  })
  it('personal clues count 2; Case Sense adds 1 (Session 1: 9 clues + Case Sense = +10)', () => {
    expect(theoryCount([{ id: 'a', personal: false }, { id: 'b', personal: true }], false)).toBe(3)
    const nine = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, personal: false })).concat({ id: 'p', personal: false })
    expect(theoryCount(nine, true)).toBe(10)
    expect(theoryCount([], true)).toBe(0)
  })
  it('result text comes from the rules data', () => {
    expect(crackResultText(0)).toMatch(/Scheme clock ticks twice/)
    expect(confrontationText(1)).toMatch(/they're ready/)
    expect(confrontationText(3)).toMatch(/choose the ground/)
    expect(confrontationText(0)).toMatch(/villain chooses/)
  })
  it('clock ticks report half and full, and never pass the size', () => {
    expect(tickClock({ kind: 'scheme', size: 6, filled: 2 }, 1)).toMatchObject({ filled: 3, events: [expect.stringMatching(/digging/)] })
    expect(tickClock({ kind: 'scheme', size: 6, filled: 5 }, 2)).toMatchObject({ filled: 6, events: [expect.stringMatching(/pulls it off/)] })
    expect(tickClock({ kind: 'heat', size: 6, filled: 0 }, -1).filled).toBe(0)
  })
  it('phases run Patrol, Crack the Case, Confrontation, Dawn', () => {
    expect(nextPhase('patrol')).toBe('crack')
    expect(nextPhase('dawn')).toBeNull()
  })
  it('Start Night lifts Drive below 2 to 2 (4 with Already Broken) and leaves more alone', () => {
    expect(startNightDrive(hero('Rook'), 0)).toBe(2)
    expect(startNightDrive(hero('Rook'), 3)).toBe(3)
    expect(startNightDrive({ ...hero('Rook'), flair_ids: ['already-broken'] }, 1)).toBe(4)
  })
})

describe('Armor vs guns (Stephen, Nov 11): harm() subtracts the Toughness it is handed', () => {
  const vs = (sheet: Sheet, impact: number, o: { weapon?: 'pistol' | 'unarmed'; mook?: boolean } = {}) => {
    const weapon = o.weapon ?? 'pistol'
    const kind = weapon === 'pistol' ? 'gun' : 'blunt'
    return harm({ impact, weapon, targetToughness: toughness(sheet, kind).value, fromMook: o.mook }).harm
  }
  const bulwarkWithPower: Sheet = { stats: { force: 3, flow: 0, focus: 1, presence: 2 }, loadout: [{ kind: 'power', id: 'toughness' }] }
  it('Impact 2 pistol vs Rook (Force +4, Kevlar) = 2', () => expect(vs(hero('Rook'), 2)).toBe(2))
  it('Impact 2 pistol vs Nightjar (Force +1, no armor) = 3', () => expect(vs(hero('Nightjar'), 2)).toBe(3))
  it('Impact 2 pistol vs Bulwark (Force +3, Toughness power, no vest) = 3', () => expect(vs(bulwarkWithPower, 2)).toBe(3))
  it('Impact 1 pistol vs Rook = 1 (the minimum)', () => expect(vs(hero('Rook'), 1)).toBe(1))
  it('Impact 2 punch vs Rook = 1', () => expect(vs(hero('Rook'), 2, { weapon: 'unarmed' })).toBe(1))
  it('Impact 2 mook pistol vs Nightjar = 2 (mook cap, applied last)', () => expect(vs(hero('Nightjar'), 2, { mook: true })).toBe(2))
  it('toughness table: Force, Kevlar, Tactical armor, Toughness power; hazards always 0', () => {
    const t = (loadout: Sheet['loadout'], force: number) => (['blunt', 'blade', 'gun', 'hazard'] as const)
      .map((k) => toughness({ stats: { force, flow: 0, focus: 0, presence: 0 }, loadout }, k).value)
    expect(t([], 3)).toEqual([1, 1, 0, 0])
    expect(t([{ kind: 'gear', id: 'kevlar-vest' }], 0)).toEqual([0, 1, 1, 0])
    expect(t([{ kind: 'gear', id: 'tactical-armor' }], 0)).toEqual([1, 1, 1, 0])
    expect(t([{ kind: 'power', id: 'toughness' }], 0)).toEqual([1, 0, 0, 0])
  })
})
