import { useState } from 'react'
import { useCharacters, useLiveRows } from '../../data/hooks'
import { setField } from '../../data/writes'
import { addEnemy, endFight, removeEnemy, setEnemyField, setScene } from '../../data/fight'
import { heroesOf } from '../../data/gm'
import type { Clock, Scene, Zone } from '../../data/types'
import { ClocksPanel } from '../../components/gm/ClocksPanel'
import { RollLog } from '../../components/RollLog'
import { Roller, type Report, type Run } from '../../components/Roller'
import { Track } from '../../components/Track'
import { useRunner } from '../../components/Toast'
import {
  CORE, TAGS, customEnemy, enemyFromLibrary, enemyState, gangGroups, libraryEntries, namedTurns, tickClock, villainStress,
  type Enemy, type EnemyKind,
} from '../../engine'
import { GmShell, type GmContext } from './GmShell'

type Token = { kind: 'hero' | 'enemy'; id: string }

/** GM Fight screen: zone board, enemies, round counter, goal clocks, End fight, and the roller. */
export function Fight({ campaignId }: { campaignId: string }) {
  return <GmShell campaignId={campaignId} tab="fight">{(ctx) => <FightBody campaignId={campaignId} {...ctx} />}</GmShell>
}

function FightBody({ campaignId }: GmContext & { campaignId: string }) {
  const { rows: characters } = useCharacters(campaignId)
  const { rows: scenes } = useLiveRows<Scene>('scene', campaignId)
  const { rows: enemies, reload } = useLiveRows<Enemy>('enemies', campaignId, '*', { column: 'name' })
  const { rows: clocks } = useLiveRows<Clock>('clocks', campaignId, '*', { column: 'sort' })
  const { run: runBase, report, toast } = useRunner()
  const [selected, setSelected] = useState<Token | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)

  const scene = scenes[0]
  const heroes = heroesOf(characters)
  // Enemy writes aren't on Realtime (players never get them), so reload after each one.
  const run: Run = (fn) => runBase(async () => { await fn(); reload() })

  if (!scene) return <p className="muted">Loading the scene…</p>

  const named = enemies.some((e) => e.kind !== 'mooks')
  const alone = enemies.length === 1 && enemies[0].kind === 'villain'
  const goalClocks = clocks.filter((c) => c.kind === 'goal')

  const endRound = () => run(async () => {
    const lines: string[] = []
    for (const c of goalClocks) {
      const t = tickClock(c, 1)
      if (t.filled !== c.filled) await setField('clocks', c.id, 'filled', t.filled)
      if (t.events.length) lines.push(`${c.name}: ${t.events.join(' ')}`)
    }
    await setScene(scene.id, 'round', scene.round + 1)
    report(`Round ${scene.round} over. Goal clocks ticked last.`, lines)
  })

  const doEnd = () => run(async () => {
    const stood = await endFight(characters)
    setConfirmEnd(false)
    report('Fight over: per-fight flags cleared.', stood.length ? [`${stood.join(', ')} stand back up at Wounded.`] : [])
  })

  return (
    <>
      <section className="card stack">
        <div className="button-row">
          <h2>Round {scene.round || '—'}</h2>
          {scene.round === 0
            ? <button onClick={() => run(() => setScene(scene.id, 'round', 1))}>Start round 1</button>
            : <button onClick={endRound}>End of round</button>}
          <button className="mini secondary" disabled={scene.round <= 0} onClick={() => run(() => setScene(scene.id, 'round', Math.max(0, scene.round - 1)))}>Round −1</button>
          {confirmEnd ? (
            <>
              <button onClick={doEnd}>Yes, end the fight</button>
              <button className="secondary" onClick={() => setConfirmEnd(false)}>Keep going</button>
            </>
          ) : <button className="secondary" onClick={() => setConfirmEnd(true)}>End fight</button>}
        </div>
        <p className="small muted">
          {heroes.length} hero{heroes.length === 1 ? '' : 'es'} in the party.{' '}
          {named && <>Turns a round: {namedTurns(enemies, heroes.length).map((t, i) => (
            <span key={i}>{i ? ', ' : ''}{t.name} <strong>{t.turns}</strong>{t.kind === 'lieutenant' ? ' (lieutenant)' : alone ? ' (alone: one per hero)' : ''}</span>
          ))}. </>}
          Gang size to start: <strong>{gangGroups(heroes.length, named)}</strong> group{gangGroups(heroes.length, named) === 1 ? '' : 's'} of {CORE.villain_scaling.mook_group_size} mooks{named ? ' (a named villain is present)' : ''}. Then adjust for how hard it should be.
        </p>
        <p className="small muted">End of round ticks goal clocks last. End fight stands Down heroes who aren't Dying back up at Wounded and clears per-fight flags.</p>
      </section>

      <div className="gm-grid">
        <section className="card stack">
          <h2>Zone board</h2>
          <input aria-label="Scene title" placeholder="Scene title (The Cannery)" defaultValue={scene.title} key={`t${scene.id}`}
            onBlur={(e) => { if (e.target.value !== scene.title) run(() => setScene(scene.id, 'title', e.target.value)) }} />
          <ZoneBoard scene={scene} heroes={heroes} enemies={enemies} selected={selected} setSelected={setSelected}
            campaignId={campaignId} run={run} report={report} />
        </section>

        <section className="card stack">
          <h2>Enemies</h2>
          <EnemyPanel campaignId={campaignId} enemies={enemies} scene={scene} run={run} />
        </section>
      </div>

      <div className="gm-grid">
        <section className="card stack">
          <h2>Goal clocks</h2>
          <p className="muted small">A hostage, a fuse, sirens. They tick at the end of each round.</p>
          <ClocksPanel campaignId={campaignId} clocks={clocks} run={run} report={report} kinds={['goal']} />
        </section>
        <section className="card stack">
          <h2>Roll</h2>
          <Roller campaignId={campaignId} heroes={characters} enemies={enemies} isGm run={run} report={report} />
        </section>
      </div>

      <section className="card stack">
        <h2>Roll log</h2>
        <RollLog campaignId={campaignId} isGm run={run} limit={12} />
      </section>
      {toast}
    </>
  )
}

// ---------------------------------------------------------------- zone board

const newId = () => crypto.randomUUID().slice(0, 8)

function ZoneBoard({ scene, heroes, enemies, selected, setSelected, campaignId, run, report }: {
  scene: Scene; heroes: { id: string; name: string }[]; enemies: Enemy[]
  selected: Token | null; setSelected: (t: Token | null) => void
  campaignId: string; run: Run; report: Report
}) {
  const [newZone, setNewZone] = useState('')
  const zones = scene.zones
  const saveZones = (next: Zone[]) => setScene(scene.id, 'zones', next)
  const patchZone = (id: string, patch: Partial<Zone>) => run(() => saveZones(zones.map((z) => (z.id === id ? { ...z, ...patch } : z))))

  const move = (zoneId: string | null) => run(async () => {
    if (!selected) return
    if (selected.kind === 'hero') {
      const positions = { ...scene.positions }
      if (zoneId) positions[selected.id] = zoneId
      else delete positions[selected.id]
      await setScene(scene.id, 'positions', positions)
    } else {
      await setEnemyField(campaignId, selected.id, 'zone', zoneId)
    }
    setSelected(null)
  })

  const link = (a: Zone, b: Zone, on: boolean) => run(() => saveZones(zones.map((z) => {
    if (z.id === a.id) return { ...z, links: on ? [...new Set([...z.links, b.id])] : z.links.filter((x) => x !== b.id) }
    if (z.id === b.id) return { ...z, links: on ? [...new Set([...z.links, a.id])] : z.links.filter((x) => x !== a.id) }
    return z
  })))

  const removeZone = (z: Zone) => run(async () => {
    const positions = Object.fromEntries(Object.entries(scene.positions).filter(([, zid]) => zid !== z.id))
    await setScene(scene.id, 'positions', positions)
    for (const e of enemies.filter((x) => x.zone === z.id)) await setEnemyField(campaignId, e.id, 'zone', null)
    await saveZones(zones.filter((x) => x.id !== z.id).map((x) => ({ ...x, links: x.links.filter((l) => l !== z.id) })))
    report(`Removed ${z.name}.`)
  })

  const tokenButton = (t: Token, name: string, extra = '') => {
    const on = selected?.kind === t.kind && selected.id === t.id
    return (
      <button key={`${t.kind}${t.id}`} className={`token ${t.kind} ${on ? 'on' : ''}`} aria-pressed={on}
        onClick={() => setSelected(on ? null : t)}>{name}{extra}</button>
    )
  }
  const heroZone = (id: string) => scene.positions[id]
  const offMap = [
    ...heroes.filter((h) => !zones.some((z) => z.id === heroZone(h.id))).map((h) => ({ t: { kind: 'hero', id: h.id } as Token, name: h.name, extra: '' })),
    ...enemies.filter((e) => !zones.some((z) => z.id === e.zone)).map((e) => ({ t: { kind: 'enemy', id: e.id } as Token, name: e.name, extra: e.kind === 'mooks' ? ` ×${e.count}` : '' })),
  ]

  return (
    <div className="stack">
      {selected && <p className="small notice card">Tap a zone to move the token there. <button className="link" onClick={() => setSelected(null)}>Cancel</button></p>}
      <div className="zones">
        {zones.length === 0 && <p className="muted small">No zones yet. A fight map has 3 to 6 zones.</p>}
        {zones.map((z) => (
          <div key={z.id} className={`zone card ${selected ? 'target' : ''}`}>
            <div className="button-row">
              <strong>{z.name}</strong>
              {selected && <button className="mini" onClick={() => move(z.id)}>Move here</button>}
            </div>
            <div className="chips">{z.tags.map((t) => (
              <span key={t} className="tag" title={TAGS.tags.find((x) => x.id === t)?.text}>{TAGS.tags.find((x) => x.id === t)?.name ?? t}</span>
            ))}</div>
            {z.links.length > 0 && <p className="small muted">Connects to {z.links.map((l) => zones.find((x) => x.id === l)?.name).filter(Boolean).join(', ')}</p>}
            <div className="tokens">
              {heroes.filter((h) => heroZone(h.id) === z.id).map((h) => tokenButton({ kind: 'hero', id: h.id }, h.name))}
              {enemies.filter((e) => e.zone === z.id).map((e) => tokenButton({ kind: 'enemy', id: e.id }, e.name, e.kind === 'mooks' ? ` ×${e.count}` : ''))}
            </div>
            <details>
              <summary className="small">Edit zone</summary>
              <div className="stack small">
                <input aria-label="Zone name" defaultValue={z.name} key={z.name}
                  onBlur={(e) => { if (e.target.value.trim() && e.target.value !== z.name) patchZone(z.id, { name: e.target.value.trim() }) }} />
                <div className="chips">
                  {TAGS.tags.map((t) => {
                    const on = z.tags.includes(t.id)
                    return (
                      <button key={t.id} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} title={t.text}
                        onClick={() => patchZone(z.id, { tags: on ? z.tags.filter((x) => x !== t.id) : [...z.tags, t.id] })}>{t.name}</button>
                    )
                  })}
                </div>
                {z.tags.length > TAGS.max_tags_per_zone && <p className="warn">⚠ A zone usually has 0 to {TAGS.max_tags_per_zone} tags.</p>}
                {z.tags.map((t) => <p key={t} className="muted"><strong>{TAGS.tags.find((x) => x.id === t)?.name}.</strong> {TAGS.tags.find((x) => x.id === t)?.text}</p>)}
                {zones.length > 1 && <p><strong>Connects to</strong></p>}
                <div className="chips">
                  {zones.filter((o) => o.id !== z.id).map((o) => {
                    const on = z.links.includes(o.id)
                    return <button key={o.id} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => link(z, o, !on)}>{o.name}</button>
                  })}
                </div>
                <button className="mini secondary" onClick={() => removeZone(z)}>Remove zone</button>
              </div>
            </details>
          </div>
        ))}
      </div>
      {zones.length > 6 && <p className="warn small">⚠ A fight map has 3 to 6 zones.</p>}
      <div className="button-row">
        <input aria-label="New zone name" placeholder="Zone name (Loading Dock)" value={newZone} onChange={(e) => setNewZone(e.target.value)} />
        <button className="secondary" disabled={!newZone.trim()} onClick={() => run(async () => {
          await saveZones([...zones, { id: newId(), name: newZone.trim(), tags: [], links: [] }])
          setNewZone('')
        })}>Add zone</button>
      </div>
      {offMap.length > 0 && (
        <div className="stack">
          <p className="small muted">Not on the map. Tap a token, then a zone.</p>
          <div className="tokens">{offMap.map((o) => tokenButton(o.t, o.name, o.extra))}</div>
        </div>
      )}
      {selected && zones.length > 0 && <button className="mini secondary" onClick={() => move(null)}>Take it off the map</button>}
    </div>
  )
}

// ---------------------------------------------------------------- enemies

function EnemyPanel({ campaignId, enemies, scene, run }: { campaignId: string; enemies: Enemy[]; scene: Scene; run: Run }) {
  const [pick, setPick] = useState('')
  const [custom, setCustom] = useState(false)
  const [c, setC] = useState({ name: '', kind: 'lieutenant' as EnemyKind, force: 0, flow: 0, focus: 0, presence: 0, toughness: 0, harm_max: 5, attack: 2, guard: 13, count: 3 })
  const entries = libraryEntries()
  const picked = entries.find((e) => e.id === (pick || entries[0].id))
  const zoneName = (id: string | null) => scene.zones.find((z) => z.id === id)?.name

  const add = () => run(async () => {
    if (custom) {
      await addEnemy(campaignId, customEnemy({
        name: c.name, kind: c.kind, stats: { force: c.force, flow: c.flow, focus: c.focus, presence: c.presence },
        attack: c.attack, guard: c.guard, count: c.count, toughness: c.toughness, harm_max: c.harm_max,
      }))
      setC({ ...c, name: '' })
    } else {
      if (picked) await addEnemy(campaignId, enemyFromLibrary(picked))
    }
  })

  const num = (k: keyof typeof c, label: string, width = '4.5rem') => (
    <label className="small">{label}{' '}
      <input type="number" value={c[k] as number} style={{ width }} onChange={(e) => setC({ ...c, [k]: Number(e.target.value) || 0 })} />
    </label>
  )

  return (
    <div className="stack">
      {enemies.length === 0 && <p className="muted small">No enemies. Players see nothing of them until you add some and place them.</p>}
      {enemies.map((e) => {
        const def = e.defenses
        const state = enemyState(e)
        return (
          <div key={e.id} className="item enemy-card">
            <p><strong>{e.name}</strong> <span className="tag">{e.kind}</span> <span className="tag">players see: {state}</span></p>
            <p className="small muted">
              {e.kind === 'mooks'
                ? `Attack ${e.stats.attack >= 0 ? '+' : ''}${e.stats.attack} · Guard ${def.guard} · Wits ${def.wits} · Poise ${def.poise}`
                : `Guard ${def.guard} · Wits ${def.wits} · Poise ${def.poise} · Toughness ${e.toughness}`}
              {' · '}{zoneName(e.zone) ?? 'not on the map'}
            </p>
            {e.line && <p className="small">{e.line}</p>}
            {e.kind === 'mooks' ? (
              <div className="button-row small">
                <span>Standing {e.count}/{e.count_max}</span>
                <button className="mini secondary" onClick={() => run(() => setEnemyField(campaignId, e.id, 'count', Math.max(0, e.count - 1)))}>−1</button>
                <button className="mini secondary" onClick={() => run(() => setEnemyField(campaignId, e.id, 'count', Math.min(e.count_max, e.count + 1)))}>+1</button>
                <label className="small">Group of{' '}
                  <input type="number" min={1} defaultValue={e.count_max} style={{ width: '4rem' }}
                    onBlur={(ev) => { const v = Math.max(1, Number(ev.target.value) || 1); if (v !== e.count_max) run(async () => { await setEnemyField(campaignId, e.id, 'count_max', v); if (e.count > v) await setEnemyField(campaignId, e.id, 'count', v) }) }} />
                </label>
              </div>
            ) : (
              <>
                <Track label="Harm" value={e.harm} max={e.harm_max} onChange={(v) => run(() => setEnemyField(campaignId, e.id, 'harm', v))} />
                <Track label="Stress" value={e.stress} max={villainStress(e.kind).max} onChange={(v) => run(() => setEnemyField(campaignId, e.id, 'stress', v))} />
                <Track label="Drive" value={e.drive} max={CORE.drive.max} onChange={(v) => run(() => setEnemyField(campaignId, e.id, 'drive', v))} />
                {e.stress >= villainStress(e.kind).breaking
                  ? <p className="small warn">Breaking: their Breaking line takes over for the rest of the scene, and every attack against them has Edge. If they flee, the heroes get one round to stop them.</p>
                  : e.stress >= villainStress(e.kind).fraying && <p className="small warn">Fraying: use their Trait's Fraying line.</p>}
              </>
            )}
            <div className="button-row">
              <input aria-label={`${e.name} note`} placeholder="One-line note" defaultValue={e.line} key={e.line} style={{ minHeight: 36 }}
                onBlur={(ev) => { if (ev.target.value !== e.line) run(() => setEnemyField(campaignId, e.id, 'line', ev.target.value)) }} />
              <button className="mini secondary" onClick={() => run(() => removeEnemy(campaignId, e.id))}>Remove</button>
            </div>
          </div>
        )
      })}

      <div className="item stack">
        <div className="button-row">
          {!custom && (
            <select aria-label="Library entry" value={pick || entries[0].id} onChange={(e) => setPick(e.target.value)}>
              {entries.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.kind})</option>)}
            </select>
          )}
          <label className="small check"><input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> Make one</label>
        </div>
        {custom && (
          <div className="button-row">
            <input aria-label="Enemy name" placeholder="Name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
            <select aria-label="Kind" value={c.kind} onChange={(e) => {
              const kind = e.target.value as EnemyKind
              setC({ ...c, kind, harm_max: kind === 'lieutenant' ? CORE.harm.lieutenant_boxes : CORE.harm.villain_boxes })
            }}>
              <option value="mooks">Mook group</option><option value="lieutenant">Lieutenant</option><option value="villain">Villain</option>
            </select>
            {c.kind === 'mooks'
              ? <>{num('attack', 'Attack')}{num('guard', 'Guard')}{num('count', 'Count')}</>
              : <>{num('force', 'Force')}{num('flow', 'Flow')}{num('focus', 'Focus')}{num('presence', 'Presence')}{num('toughness', 'Toughness')}{num('harm_max', 'Harm boxes')}</>}
          </div>
        )}
        {!custom && picked && <p className="muted small">{'text' in picked ? picked.text : picked.line}</p>}
        <div><button onClick={add}>Add to the fight</button></div>
        <p className="muted small">Any number of named enemies work in the simulator too. A lieutenant takes one turn a round; a villain takes the usual turns.</p>
      </div>
    </div>
  )
}
