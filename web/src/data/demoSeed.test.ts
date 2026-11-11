import { describe, expect, it } from 'vitest'
import demoHeroesFile from '../../../supabase/seed/demo-heroes.json'
import { checkCase } from './caseFile'
import { demoArc, demoCase, demoClocks, demoHeroes, demoNotes, demoSettings } from './demoSeed'
import { TAGS, VILLAINS, defenses, villainFromEnemy, type Enemy } from '../engine'

const c = demoCase()

describe('the Butcher seed converts to the app formats', () => {
  it('the case passes the Case file check with no warnings', () => {
    expect(checkCase(c)).toEqual({ ok: true, warnings: [] })
  })
  it('has every clue: 10 case clues, 5 personal, 3 arc', () => {
    const k = c.clues!
    expect(k.filter((x) => !x.personal_for && !x.is_arc)).toHaveLength(10)
    expect(k.filter((x) => x.personal_for).map((x) => x.personal_for)).toEqual(['Bulwark', 'Rook', 'Nightjar', 'Patchwork', 'The Ledger'])
    expect(k.filter((x) => x.is_arc)).toHaveLength(3)
    expect(new Set(k.map((x) => x.id)).size).toBe(k.length)
  })
  it('reads the culprit, mode and scheme', () => {
    expect(c.mode).toBe('fixed')
    expect(c.culprit).toBe('Delia Marsh, property manager for Harbor & Main Holdings')
    expect(c.scheme_steps).toHaveLength(6)
    expect(c.scheme_steps![0]).not.toMatch(/^\d/)
  })
  it('scenes use real tags, and every link, enemy and extra points at a zone in that scene', () => {
    const tagIds = new Set(TAGS.tags.map((t) => t.id))
    for (const s of c.scenes!) {
      const zones = new Set(s.zones.map((z) => z.id))
      for (const z of s.zones) {
        for (const t of z.tags) expect(tagIds.has(t), `${s.id}/${z.id}: ${t}`).toBe(true)
        for (const l of z.links) expect(zones.has(l), `${s.id}/${z.id} -> ${l}`).toBe(true)
      }
      for (const e of s.enemies ?? []) expect(zones.has(e.zone!), `${s.id}: ${e.name} in ${e.zone}`).toBe(true)
      for (const x of s.extras ?? []) expect(zones.has(x.zone!), `${s.id}: ${x.name}`).toBe(true)
    }
    expect(c.scenes!.map((s) => s.id)).toEqual(['opening', 'confrontation'])
  })
  it('enemies point at the villain library and match its numbers', () => {
    const cannery = c.scenes![1].enemies!
    const lib = [...VILLAINS.villains, ...VILLAINS.mooks].map((v) => v.id)
    for (const e of cannery) expect(lib).toContain(e.source_id)
    const butcher = cannery.find((e) => e.kind === 'villain')!
    expect(villainFromEnemy({ ...butcher, id: 'x', campaign_id: 'c' } as Enemy)).toMatchObject({
      force: 4, flow: 0, focus: 1, presence: 2, harm_max: 10, toughness_v: 1, weapon: 'unarmed', role: 'villain',
    })
    expect(butcher.defenses).toEqual({ guard: 12, wits: 13, poise: 14 })
  })
  it('goal clocks: Annex collapses (shown) and Hostage (hidden)', () => {
    expect(demoClocks().map((k) => [k.name, k.kind, k.size, k.visible_to_players])).toEqual([
      ['Annex collapses', 'goal', 4, true], ['Hostage', 'goal', 4, false],
    ])
  })
  it('arc, notes and settings', () => {
    expect(demoArc().calling_card).toBe('Every damaged building has an eviction notice from Harbor & Main Holdings')
    expect(demoNotes()).toContain('Meat hook')
    expect(demoSettings()).toEqual({ players_can_build: true, players_see_sheets: true })
  })
})

describe('the seed heroes are the sample heroes', () => {
  const strip = (h: { name: string; archetype_id: string | null; trait_id: string | null; stats: unknown; flair_ids: string[]; loadout: { kind: string; id: string }[] }) =>
    ({ name: h.name, archetype_id: h.archetype_id, trait_id: h.trait_id, stats: h.stats, flair_ids: h.flair_ids, loadout: h.loadout.map((i) => `${i.kind}:${i.id}`) })
  it('same build as supabase/seed/demo-heroes.json', () => {
    expect(demoHeroes().map(strip)).toEqual((demoHeroesFile as never[]).map(strip))
  })
  it('M1 defenses still hold for the seed heroes', () => {
    const gwp = (h: Parameters<typeof defenses>[0]) => { const d = defenses(h); return [d.guard.total, d.wits.total, d.poise.total] }
    const d = Object.fromEntries(demoHeroes().map((h) => [h.name, gwp(h)]))
    expect(d).toEqual({ Bulwark: [13, 13, 14], Rook: [14, 11, 13], Nightjar: [16, 14, 11], Patchwork: [14, 15, 13], 'The Ledger': [13, 16, 14] })
  })
})
