import { useEffect, useState } from 'react'
import { useCampaign, useCharacters } from '../../data/hooks'
import { portraitUrl } from '../../data/portraits'
import type { Character } from '../../data/types'
import {
  CORE, RULES_VERSION, archetype, beltSlots, defenses, flair, harmBoxes, heroTrait, resolveLoadout,
  slotsUsed, stressStage, toughness, traitLine, usesToTrack, weaponOf, type AttackKind,
} from '../../engine'

const STATS = ['force', 'flow', 'focus', 'presence'] as const
const KINDS: AttackKind[] = ['blunt', 'blade', 'gun']
const CONNECTIONS = [
  ['protect', 'Someone you protect'], ['leverage', 'Someone with leverage over you'],
  ['place', "A place you're tied to"], ['mistake', 'A mistake that could come back'],
] as const

/** Rows for Advancement picks: the ones taken, then blanks for pencil. */
const ADVANCEMENT_ROWS = 6
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)
const end = (t: string) => (/[.!?)]$/.test(t.trim()) ? t : `${t}.`)

/**
 * A printable character sheet. "Save as PDF" in the browser's print dialog
 * turns it into a file. Page 1 is for play (tracks, uses, actions, Impact,
 * Drive); page 2 is the hero in full. The tracks can be filled to the hero's
 * current numbers or left blank for pencil.
 */
export function PrintSheet({ campaignId, characterId }: { campaignId: string; characterId: string }) {
  const { campaign } = useCampaign(campaignId)
  const { rows: characters } = useCharacters(campaignId)
  const hero = characters.find((c) => c.id === characterId)
  const [filled, setFilled] = useState(true)

  useEffect(() => {
    if (!hero) return
    const before = document.title
    document.title = `${hero.name} - Driven character sheet`
    return () => { document.title = before }
  }, [hero])

  if (!campaign || !hero) return <main className="page"><p className="muted">Loading hero…</p></main>

  return (
    <div className="print-wrap">
      <div className="print-bar no-print">
        <a href={`#/c/${campaignId}/sheet/${hero.id}`}>← Back to the sheet</a>
        <label className="small">
          <input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} /> Fill in current Harm, Stress, Drive and Home
        </label>
        <button onClick={() => window.print()}>Download PDF</button>
        <p className="small muted">In the print window, pick <strong>Save as PDF</strong> as the printer. It prints on two pages, made for both sides of one sheet. Letter or A4 both fit.</p>
      </div>
      <SheetPaper hero={hero} campaignName={campaign.name} filled={filled} />
    </div>
  )
}

function Boxes({ count, value, names }: { count: number; value: number; names?: string[] }) {
  return (
    <span className="p-boxes">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`p-box${i < value ? ' on' : ''}`}>{names?.[i] && <span className="p-boxname">{names[i]}</span>}</span>
      ))}
    </span>
  )
}

export function SheetPaper({ hero, campaignName, filled }: { hero: Character; campaignName: string; filled: boolean }) {
  const arch = archetype(hero.archetype_id)
  const t = heroTrait(hero)
  const d = defenses(hero)
  const boxes = harmBoxes(hero)
  const stage = stressStage(hero.stress).id
  const weapon = weaponOf(hero)
  const weaponRule = CORE.weapons.find((w) => w.id === weapon.id)
  const items = resolveLoadout(hero)
  const belt = items.filter((r) => r.kind === 'kit')
  const slots = slotsUsed(hero, { creation: false })
  const homeSize = CORE.clocks.find((c) => c.kind === 'home')!.size
  const flairs = (hero.flair_ids ?? []).map((id) => flair(id)).filter((f) => f !== undefined)
  const uses = usesToTrack(hero)
  const history = hero.advancements ?? []
  const pic = portraitUrl(hero.portrait)
  const v = (n: number) => (filled ? n : 0)
  const mark = (id: string) => (filled && stage === id ? ' ◀ now' : '')
  const earnText = (source: string) =>
    source === 'Your archetype trigger' && arch ? `${arch.name}: ${arch.drive_trigger}`
      : source === "Your Trait's Drive trigger" && t?.drive_trigger ? `${t.name}: ${t.drive_trigger}` : source

  return (
    <article className="paper">
      {/* Page 1: everything you look at during play. */}
      <div className="p-page">
        <header className="p-head">
          {pic && <img src={pic} alt="" className="p-portrait" />}
          <div className="p-title">
            <h1>{hero.name}</h1>
            <p>{hero.civilian && <>{hero.civilian} · </>}{arch?.name ?? 'No archetype'} · {t?.name ?? 'No Trait'}</p>
          </div>
          <p className="p-meta">DRIVEN<br />{campaignName}<br />Rules {RULES_VERSION}</p>
        </header>
        <div className="p-cols">
          <section>
            <h2>Stats</h2>
            <table className="p-stats">
              <tbody>
                <tr>{STATS.map((s) => <th key={s}>{CORE.stats.find((x) => x.id === s)!.name}</th>)}</tr>
                <tr>{STATS.map((s) => <td key={s} className="p-big">{signed(hero.stats[s])}</td>)}</tr>
              </tbody>
            </table>
            <p>
              <strong>Guard {d.guard.total}</strong> · <strong>Wits {d.wits.total}</strong> · <strong>Poise {d.poise.total}</strong>
              {d.guard.mods.length > 0 && <span className="p-muted"> (Guard includes {d.guard.mods.map((m) => `${signed(m.value)} ${m.source}`).join(', ')})</span>}
            </p>
            <p>
              <strong>Toughness</strong>{' '}
              {KINDS.map((k) => {
                const r = toughness(hero, k)
                return `${CORE.attack_kinds.find((a) => a.id === k)!.name.split(' ')[0]} ${r.value}${r.source ? ` (${r.source})` : ''}`
              }).join(' · ')}
            </p>
            <p><strong>Attack weapon: {weapon.source}.</strong> {weaponRule && end(weaponRule.text)}</p>
          </section>

          <section>
            <h2>Harm, Stress, Drive</h2>
            <div className="p-track"><span className="p-label">Harm</span><Boxes count={boxes.length} value={v(hero.harm)} names={boxes} /></div>
            <p className="p-muted p-scale">Wounded: Disadvantage on Force and Flow. Grit your teeth: 1 Stress at the start of your turn ignores it until your next turn.</p>
            <div className="p-track">
              <span className="p-label">Dying</span><Boxes count={1} value={filled && hero.dying ? 1 : 0} />
              <span className="p-muted p-inline">More Harm while Down. An ally's Full Action next to you stabilizes you.</span>
            </div>
            <div className="p-track"><span className="p-label">Stress</span><Boxes count={CORE.stress.boxes} value={v(hero.stress)} /></div>
            <p className="p-muted p-scale">Steady 0 to 3 · Fraying 4 to 7 · Breaking 8</p>
            <div className="p-track"><span className="p-label">Drive</span><Boxes count={CORE.drive.max} value={v(hero.drive)} /></div>
            <div className="p-track"><span className="p-label">Home</span><Boxes count={homeSize} value={v(hero.home_clock)} /></div>
          </section>

          <section>
            <h2>Uses <span className="p-h2note">tick when used, clear when the period ends</span></h2>
            <table className="p-uses">
              <tbody>
                {uses.map((u) => (
                  <tr key={u.source}><td>{u.source}</td><td className="p-per">per {u.period}</td><td className="p-tick"><Boxes count={u.count} value={0} /></td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Your turn</h2>
            <p>{CORE.actions.free_move} Then <strong>one Full Action or two Quick Actions</strong>.</p>
            <p><strong>Full:</strong> {CORE.actions.full.map((a) => `${a.name}. ${a.text}`).join(' ')}</p>
            <p>
              <strong>Quick:</strong> {CORE.actions.quick.map((a) => `${a.name}. ${a.text}`).join(' ')}
              {arch && arch.quick_actions.length > 0 && <> {arch.quick_actions.map((q) => q.name).join(', ')} ({arch.name}, page 2).</>}
            </p>
            <p><strong>Strain.</strong> {CORE.strain.text}</p>
            <p className="p-muted">{CORE.actions.breaking_away}</p>
          </section>

          <section>
            <h2>Rolling</h2>
            <p>Roll 2d10 + stat against the defense (12 + a stat). <strong>Margin</strong> = your total minus the defense.</p>
            <table className="p-impact">
              <thead><tr><th>Margin</th><th>Result</th><th>In a fight</th><th>Outside a fight</th></tr></thead>
              <tbody>
                {CORE.impact_bands.map((b) => (
                  <tr key={b.label}>
                    <td className="p-per">{b.min_margin == null ? 'Below 0' : b.max_margin == null ? `${b.min_margin}+` : `${b.min_margin} to ${b.max_margin}`}</td>
                    <td className="p-nowrap"><strong>{b.label}</strong></td><td>{b.fight}</td><td>{b.outside}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <strong>Advantage / Disadvantage:</strong> roll 3d10, keep the best two (or the worst two). They cancel out and never stack.{' '}
              <strong>Edge:</strong> +{CORE.edge_bonus}. Edge and Advantage can apply to the same roll.
            </p>
            <p className="p-muted">Hazards ignore Toughness. Toughness doesn't stack: the highest source counts.</p>
          </section>

          <section>
            <h2>Drive <span className="p-h2note">max {CORE.drive.max}</span></h2>
            <table className="p-uses">
              <tbody>
                {CORE.drive.prices.map((pr) => <tr key={pr.id}><td className="p-per"><strong>{pr.cost}</strong></td><td><strong>{pr.name}.</strong> {pr.text}</td></tr>)}
              </tbody>
            </table>
            <p><strong>Earn it:</strong></p>
            <ul className="p-list">
              {CORE.drive.earn.map((e) => <li key={e.source}>{earnText(e.source)} <span className="p-muted">+{e.gain}, {e.limit.toLowerCase()}</span></li>)}
            </ul>
          </section>
        </div>
      </div>

      {/* Page 2: the hero in full. */}
      <div className="p-page">
        <header className="p-head p-head2"><h1>{hero.name}</h1><p className="p-meta">Page 2</p></header>
        <div className="p-cols">
          {arch && (
            <section>
              <h2>{arch.name}</h2>
              <p><em>{arch.text}</em></p>
              <p><strong>Drive trigger.</strong> {arch.drive_trigger}</p>
              {arch.feature && <p><strong>{arch.feature.name}.</strong> {arch.feature.text}</p>}
              {arch.quick_actions.map((q) => <p key={q.id}><strong>{q.name} (Quick).</strong> {q.text}</p>)}
              <p><strong>Signature: {arch.signature.name} (3 Drive).</strong> {arch.signature.text}</p>
            </section>
          )}

          <section>
            <h2>Trait{t ? `: ${t.name}` : ''}</h2>
            {!t ? <p className="p-muted">No Trait picked.</p> : (
              <>
                {t.drive_trigger && <p><strong>Drive trigger.</strong> {t.drive_trigger}</p>}
                <p><strong>Steady (0 to 3).</strong> {traitLine(t, 'steady')}{mark('steady')}</p>
                <p><strong>Fraying (4 to 7).</strong> {traitLine(t, 'fraying')} <span className="p-muted">Replaces Steady.</span>{mark('fraying')}</p>
                {t.hook && <p><strong>Hook (while Fraying).</strong> {t.hook}</p>}
                <p><strong>Breaking (8).</strong> {traitLine(t, 'breaking')} <span className="p-muted">Your Fraying perk is off.</span>{mark('breaking')}</p>
              </>
            )}
          </section>

          <section>
            <h2>Flairs</h2>
            {flairs.length === 0 ? <p className="p-muted">None.</p> : flairs.map((f) => (
              <p key={f.id}><strong>{f.name}{f.trial ? ' (trial)' : ''}.</strong> {f.text}</p>
            ))}
          </section>

          <section className="p-flow">
            <h2>Loadout <span className="p-h2note">{slots.used}/{slots.max} slots</span></h2>
            {items.filter((r) => r.kind !== 'kit').map((r, i) => {
              if (r.kind === 'unknown') return <p key={i}><strong>{r.item.id}</strong> <span className="p-muted">(not in the rules data)</span></p>
              if (r.kind === 'gear') {
                const g = r.entry
                return (
                  <p key={i}>
                    <strong>{g.name}{r.item.free ? ' (free weapon)' : ''}.</strong> {g.text}
                    {g.uses_per_fight ? ` ${g.uses_per_fight} per fight.` : ''}
                    {r.item.custom_text && <span className="p-muted"> {r.item.custom_text}</span>}
                  </p>
                )
              }
              const p = r.entry
              const level = r.item.ability_level ?? 1
              return (
                <div key={i} className="p-power">
                  <p><strong>{p.name}</strong> <span className="p-muted">({p.tier}{p.note ? `, ${p.note}` : ''})</span></p>
                  <ol>
                    {p.abilities.map((a, n) => (
                      <li key={n} className={n + 1 <= level ? '' : 'p-locked'}>
                        <strong>{a.name}.</strong> {n + 1 <= level ? a.text : <span className="p-muted">Locked (Advancement).</span>}
                      </li>
                    ))}
                  </ol>
                  {p.extra && <p className="p-muted">{p.extra}</p>}
                  {r.item.custom_text && <p><strong>Source:</strong> {r.item.custom_text}</p>}
                  {r.item.flaw && <p><strong>Flaw:</strong> {r.item.flaw}</p>}
                </div>
              )
            })}
            {beltSlots(hero) > 0 && (
              <p>
                <strong>Utility belt ({beltSlots(hero)} picks each Night).</strong>{' '}
                {belt.length === 0 ? <span className="p-muted">None picked.</span> : belt.map((r) => (r.entry ? `${r.entry.name}: ${end(r.entry.text)}` : r.item.id)).join(' ')}
              </p>
            )}
            {items.some((r) => r.kind === 'power') && (
              <p className="p-muted">
                Push: {CORE.push.text.charAt(0).toLowerCase() + CORE.push.text.slice(1)}
                {items.some((r) => r.kind === 'power' && r.entry.tier === 'strange') && ' Strange powers cost 1 Stress the first time you use one in a fight or scene.'}
              </p>
            )}
          </section>

          <section>
            <h2>Connections</h2>
            {CONNECTIONS.map(([k, label]) => (
              <p key={k} className="p-line"><span className="p-muted">{label}:</span> {hero.connections?.[k] ?? ''}</p>
            ))}
            <p className="p-muted">Protecting one earns 1 Drive, once per scene.</p>
          </section>

          <section>
            <h2>Advancement <span className="p-h2note">one pick when a case closes</span></h2>
            <p className="p-muted">
              Stat +1 (max +4, never two cases in a row, total +10) · Flair (four at most) · next power ability · slot (six at most) · Asset or Lair room.
            </p>
            <table className="p-adv">
              <thead><tr><th className="p-case">Case</th><th>Pick</th></tr></thead>
              <tbody>
                {history.map((a, i) => <tr key={`a${i}`}><td>{i + 1}</td><td>{a.label}</td></tr>)}
                {Array.from({ length: Math.max(2, ADVANCEMENT_ROWS - history.length) }, (_, i) => <tr key={i}><td /><td /></tr>)}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Notes</h2>
            <p className="p-notes">{hero.notes}</p>
          </section>
        </div>
      </div>
    </article>
  )
}
