import { useEffect, useRef, useState } from 'react'
import { errorText } from '../../data/supabase'
import { useCampaign, useCharacters, useLiveRows, useMe } from '../../data/hooks'
import { bump, newFight, setField } from '../../data/writes'
import type { Clock, Clue, Connections } from '../../data/types'
import { HeroTrackers } from '../../components/HeroTrackers'
import { Track } from '../../components/Track'
import { ScenePanel } from '../../components/ScenePanel'
import { RollLog } from '../../components/RollLog'
import type { Scene } from '../../data/types'
import { RulesNotice } from '../../components/RulesNotice'
import { CORE, archetype, defenses, slotsUsed, toughness, trait, type AttackKind } from '../../engine'
import { Actions } from './sheet/Actions'
import { Loadout } from './sheet/Loadout'
import { DawnPanel } from './sheet/DawnPanel'

const STATS = ['force', 'flow', 'focus', 'presence'] as const
const SHOWN_KINDS: AttackKind[] = ['blunt', 'blade', 'gun']

/**
 * The player Sheet: one scrolling page with Harm, Stress and Drive pinned at the
 * top. A GM can open any hero's sheet by passing characterId.
 */
export function Sheet({ campaignId, characterId }: { campaignId: string; characterId?: string }) {
  const { campaign } = useCampaign(campaignId)
  const { rows: characters } = useCharacters(campaignId)
  const { rows: clocks } = useLiveRows<Clock>('clocks', campaignId, '*', { column: 'sort' })
  const { rows: clues } = useLiveRows<Clue>('clues', campaignId, '*', { column: 'night' })
  const { rows: scenes } = useLiveRows<Scene>('scene', campaignId)
  const { member, role } = useMe(campaignId)

  const [status, setStatus] = useState<{ message: string; warnings: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dawnOpen, setDawnOpen] = useState(false)

  const heroId = characterId ?? member?.character_id ?? null
  const hero = characters.find((c) => c.id === heroId)

  const report = (message: string, warnings: string[] = []) => setStatus({ message, warnings })
  const run = (fn: () => Promise<unknown>) => {
    setError(null)
    fn().catch((e) => setError(errorText(e)))
  }

  if (!campaign) return <main className="page"><p className="muted">Loading…</p></main>
  if (member && !heroId) {
    return (
      <main className="page">
        <p>No hero picked yet.</p>
        <a href={`#/join/${campaign.join_code}`}>Pick one</a>
      </main>
    )
  }
  if (!hero) return <main className="page"><p className="muted">Loading hero…</p></main>

  const isGm = role === 'gm'
  const d = defenses(hero)
  const active = Object.keys(hero.fight_state).filter((k) => k.startsWith('active:') && hero.fight_state[k]).map((k) => k.slice(7))
  const arch = archetype(hero.archetype_id)
  const t = trait(hero.trait_id)
  const slots = slotsUsed(hero, { creation: false })
  const homeSize = CORE.clocks.find((c) => c.kind === 'home')!.size
  const teamClocks = clocks.filter((c) => c.kind === 'scheme' || c.kind === 'heat')
  const myClues = clues.filter((c) => !c.is_arc || isGm)

  return (
    <main className="page">
      <header className="sheet-header card">
        <h1>{hero.name}</h1>
        <p className="muted small">
          {hero.civilian && <>{hero.civilian} · </>}{arch?.name ?? '—'} · {t?.name ?? '—'}
        </p>
        <HeroTrackers hero={hero} onChange={(f, v) => run(() => bump(hero.id, f, v - hero[f]))} />
      </header>

      {/* A floating notice, so showing it never moves the buttons under your thumb. */}
      <div role="status" aria-live="polite">
        {(status || error) && (
          <div className="card small toast">
            {status && <p>{status.message}</p>}
            {status?.warnings.map((w, i) => <p key={i} className="warn">⚠ {w}</p>)}
            {error && <p className="error">{error}</p>}
            <button className="mini secondary" onClick={() => { setStatus(null); setError(null) }}>Dismiss</button>
          </div>
        )}
      </div>
      <RulesNotice campaign={campaign} canAcknowledge={false} />

      <section className="card stack">
        <h2>Stats and defenses</h2>
        <div className="stat-grid">
          {STATS.map((s) => (
            <div key={s} className="stat">
              <span className="muted small">{CORE.stats.find((x) => x.id === s)!.name}</span>
              <strong>{hero.stats[s] > 0 ? `+${hero.stats[s]}` : hero.stats[s]}</strong>
              <a className="button secondary mini-link" href={`#/c/${campaignId}/rolls/${hero.id}/${s}`}>Roll</a>
            </div>
          ))}
        </div>
        <p>
          <strong>Guard {d.guard.total}</strong> · <strong>Wits {d.wits.total}</strong> · <strong>Poise {d.poise.total}</strong>
          {d.guard.mods.length > 0 && <span className="muted small"> (Guard {d.guard.base} + {d.guard.mods.map((m) => `${m.value} ${m.source}`).join(', ')})</span>}
        </p>
        <p className="small">
          <strong>Toughness</strong>{' '}
          {SHOWN_KINDS.map((k) => {
            const r = toughness(hero, k, { active })
            return <span key={k} className="tough">{CORE.attack_kinds.find((a) => a.id === k)!.name.split(' ')[0]} {r.value}{r.source ? ` (${r.source})` : ''}</span>
          })}
        </p>
        <p className="muted small">Hazards ignore Toughness unless a power or armor says otherwise. Toughness doesn't stack: the highest source counts.</p>
      </section>

      <section className="card stack">
        <h2>Actions</h2>
        <Actions hero={hero} report={report} run={run} />
      </section>

      <section className="card stack">
        <h2>Loadout <span className="muted small">{slots.used}/{slots.max} slots</span></h2>
        {slots.warnings.map((w, i) => <p key={i} className="warn small">⚠ {w}</p>)}
        <Loadout hero={hero} report={report} run={run} />
      </section>

      <section className="card stack">
        <h2>Clocks and clues</h2>
        <Track label="Home" value={hero.home_clock} max={homeSize} onChange={(v) => run(() => bump(hero.id, 'home_clock', v - hero.home_clock))} />
        {teamClocks.map((c) => <Track key={c.id} label={c.name} value={c.filled} max={c.size} />)}
        <h3>Clues found</h3>
        {myClues.length === 0 ? <p className="muted small">No clues yet.</p> : (
          <ul className="plain small">
            {myClues.map((c) => (
              <li key={c.id}>
                {c.text}{' '}
                {c.personal_for === hero.id && <span className="tag">personal</span>}
                {c.is_arc && <span className="tag">arc</span>}
                {c.night != null && <span className="muted"> · Night {c.night}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack">
        <h2>Scene</h2>
        <ScenePanel scene={scenes[0]} characters={characters} />
        <p className="small"><a href={`#/c/${campaignId}/rolls/${hero.id}`}>Open the dice roller and full roll log →</a></p>
      </section>

      <section className="card stack">
        <h2>Recent rolls</h2>
        <RollLog campaignId={campaignId} isGm={isGm} run={run} limit={5} />
      </section>

      <section className="card stack">
        <h2>Connections</h2>
        <ConnectionsField value={hero.connections ?? {}} onSave={(v) => run(() => setField('characters', hero.id, 'connections', v))} />
        <p className="muted small">When one is lost, resolved or betrayed, write a new one at the next Dawn. Protecting one earns 1 Drive, once per scene.</p>
      </section>

      <section className="card stack">
        <h2>Notes</h2>
        <NotesField value={hero.notes} onSave={(v) => run(() => setField('characters', hero.id, 'notes', v))} />
        <p className="muted small">Visible to you and the GM.</p>
      </section>

      <section className="card stack">
        <h2>Between scenes</h2>
        <div className="button-row">
          <button className="secondary" onClick={() => run(async () => { await newFight(hero.id); report('New fight: strange power, Second Wind, Kit and item uses cleared.') })}>New fight</button>
          <button className="secondary" onClick={() => setDawnOpen((o) => !o)}>Dawn</button>
        </div>
        {dawnOpen && <DawnPanel hero={hero} campaign={campaign} report={report} run={run} onClose={() => setDawnOpen(false)} />}
        {typeof hero.fight_state.dawn === 'object' && hero.fight_state.dawn && (
          <p className="muted small">
            Last Dawn (Night {(hero.fight_state.dawn as { night: number }).night}):{' '}
            {(hero.fight_state.dawn as { picks: string[] }).picks.map((p) => CORE.dawn.options.find((o) => o.id === p)?.name ?? p).join(', ')}
          </p>
        )}
      </section>

      <footer className="small stack">
        <p className="muted">{campaign.name} · Night {campaign.night} · {campaign.phase}</p>
        <p>
          {hero.locked && !isGm
            ? <span className="muted">The GM has locked this sheet's build.</span>
            : <a href={`#/c/${campaignId}/build/${hero.id}`}>Edit build and Advancement</a>}
          {' · '}
          {isGm ? <a href="#/gm">GM table</a> : <a href={`#/join/${campaign.join_code}`}>Switch hero</a>}
        </p>
      </footer>
    </main>
  )
}

const CONNECTION_LABELS = [
  ['protect', 'Someone you protect'], ['leverage', 'Someone with leverage over you'],
  ['place', "A place you're tied to"], ['mistake', 'A mistake that could come back'],
] as const

/** Four one-line connections; each saves when you leave it. */
function ConnectionsField({ value, onSave }: { value: Connections; onSave: (v: Connections) => void }) {
  const [text, setText] = useState<Connections>(value)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(value) }, [value])
  return (
    <div className="stack">
      {CONNECTION_LABELS.map(([k, label]) => (
        <div key={k} className="stack">
          <label htmlFor={`conn-${k}`} className="muted small">{label}</label>
          <input id={`conn-${k}`} value={text[k] ?? ''} maxLength={160}
            onChange={(e) => setText({ ...text, [k]: e.target.value })}
            onFocus={() => { focused.current = true }}
            onBlur={() => {
              focused.current = false
              if ((text[k] ?? '') !== (value[k] ?? '')) onSave(Object.fromEntries(Object.entries(text).filter(([, v]) => v)) as Connections)
            }} />
        </div>
      ))}
    </div>
  )
}

/** A text box that saves when you leave it, and follows changes from other devices while you're not typing. */
function NotesField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(value) }, [value])
  return (
    <textarea
      rows={4}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => { focused.current = true }}
      onBlur={() => { focused.current = false; if (text !== value) onSave(text) }}
      aria-label="Notes"
    />
  )
}
