// Pure helpers for the rules helper: no imports, so the Edge Function and Vitest both load them.
// Defense maths mirrors web/src/engine/sheet.ts `defenses`; party.test.ts keeps the two in step.

export type RulesData = {
  defenseBase: number
  archetypes: { id: string; name: string }[]
  gear: { id: string; name: string; guard?: number }[]
  kit: { id: string; name: string }[]
  powers: { id: string; name: string; effects?: { level: number; guard?: number }[] }[]
}
type Item = { kind: string; id: string; ability_level?: number; flaw?: string; custom_text?: string }
export type Hero = {
  name: string
  archetype_id?: string | null
  stats: { force: number; flow: number; focus: number; presence: number }
  loadout?: Item[]
  harm?: number
  stress?: number
  drive?: number
  dying?: boolean
  is_npc?: boolean
}

export function defenseNumbers(h: Hero, d: RulesData) {
  let guard = 0
  for (const it of h.loadout ?? []) {
    if (it.kind === 'gear') guard += d.gear.find((g) => g.id === it.id)?.guard ?? 0
    if (it.kind === 'power') {
      const p = d.powers.find((x) => x.id === it.id)
      for (const e of p?.effects ?? []) if (e.level <= (it.ability_level ?? 1)) guard += e.guard ?? 0
    }
  }
  return {
    guard: d.defenseBase + h.stats.flow + guard,
    wits: d.defenseBase + h.stats.focus,
    poise: d.defenseBase + h.stats.presence,
  }
}

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

export function partySummary(heroes: Hero[], d: RulesData): string {
  return heroes.map((h) => {
    const def = defenseNumbers(h, d)
    const items = (h.loadout ?? []).map((it) => {
      const list = it.kind === 'gear' ? d.gear : it.kind === 'kit' ? d.kit : d.powers
      const name = list.find((x) => x.id === it.id)?.name ?? it.id
      return it.kind === 'power' && it.ability_level ? `${name} (ability ${it.ability_level})` : name
    })
    const arch = d.archetypes.find((a) => a.id === h.archetype_id)?.name ?? 'no archetype'
    const s = h.stats
    return `${h.name} (${arch}): Force ${sign(s.force)}, Flow ${sign(s.flow)}, Focus ${sign(s.focus)}, Presence ${sign(s.presence)}. ` +
      `Guard ${def.guard}, Wits ${def.wits}, Poise ${def.poise}. Loadout: ${items.join(', ') || 'none'}. ` +
      `Harm ${h.harm ?? 0}, Stress ${h.stress ?? 0}, Drive ${h.drive ?? 0}${h.dying ? ', DYING' : ''}.`
  }).join('\n')
}

export const SYSTEM_INSTRUCTION = `You are the rules helper for the tabletop game Street Level. The GM asks how to run something. Answer from the RULES text and the PARTY (and SCENE or CASE FILE when supplied) below.

Rules for every answer:
- Use only the supplied rules. If the rules don't cover it, say so, then offer one suggestion labeled "Ruling".
- Name the roll: who rolls, which stat, and the defense as a number, using the real heroes, for example "Nightjar rolls Flow +4 against 13". Take stat bonuses and defense numbers from the PARTY lines and the rules.
- Say what a Miss and each Impact level mean in this situation.
- For Impact 1, offer two costs that fit the scene.
- Mention any clock, Stress or Drive effect.
- Stay under 150 words unless the GM asks for more. Plain text, no headings, no markdown.
- The GM decides. Never claim certainty the rules don't give you.`
