import { describe, expect, it } from 'vitest'
import { ARCHETYPES, CORE, GEAR, POWERS, defenses } from '../engine'
import { defenseNumbers, partySummary, type Hero, type RulesData } from '../../../supabase/functions/rules-helper/party'
import heroes from '../../../supabase/seed/demo-heroes.json'

const data: RulesData = { defenseBase: CORE.defense_base, archetypes: ARCHETYPES, gear: GEAR, powers: POWERS }

describe('rules helper party summary', () => {
  it('computes the same defenses as the engine for every sample hero', () => {
    for (const h of heroes as unknown as Hero[]) {
      const d = defenses(h as never)
      expect(defenseNumbers(h, data), h.name).toEqual({ guard: d.guard.total, wits: d.wits.total, poise: d.poise.total })
    }
  })
  it('names each hero with defenses', () => {
    const text = partySummary(heroes as unknown as Hero[], data)
    expect(text).toContain('Bulwark')
    expect(text).toMatch(/Bulwark[^\n]*Guard 13/)
  })
})
