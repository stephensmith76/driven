import { useEffect, useId, useState } from 'react'
import { useCharacters, useLiveRows } from '../../data/hooks'
import { supabase } from '../../data/supabase'
import { deleteRow, heroesOf } from '../../data/gm'
import { setField } from '../../data/writes'
import { useRunner } from '../../components/Toast'
import {
  DEFAULT_RUNS, SIM_CAVEAT, SIM_LIMITS, blankVillain, difficulty, encounterConfig, gangGroups, libraryMooks, normalizeForm, villainTurns,
  libraryVillains, mooksFromEnemy, probablyDown, simHero, villainFromEnemy, CORE,
  type EncounterForm, type Enemy, type SimMooks, type SimResult, type SimVillain, type VillainRole,
} from '../../engine'
import { loadSim, runEncounter, type Progress } from '../../sim/client'
import checkConfig from '../../../../sim/tests/encounter_check.json'
import checkExpected from '../../../../sim/tests/encounter_check.expected.json'
import { GmShell, type GmContext } from './GmShell'

type Saved = { id: string; campaign_id: string; name: string; config: Parameters<typeof normalizeForm>[0]; last_result: LastResult | null; updated_at: string }
type LastResult = { result: SimResult; ms: number; at: string; names?: Record<string, string> }

const WEAPONS = ['unarmed', 'light', 'heavy', 'knife', 'pistol']
const pct = (n: number) => `${n.toFixed(1)}%`

export function EncounterLab({ campaignId }: { campaignId: string }) {
  return <GmShell campaignId={campaignId} tab="lab">{(ctx) => <LabBody {...ctx} />}</GmShell>
}

function emptyForm(): EncounterForm {
  return { party: [], mode: 'fresh', villains: [], mook_groups: [], dark: false, runs: DEFAULT_RUNS }
}

function LabBody({ campaign }: GmContext) {
  const cid = campaign.id
  const { rows: characters } = useCharacters(cid)
  const { rows: enemies } = useLiveRows<Enemy>('enemies', cid, '*', { column: 'name' })
  const { rows: saved, reload } = useLiveRows<Saved>('encounters', cid, '*', { column: 'updated_at', ascending: false })
  const { run, report, toast } = useRunner()
  const heroes = heroesOf(characters)

  const [form, setForm] = useState<EncounterForm>(emptyForm)
  const [touched, setTouched] = useState(false)
  const [current, setCurrent] = useState<Saved | null>(null)
  const [name, setName] = useState('')
  const [loadState, setLoadState] = useState<{ ready: boolean; stage: string; error?: string }>({ ready: false, stage: 'Starting…' })
  const [progress, setProgress] = useState<Progress | null>(null)
  const [last, setLast] = useState<LastResult | null>(null)
  const [check, setCheck] = useState<string[] | null>(null)

  // Load Python and the simulator as soon as the lab opens.
  useEffect(() => {
    loadSim((p) => setLoadState({ ready: false, stage: p.stage }))
      .then((ms) => setLoadState({ ready: true, stage: `Simulator ready (loaded in ${(ms / 1000).toFixed(1)} s).` }))
      .catch((e) => setLoadState({ ready: false, stage: '', error: String(e.message ?? e) }))
  }, [])

  // Party: every player character by default.
  useEffect(() => {
    if (!touched && heroes.length && form.party.length === 0) setForm((f) => ({ ...f, party: heroes.map((h) => h.id) }))
  }, [heroes.length, touched]) // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (patch: Partial<EncounterForm>) => { setTouched(true); setForm((f) => ({ ...f, ...patch })) }
  const party = heroes.filter((h) => form.party.includes(h.id))
  const hasVillain = form.villains.length > 0
  const suggested = gangGroups(party.length, hasVillain)
  const busy = progress != null

  const doRun = (f: EncounterForm, row: Saved | null) => run(async () => {
    const config = encounterConfig(f, characters)
    if (!config.heroes.length) throw new Error('Pick at least one hero.')
    if (!config.villains.length && !config.mook_groups.length) throw new Error('Add a villain or a mook group.')
    setProgress({ stage: 'Starting…' })
    try {
      const { result, ms } = await runEncounter(config, setProgress)
      const names = Object.fromEntries(config.heroes.map((h) => [h.key, h.name]))
      const lr = { result, ms, at: new Date().toISOString(), names }
      setLast(lr)
      if (row) { await setField('encounters', row.id, 'last_result', lr); reload() }
    } finally { setProgress(null) }
  })

  const save = () => run(async () => {
    const n = name.trim() || 'Encounter'
    if (current) {
      const { error } = await supabase.from('encounters').update({ name: n, config: form, last_result: last }).eq('id', current.id)
      if (error) throw error
      report(`Saved “${n}”.`)
    } else {
      const { data, error } = await supabase.from('encounters').insert({ campaign_id: cid, name: n, config: form, last_result: last }).select().single()
      if (error) throw error
      setCurrent(data as Saved)
      report(`Saved “${n}” as a new encounter.`)
    }
    reload()
  })

  const open = (s: Saved) => {
    setCurrent(s); setName(s.name); setTouched(true)
    setForm(normalizeForm(s.config, emptyForm()))
    setLast(s.last_result)
  }

  const fromFight = () => {
    const named = enemies.filter((e) => e.kind !== 'mooks').map(villainFromEnemy)
    const groups = enemies.filter((e) => e.kind === 'mooks').map((e) => mooksFromEnemy(e, form.mode === 'now'))
    edit({ villains: named, mook_groups: groups })
    report('Copied the Fight screen’s enemies.')
  }

  const runSelfCheck = () => run(async () => {
    setCheck(null)
    setProgress({ stage: 'Starting…' })
    try {
      const { result, ms } = await runEncounter(checkConfig as never, setProgress)
      const exp = checkExpected as SimResult
      const lines = [
        `Command line: ${pct(exp.win_pct)} wins, ${pct(exp.any_down_pct)} anyone Down. Browser: ${pct(result.win_pct)} wins, ${pct(result.any_down_pct)} anyone Down (${result.runs} fights in ${(ms / 1000).toFixed(1)} s).`,
      ]
      const diffs = [Math.abs(result.win_pct - exp.win_pct), Math.abs(result.any_down_pct - exp.any_down_pct)]
      lines.push(Math.max(...diffs) <= 2 ? 'PASS: within 2 points.' : 'FAIL: more than 2 points apart.')
      setCheck(lines)
    } finally { setProgress(null) }
  })

  const result = last?.result

  return (
    <>
      <div className="gm-grid">
        <section className="card stack">
          <h2>Party</h2>
          {heroes.length === 0 && <p className="muted small">No player characters yet.</p>}
          {heroes.map((h) => {
            const ns = simHero(h).not_simulated
            return (
              <label key={h.id} className="check">
                <input type="checkbox" checked={form.party.includes(h.id)} onChange={(e) =>
                  edit({ party: e.target.checked ? [...form.party, h.id] : form.party.filter((x) => x !== h.id) })} />
                {' '}{h.name}
                <span className="muted small"> · Harm {h.harm} · Stress {h.stress} · Drive {h.drive}{ns.length ? ` · ${ns.length} not simulated` : ''}</span>
              </label>
            )
          })}
          <fieldset className="plain-fieldset button-row">
            <legend className="small muted">Start the fight</legend>
            <label className="check"><input type="radio" name="mode" checked={form.mode === 'fresh'} onChange={() => edit({ mode: 'fresh' })} /> Fresh</label>
            <label className="check"><input type="radio" name="mode" checked={form.mode === 'now'} onChange={() => edit({ mode: 'now' })} /> As they are now</label>
          </fieldset>
          <p className="muted small">Fresh: no Harm or Stress, {CORE.drive.start_night} Drive. As they are now: each hero's current Harm, Stress and Drive.</p>
        </section>

        <section className="card stack">
          <h2>Enemies</h2>
          <h3 className="small">Named enemies</h3>
          {form.villains.map((v, i) => (
            <VillainEditor key={i} villain={v} turns={turnsFor(v, party.length, form)}
              onChange={(nv) => edit({ villains: form.villains.map((x, j) => (j === i ? nv : x)) })}
              onRemove={() => edit({ villains: form.villains.filter((_, j) => j !== i) })} />
          ))}
          <AddVillain enemies={enemies} first={!hasVillain} onAdd={(v) => edit({ villains: [...form.villains, v] })} />
          <h3 className="small">Mook groups</h3>
          {form.mook_groups.map((g, i) => (
            <MookRow key={i} g={g} onChange={(ng) => edit({ mook_groups: form.mook_groups.map((x, j) => (j === i ? ng : x)) })}
              onRemove={() => edit({ mook_groups: form.mook_groups.filter((_, j) => j !== i) })} />
          ))}
          <div className="button-row">
            {libraryMooks().map((m) => (
              <button key={m.id} className="mini secondary" onClick={() => edit({ mook_groups: [...form.mook_groups, { ...m.sim, name: m.name }] })}>+ {m.name}</button>
            ))}
            <button className="mini secondary" onClick={() => edit({ mook_groups: [...form.mook_groups, { name: 'Mooks', count: CORE.villain_scaling.mook_group_size, attack: 2, guard: 13, gunner: false }] })}>+ Custom group</button>
          </div>
          <p className="small muted">
            Suggested for {party.length} hero{party.length === 1 ? '' : 'es'}{hasVillain ? ' with a named enemy' : ''}: {suggested} group{suggested === 1 ? '' : 's'} of {CORE.villain_scaling.mook_group_size}.
            {' '}{form.mook_groups.length !== suggested && suggested > 0 && (
              <button className="mini secondary" onClick={() => {
                const base = form.mook_groups[0] ?? { ...libraryMooks()[0].sim, name: libraryMooks()[0].name }
                edit({ mook_groups: Array.from({ length: suggested }, (_, i) => form.mook_groups[i] ?? { ...base }) })
              }}>Use {suggested}</button>
            )}
          </p>
          {enemies.length > 0 && <div><button className="mini secondary" onClick={fromFight}>Use the Fight screen’s enemies</button></div>}
        </section>

        <section className="card stack">
          <h2>Run</h2>
          <label className="check"><input type="checkbox" checked={form.dark} onChange={(e) => edit({ dark: e.target.checked })} /> The zone is Dark</label>
          <label className="small">Fights to run{' '}
            <input type="number" min={50} max={20000} step={100} value={form.runs} style={{ width: '6rem' }}
              onChange={(e) => edit({ runs: Math.max(1, Math.min(20000, Number(e.target.value) || DEFAULT_RUNS)) })} />
          </label>
          <div className="button-row">
            <button disabled={!loadState.ready || busy} onClick={() => doRun(form, current)}>Run</button>
          </div>
          {loadState.error
            ? <p className="error small">Couldn't load the simulator: {loadState.error}</p>
            : <p className="muted small" role="status">{busy ? progressText(progress) : loadState.stage}</p>}
          {busy && progress?.total ? <progress max={progress.total} value={progress.done ?? 0} style={{ width: '100%' }} /> : null}
          {!loadState.ready && !loadState.error && <progress style={{ width: '100%' }} />}
          <details className="small">
            <summary>Known limits</summary>
            <ul>{SIM_LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
          </details>
          <details className="small">
            <summary>Check the simulator</summary>
            <p className="muted">Runs Rook, Nightjar and the Ledger against the Butcher and one Saints group (2,000 fights, seed 7) and compares with the command line.</p>
            <button className="mini secondary" disabled={!loadState.ready || busy} onClick={runSelfCheck}>Run the check</button>
            {check?.map((l) => <p key={l} className={l.startsWith('FAIL') ? 'error' : ''}>{l}</p>)}
          </details>
        </section>

        <section className="card stack">
          <h2>Result</h2>
          {!result && <p className="muted small">Press Run.</p>}
          {result && <ResultView r={result} ms={last!.ms} at={last!.at} names={last!.names ?? {}} />}
        </section>

        <section className="card stack">
          <h2>Saved encounters</h2>
          <div className="button-row">
            <input aria-label="Encounter name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <button className="secondary" onClick={save}>{current ? 'Save' : 'Save new'}</button>
            {current && <button className="mini secondary" onClick={() => { setCurrent(null); setName('') }}>Save as new…</button>}
          </div>
          {current && <p className="small muted">Editing “{current.name}”.</p>}
          {saved.length === 0 && <p className="muted small">Nothing saved yet.</p>}
          {saved.map((s) => (
            <div key={s.id} className="item button-row">
              <span className="grow">
                <strong>{s.name}</strong>
                {s.last_result && <span className="small muted"> · {difficulty(s.last_result.result.win_pct)} ({pct(s.last_result.result.win_pct)})</span>}
              </span>
              <button className="mini secondary" onClick={() => open(s)}>Open</button>
              <button className="mini secondary" disabled={!loadState.ready || busy} onClick={() => { open(s); doRun(normalizeForm(s.config, emptyForm()), s) }}>Rerun</button>
              <button className="mini secondary" onClick={() => run(async () => {
                await deleteRow('encounters', s.id)
                if (current?.id === s.id) { setCurrent(null); setName('') }
                reload()
              })}>Delete</button>
            </div>
          ))}
        </section>
      </div>
      {toast}
    </>
  )
}

function progressText(p: Progress | null) {
  if (!p) return ''
  if (p.total) return `${p.stage} ${p.done ?? 0} of ${p.total}`
  return p.stage
}

function ResultView({ r, ms, at, names }: { r: SimResult; ms: number; at: string; names: Record<string, string> }) {
  return (
    <>
      <p className="sim-label"><strong>{difficulty(r.win_pct)}</strong></p>
      {probablyDown(r) && <p className="warn">Someone probably goes Down.</p>}
      <div className="stat-grid">
        <div className="stat"><span className="small muted">Win</span><strong>{pct(r.win_pct)}</strong></div>
        <div className="stat"><span className="small muted">Rounds</span><strong>{r.rounds.toFixed(1)}</strong></div>
        <div className="stat"><span className="small muted">Anyone Down</span><strong>{pct(r.any_down_pct)}</strong></div>
        <div className="stat"><span className="small muted">Anyone Dying</span><strong>{pct(r.dying_pct)}</strong></div>
      </div>
      <h3 className="small">Chance each hero goes Down</h3>
      {Object.entries(r.heroes).map(([k, h]) => (
        <div key={k} className="sim-bar-row">
          <span className="small">{names[k] ?? k}</span>
          <span className="sim-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, h.down_pct)}%` }} /></span>
          <span className="small">{pct(h.down_pct)}</span>
        </div>
      ))}
      <h3 className="small">Not simulated</h3>
      {r.not_simulated.length
        ? <ul className="small">{r.not_simulated.map((l) => <li key={l}>{l}</li>)}</ul>
        : <p className="small muted">Everything in these loadouts is simulated.</p>}
      <p className="small">{SIM_CAVEAT}</p>
      <p className="small muted">{r.runs.toLocaleString()} fights in {(ms / 1000).toFixed(1)} s · simulator {r.sim_version} · {new Date(at).toLocaleString()}</p>
    </>
  )
}

/** Turns a named enemy gets each round: villains the usual count, lieutenants one. */
function turnsFor(v: SimVillain, heroes: number, form: EncounterForm) {
  if (v.role === 'lieutenant') return 1
  return villainTurns(heroes, form.villains.length === 1 && form.mook_groups.length === 0)
}

function AddVillain({ enemies, first, onAdd }: { enemies: Enemy[]; first: boolean; onAdd: (v: SimVillain) => void }) {
  const lib = libraryVillains()
  const fight = enemies.filter((e) => e.kind !== 'mooks')
  const pick = (v: string) => {
    if (v === 'custom') return onAdd(blankVillain())
    if (v.startsWith('lib:')) return onAdd({ ...lib.find((x) => `lib:${x.id}` === v)!.sim })
    const e = fight.find((x) => `fight:${x.id}` === v)
    if (e) onAdd(villainFromEnemy(e))
  }
  return (
    <label className="small">{first ? 'Add a villain or lieutenant' : 'Add another'}{' '}
      <select value="" onChange={(e) => pick(e.target.value)}>
        <option value="">Pick one…</option>
        <optgroup label="Library">{lib.map((v) => <option key={v.id} value={`lib:${v.id}`}>{v.name}</option>)}</optgroup>
        {fight.length > 0 && <optgroup label="On the Fight screen">{fight.map((e) => <option key={e.id} value={`fight:${e.id}`}>{e.name}</option>)}</optgroup>}
        <option value="custom">Make one…</option>
      </select>
    </label>
  )
}

function VillainEditor({ villain, turns, onChange, onRemove }: { villain: SimVillain; turns: number; onChange: (v: SimVillain) => void; onRemove: () => void }) {
  const group = useId()
  const num = (k: keyof SimVillain, label: string) => (
    <label className="small">{label}{' '}
      <input type="number" value={villain[k] as number} style={{ width: '4rem' }}
        onChange={(e) => onChange({ ...villain, [k]: Number(e.target.value) || 0 })} />
    </label>
  )
  return (
    <div className="item stack">
      <div className="button-row">
        <input aria-label="Villain name" value={villain.name} onChange={(e) => onChange({ ...villain, name: e.target.value })} />
        <button className="mini secondary" onClick={onRemove}>Remove</button>
      </div>
      <fieldset className="plain-fieldset button-row">
        <legend className="small muted">Role</legend>
        {(['villain', 'lieutenant'] as VillainRole[]).map((r) => (
          <label key={r} className="check small">
            <input type="radio" name={group} checked={villain.role === r} onChange={() => onChange({ ...villain, role: r })} />
            {' '}{r === 'villain' ? 'Villain' : 'Lieutenant'}
          </label>
        ))}
        <span className="small muted">{turns} turn{turns === 1 ? '' : 's'} a round</span>
      </fieldset>
      <div className="button-row">
        {num('force', 'Force')}{num('flow', 'Flow')}{num('focus', 'Focus')}{num('presence', 'Presence')}
      </div>
      <div className="button-row">
        {num('harm_max', 'Harm boxes')}{num('toughness_v', 'Toughness')}{num('drive', 'Drive')}
        <label className="small">Weapon{' '}
          <select value={villain.weapon} onChange={(e) => onChange({ ...villain, weapon: e.target.value })}>
            {WEAPONS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
      </div>
      <p className="small muted">Guard {12 + villain.flow} · Wits {12 + villain.focus} · Poise {12 + villain.presence}</p>
    </div>
  )
}

function MookRow({ g, onChange, onRemove }: { g: SimMooks; onChange: (g: SimMooks) => void; onRemove: () => void }) {
  const num = (k: 'count' | 'attack' | 'guard', label: string) => (
    <label className="small">{label}{' '}
      <input type="number" value={g[k]} style={{ width: '3.5rem' }} min={k === 'count' ? 1 : undefined}
        onChange={(e) => onChange({ ...g, [k]: k === 'count' ? Math.max(1, Number(e.target.value) || 1) : Number(e.target.value) || 0 })} />
    </label>
  )
  return (
    <div className="item button-row">
      <input aria-label="Group name" value={g.name} onChange={(e) => onChange({ ...g, name: e.target.value })} style={{ width: '9rem' }} />
      {num('count', 'Count')}{num('attack', 'Attack')}{num('guard', 'Guard')}
      <label className="small check"><input type="checkbox" checked={g.gunner} onChange={(e) => onChange({ ...g, gunner: e.target.checked })} /> Gunner</label>
      <button className="mini secondary" onClick={onRemove}>Remove</button>
    </div>
  )
}
