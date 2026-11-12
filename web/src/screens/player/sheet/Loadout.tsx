import { GEAR, beltEligible, beltItem, beltSlots, resolveLoadout, usesLeft } from '../../../engine'
import { bump, setFlag, setKit } from '../../../data/writes'
import type { Character } from '../../../data/types'
import type { Report } from './Actions'

/** Every gear item and power with its rules text, limited-use counters, Push, flaw and the utility belt picker. */
export function Loadout({ hero, report, run }: {
  hero: Character
  report: Report
  run: (fn: () => Promise<unknown>) => void
}) {
  const items = resolveLoadout(hero).filter((r) => r.kind !== 'kit')
  const kitIds = hero.loadout.filter((i) => i.kind === 'kit').map((i) => i.id)
  const picks = beltSlots(hero)
  const fs = hero.fight_state

  const markUse = (id: string, name: string, perFight: number, delta: 1 | -1) => run(async () => {
    const u = usesLeft(fs, id, perFight)
    const next = Math.max(0, u.used + delta)
    await setFlag(hero.id, `uses:${id}`, next === 0 ? null : next)
    if (delta > 0 && u.left === 0) report(`${name} is out of uses this fight.`, [`${name} only has ${perFight} use${perFight === 1 ? '' : 's'} per fight.`])
  })

  const firstUse = (always: boolean) => run(async () => {
    const on = Boolean(fs.strange_used)
    await bump(hero.id, 'stress', on ? -1 : 1)
    await setFlag(hero.id, 'strange_used', on ? null : true)
    report(on ? 'Undid the first-use Stress.' : `${always ? 'First hit stopped' : 'First use'} this fight: +1 Stress.`)
  })

  const push = () => run(async () => {
    await bump(hero.id, 'stress', 1)
    report('Push: +1 Stress to roll with Advantage.')
  })

  const toggleKit = (id: string) => run(() => setKit(hero.id, kitIds.includes(id) ? kitIds.filter((k) => k !== id) : [...kitIds, id]))
  const toggleKitUsed = (id: string) => run(() => setFlag(hero.id, `kit:${id}`, fs[`kit:${id}`] ? null : true))
  const toggleOffline = (id: string, name: string) => run(async () => {
    const off = Boolean(fs[`offline:${id}`])
    await setFlag(hero.id, `offline:${id}`, off ? null : true)
    report(off ? `${name} is back online.` : `${name} cut out: no Toughness from it until you switch it back on.`)
  })
  const toggleActive = (id: string) => run(() => setFlag(hero.id, `active:${id}`, fs[`active:${id}`] ? null : true))

  return (
    <div className="stack">
      {items.length === 0 && <p className="muted small">Nothing in the loadout yet.</p>}
      {items.map((r, i) => {
        if (r.kind === 'unknown') {
          return <p key={i} className="small error">"{r.item.id}" isn't in the rules data.</p>
        }
        if (r.kind === 'gear') {
          const g = r.entry
          const u = g.uses_per_fight ? usesLeft(fs, g.id, g.uses_per_fight) : null
          return (
            <div key={i} className="item">
              <p><strong>{g.name}</strong>{r.item.custom_text && <span className="muted"> · {r.item.custom_text}</span>}</p>
              <p className="small">{g.text}</p>
              {g.unreliable && (
                <p className="small">
                  Status: <strong>{fs[`offline:${g.id}`] ? 'OFFLINE' : 'online'}</strong>{' '}
                  <button className={`mini ${fs[`offline:${g.id}`] ? '' : 'secondary'}`} aria-pressed={Boolean(fs[`offline:${g.id}`])}
                    onClick={() => toggleOffline(g.id, g.name)}>
                    {fs[`offline:${g.id}`] ? 'Switch back on (Quick Action)' : 'Cut out'}
                  </button>
                </p>
              )}
              {u && (
                <p className="small">
                  Uses left this fight: <strong>{u.left}/{u.perFight}</strong>{' '}
                  <button className="mini" onClick={() => markUse(g.id, g.name, u.perFight, 1)}>Use</button>{' '}
                  <button className="mini secondary" disabled={u.used === 0} onClick={() => markUse(g.id, g.name, u.perFight, -1)}>Undo</button>
                </p>
              )}
            </div>
          )
        }
        const p = r.entry
        const level = r.item.ability_level ?? 1
        const strange = p.tier === 'strange'
        return (
          <div key={i} className="item">
            <p>
              <strong>{p.name}</strong> <span className="tag">{p.tier}</span>
              {p.note && <span className="muted small"> · {p.note}</span>}
            </p>
            <ol className="abilities">
              {p.abilities.map((a, n) => (
                <li key={n} className={n + 1 <= level ? '' : 'locked'}>
                  <strong>{a.name}</strong>{n + 1 > level && ' (locked)'}. {n + 1 <= level && a.text}
                </li>
              ))}
            </ol>
            {p.extra && <p className="small muted">{p.extra}</p>}
            {r.item.custom_text && <p className="small"><strong>{strange ? 'Cost / source' : 'Source'}:</strong> {r.item.custom_text}</p>}
            {r.item.flaw && <p className="small"><strong>Flaw:</strong> {r.item.flaw}</p>}
            <div className="button-row">
              <button className="mini secondary" onClick={push}>Push (1 Stress)</button>
              {strange && p.first_use_stress !== false && (
                <button className={`mini ${fs.strange_used ? '' : 'secondary'}`} aria-pressed={Boolean(fs.strange_used)} onClick={() => firstUse(Boolean(p.always_on))}>
                  {p.always_on ? 'First hit stopped' : 'First use'} this fight: 1 Stress{fs.strange_used ? ' · taken' : ''}
                </button>
              )}
              {p.toggle && (
                <button className={`mini ${fs[`active:${p.id}`] ? '' : 'secondary'}`} aria-pressed={Boolean(fs[`active:${p.id}`])} onClick={() => toggleActive(p.id)}>
                  {p.toggle.name}: {fs[`active:${p.id}`] ? 'on' : 'off'}
                </button>
              )}
            </div>
          </div>
        )
      })}

      {(picks > 0 || kitIds.length > 0) && (
        <div className="item">
          <p><strong>Utility belt</strong> <span className="muted small">fill {picks} at the start of each Night · {kitIds.length} picked · sits outside your slots</span></p>
          {kitIds.length > picks && <p className="small error">You picked more than {picks}. That's allowed, but check with the GM.</p>}
          <div className="chips">
            {GEAR.filter(beltEligible).map((k) => (
              <button key={k.id} className={`chip ${kitIds.includes(k.id) ? 'on' : ''}`} aria-pressed={kitIds.includes(k.id)} onClick={() => toggleKit(k.id)} title={k.text}>
                {k.name}
              </button>
            ))}
          </div>
          {kitIds.map((id) => {
            const k = beltItem(id)
            if (!k) return null
            const used = Boolean(fs[`kit:${id}`])
            return (
              <p key={id} className="small">
                <strong>{k.name}.</strong> {k.text}{k.uses_per_fight ? ` (${k.uses_per_fight} per fight)` : ''}{' '}
                <button className={`mini ${used ? '' : 'secondary'}`} aria-pressed={used} onClick={() => toggleKitUsed(id)}>
                  {used ? 'Used this fight' : 'Mark used'}
                </button>
              </p>
            )
          })}
        </div>
      )}
    </div>
  )
}
