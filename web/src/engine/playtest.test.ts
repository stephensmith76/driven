// M4 check: rolls taken from the Session 1 playtest log in rules/rules.md.
// Each row is typed in from the log's table (who, stat bonus, Edge, Advantage, Jab, dice, defense),
// and the engine must give the logged total, margin and Impact.
import { describe, expect, it } from 'vitest'
import {
  CSV_COLUMNS, diceNeeded, enemyHit, enemyState, evaluate, gangGroups, harm, heroHit, mooksDropped,
  obstacleDefense, publicEnemy, rollRow, rollsCsv, setupAdv, standDown, villainTurns, namedTurns,
  type Enemy, type RollSetup,
} from './index'

type Logged = {
  n: number; who: string
  bonus: number; edge?: boolean; adv?: 1 | -1; jab?: boolean
  dice: number[]; defense: number
  /** From the log's "Total vs def" and "Result" columns. */
  total: number; impact: number
}

const LOG: Logged[] = [
  { n: 1, who: 'Rook: Strike a Saint', bonus: 4, dice: [5, 3], defense: 11, total: 12, impact: 1 },
  { n: 2, who: 'Rook: Pile Through Jab', bonus: 4, jab: true, dice: [1, 4], defense: 11, total: 7, impact: 0 },
  { n: 3, who: 'Saints: pistol at Rook', bonus: 2, dice: [9, 7], defense: 12, total: 18, impact: 2 },
  { n: 4, who: 'Ruth: free the hose coupling', bonus: 4, edge: true, dice: [7, 9], defense: 11, total: 22, impact: 3 },
  { n: 5, who: 'Nightjar: climb the wall', bonus: 4, edge: true, dice: [6, 3], defense: 13, total: 15, impact: 1 },
  { n: 6, who: 'Ruth: talk family down', bonus: 2, edge: true, dice: [10, 4], defense: 13, total: 18, impact: 2 },
  { n: 7, who: 'Saints: pistol at Rook', bonus: 2, dice: [1, 9], defense: 12, total: 12, impact: 1 },
  { n: 8, who: 'Nightjar: drop from roof', bonus: 4, dice: [2, 6], defense: 13, total: 12, impact: 0 },
  { n: 9, who: 'Nightjar: Strike pistol Saint', bonus: 4, edge: true, dice: [2, 1], defense: 11, total: 9, impact: 0 },
  { n: 10, who: 'Rook (Down): stab the van tire', bonus: 4, adv: -1, dice: [3, 3, 6], defense: 11, total: 10, impact: 0 },
  { n: 11, who: 'Ruth: talk the mother down', bonus: 2, edge: true, dice: [10, 7], defense: 13, total: 21, impact: 3 },
  { n: 13, who: 'Nightjar: lead the getaway', bonus: 4, dice: [1, 4], defense: 11, total: 9, impact: 0 },
  { n: 14, who: 'Ruth: interrogate the Saint', bonus: 2, edge: true, dice: [1, 10], defense: 13, total: 15, impact: 1 },
  { n: 15, who: 'Rook: lean on Kenny Lam', bonus: 4, dice: [6, 7], defense: 13, total: 17, impact: 2 },
  { n: 16, who: 'Nightjar: break into the property office', bonus: 4, dice: [6, 8], defense: 15, total: 18, impact: 1 },
  { n: 17, who: 'Ruth: search the cooled annex', bonus: 4, edge: true, dice: [6, 4], defense: 11, total: 16, impact: 2 },
  { n: 18, who: 'Team: Crack the Case', bonus: 10, dice: [4, 2], defense: 16, total: 16, impact: 1 },
  { n: 19, who: 'Rook: Strike a dock Saint', bonus: 4, dice: [4, 4], defense: 11, total: 12, impact: 1 },
  { n: 20, who: 'Rook: Pile Through Jab', bonus: 4, jab: true, dice: [2, 4], defense: 11, total: 8, impact: 0 },
  { n: 21, who: 'Dock Saints: pistol at Rook', bonus: 2, dice: [1, 5], defense: 12, total: 8, impact: 0 },
  { n: 22, who: 'Nightjar: Strike from Hidden', bonus: 4, adv: 1, dice: [8, 7, 5], defense: 11, total: 19, impact: 3 },
  { n: 23, who: 'Butcher: backhand Nightjar', bonus: 4, edge: true, dice: [9, 1], defense: 14, total: 16, impact: 1 },
  { n: 24, who: 'Ruth: open the padlocked freezer', bonus: 4, edge: true, dice: [6, 2], defense: 13, total: 14, impact: 1 },
  { n: 25, who: 'Nightjar: chase the Butcher', bonus: 4, edge: true, dice: [5, 7], defense: 10, total: 18, impact: 3 },
  { n: 26, who: 'Rook: Strike the Butcher', bonus: 4, dice: [10, 3], defense: 10, total: 17, impact: 2 },
  { n: 27, who: 'Butcher: swing at Rook', bonus: 4, dice: [3, 1], defense: 12, total: 8, impact: 0 },
  { n: 28, who: 'Nightjar: Strike, he is down', bonus: 4, edge: true, adv: 1, dice: [4, 1, 6], defense: 10, total: 16, impact: 2 },
  { n: 29, who: 'Nightjar: Strike again', bonus: 4, edge: true, adv: 1, dice: [4, 10, 4], defense: 10, total: 20, impact: 3 },
  { n: 30, who: 'Butcher: lunge at Nightjar', bonus: 4, edge: true, dice: [2, 3], defense: 14, total: 11, impact: 0 },
  { n: 31, who: 'Rook: grab and slam him down', bonus: 4, dice: [10, 2], defense: 10, total: 16, impact: 2 },
]

const setupOf = (r: Logged): RollSetup => ({
  bonus: r.bonus, edge: Boolean(r.edge), advantage: r.adv === 1, disadvantage: r.adv === -1,
  jab: Boolean(r.jab), defense: r.defense,
})

describe('M4 check: playtest log rolls give the logged total, margin and Impact', () => {
  it('uses at least 20 rolls', () => expect(LOG.length).toBeGreaterThanOrEqual(20))
  for (const r of LOG) {
    it(`roll ${r.n} (${r.who}): ${r.total} vs ${r.defense}, Impact ${r.impact}`, () => {
      const res = evaluate(setupOf(r), r.dice)
      expect(res.errors).toEqual([])
      expect(res.total).toBe(r.total)
      expect(res.margin).toBe(r.total - r.defense)
      expect(res.impact).toBe(r.impact)
    })
  }
})

describe('Harm lines from the playtest log', () => {
  it('roll 3: pistol, Impact 2, +1 gun = 3 Harm (a Saint is a mook, so the app caps it at 2)', () => {
    expect(harm({ impact: 2, weapon: 'pistol', targetToughness: 0 }).harm).toBe(3)
    expect(harm({ impact: 2, weapon: 'pistol', targetToughness: 0, fromMook: true }).harm).toBe(2)
  })
  it('rolls 26, 28, 29, 31 against the Butcher (Toughness 1)', () => {
    expect(harm({ impact: 2, targetToughness: 1 }).harm).toBe(1)
    expect(harm({ impact: 3, targetToughness: 1 }).harm).toBe(2)
  })
})

describe('Roll setup rules', () => {
  const base: RollSetup = { bonus: 0, edge: false, advantage: false, disadvantage: false, jab: false, defense: 12 }
  it('Advantage and Disadvantage cancel and never stack', () => {
    expect(setupAdv({ advantage: true, disadvantage: true })).toBe(0)
    expect(diceNeeded({ advantage: true, disadvantage: true })).toBe(2)
    expect(diceNeeded({ advantage: true, disadvantage: false })).toBe(3)
  })
  it('Edge and Advantage stack', () => {
    const r = evaluate({ ...base, edge: true, advantage: true }, [3, 9, 5])
    expect(r.kept).toEqual([5, 9])
    expect(r.total).toBe(16)
  })
  it('obstacle ratings give 12 + rating', () => {
    expect(obstacleDefense(-1)).toBe(11)
    expect(obstacleDefense(3)).toBe(15)
  })
  it('typed dice outside 1 to 10 are errors', () => {
    expect(evaluate(base, [0, 5]).errors.length).toBeGreaterThan(0)
    expect(evaluate(base, [11, 5]).errors.length).toBeGreaterThan(0)
  })
})

describe('Roll log rows and CSV', () => {
  const setup: RollSetup = { bonus: 4, edge: true, advantage: false, disadvantage: false, jab: true, defense: 11 }
  const result = evaluate(setup, [5, 6])
  const row = rollRow({ actorName: 'Rook', characterId: null, label: 'Jab, "quick"', stat: 'force', setup, result, mode: 'manual' })
  it('folds the Jab into the bonus so total can be rebuilt from the row', () => {
    expect(row.bonus).toBe(2)
    expect(row.kept.reduce((a, b) => a + b, 0) + row.bonus + (row.edge ? 2 : 0)).toBe(row.total)
    expect(row.note).toContain('Jab')
  })
  it('CSV has the playtest column order, escapes quotes, and marks manual rolls', () => {
    const csv = rollsCsv([{ ...row, at: '2026-11-10T10:00:00Z' }])
    const [head, line] = csv.trim().split('\r\n')
    expect(head).toBe(CSV_COLUMNS.join(','))
    expect(head).toBe('actor,action,stat,bonus,adv,defense,dice,kept,total,margin,result,note')
    expect(line).toContain('"Jab, ""quick"""')
    expect(line).toContain('manual')
  })
})

describe('Enemies', () => {
  const named = (o: Partial<Enemy> = {}): Enemy => ({
    id: 'e1', campaign_id: 'c', name: 'The Butcher', kind: 'villain', stats: { force: 4, flow: 0, focus: 1, presence: 2 },
    defenses: { guard: 12, wits: 13, poise: 14 }, toughness: 1, harm: 0, harm_max: 10, stress: 0, count: 1, count_max: 1,
    drive: 2, zone: 'z1', line: '', source_id: null, ...o,
  })
  const mooks = (o: Partial<Enemy> = {}): Enemy => ({ ...named(), name: 'Saints', kind: 'mooks', stats: { attack: 2 }, harm_max: 1, count: 3, count_max: 3, ...o })

  it('players only get name, zone, mooks standing and a rough state: no numbers', () => {
    const pub = publicEnemy(named({ harm: 6, drive: 5, stress: 3 }))
    expect(Object.keys(pub).sort()).toEqual(['id', 'name', 'standing', 'state', 'zone'])
    expect(pub.standing).toBeNull()
    expect(pub.state).toBe('badly hurt')
    expect(JSON.stringify(pub)).not.toMatch(/harm|toughness|drive|stress|guard|wits|poise/i)
    expect(publicEnemy(mooks({ count: 2 })).standing).toBe(2)
  })
  it('rough states', () => {
    expect(enemyState(named())).toBe('fresh')
    expect(enemyState(named({ harm: 3 }))).toBe('hurt')
    expect(enemyState(named({ harm: 5 }))).toBe('badly hurt')
    expect(enemyState(named({ harm: 10 }))).toBe('down')
    expect(enemyState(mooks({ count: 1 }))).toBe('badly hurt')
    expect(enemyState(mooks({ count: 0 }))).toBe('down')
  })
  it('any hit drops one mook; a real Impact 3 drops a second', () => {
    expect([0, 1, 2, 3].map(mooksDropped)).toEqual([0, 1, 1, 2])
    expect(enemyHit(mooks(), 3, 3).patch).toEqual({ count: 1 })
    expect(enemyHit(mooks({ count: 1 }), 3, 3).patch).toEqual({ count: 0 })
    expect(enemyHit(mooks(), 0, 0).patch).toEqual({})
  })
  it('named enemies take Harm, never past their boxes', () => {
    expect(enemyHit(named({ harm: 9 }), 3, 4).patch).toEqual({ harm: 10 })
  })
  it('villain turns and gang size follow rules.md', () => {
    expect([1, 2, 3, 4, 5].map((n) => villainTurns(n, false))).toEqual([1, 1, 2, 2, 3])
    expect(villainTurns(3, true)).toBe(3)
    const v = (name: string, kind: 'villain' | 'lieutenant' | 'mooks') => ({ name, kind })
    expect(namedTurns([v('Butcher', 'villain')], 4)).toEqual([{ name: 'Butcher', kind: 'villain', turns: 4 }])
    expect(namedTurns([v('Butcher', 'villain'), v('Saints', 'mooks')], 4)[0].turns).toBe(2)
    expect(namedTurns([v('Lt', 'lieutenant')], 4)[0].turns).toBe(1)
    expect(namedTurns([v('Butcher', 'villain'), v('Lt', 'lieutenant')], 4).map((t) => t.turns)).toEqual([2, 1])
    expect(gangGroups(4, false)).toBe(4)
    expect([1, 2, 3, 4].map((n) => gangGroups(n, true))).toEqual([1, 1, 1, 2])
  })
})

describe('Hero Harm and End fight', () => {
  const stats = { force: 0, flow: 0, focus: 0, presence: 0 }
  const hero = (harmNow: number, o = {}) => ({ name: 'Rook', stats, harm: harmNow, ...o })
  it('a single hit stops at Down, however big', () => {
    expect(heroHit(hero(1), 9)).toMatchObject({ harmDelta: 3, dying: false })
  })
  it('a hit on someone already Down makes them Dying', () => {
    expect(heroHit(hero(4), 1)).toMatchObject({ harmDelta: 0, dying: true })
  })
  it('End fight stands a Down hero up at Wounded, but not a Dying one', () => {
    expect(standDown(hero(4))).toBe(3)
    expect(standDown(hero(4, { dying: true }))).toBeNull()
    expect(standDown(hero(2))).toBeNull()
  })
  it('Hard to Kill adds a box: Down is the fifth', () => {
    const h = hero(4, { flair_ids: ['hard-to-kill'] })
    expect(heroHit(h, 1).harmDelta).toBe(1)
  })
})
