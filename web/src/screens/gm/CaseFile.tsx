import { useEffect, useRef, useState } from 'react'
import { useCharacters, useLiveRows } from '../../data/hooks'
import { bump } from '../../data/writes'
import { deleteRow, heroesOf, revealClue, useGmSecrets } from '../../data/gm'
import { blankArc, blankCase, checkCase, type ArcSheet, type CaseClue, type CaseFile as CaseData } from '../../data/caseFile'
import type { Clock } from '../../data/types'
import { supabase } from '../../data/supabase'
import { Track } from '../../components/Track'
import { useRunner } from '../../components/Toast'
import { CORE, caseComplexity, crackDefense, prepClues } from '../../engine'
import { setField } from '../../data/writes'
import { addDemoClocks, demoArc, demoCase, demoNotes } from '../../data/demoSeed'
import { setUpScene } from '../../data/fight'
import type { CaseScene } from '../../data/caseFile'
import { GmShell, type GmContext } from './GmShell'

export function CaseFile({ campaignId }: { campaignId: string }) {
  return <GmShell campaignId={campaignId} tab="case">{(ctx) => <CaseBody {...ctx} />}</GmShell>
}

function CaseBody({ campaign }: GmContext) {
  const cid = campaign.id
  const { secrets, save, error } = useGmSecrets(cid)
  const { rows: characters } = useCharacters(cid)
  const { rows: clocks } = useLiveRows<Clock>('clocks', cid, '*', { column: 'sort' })
  const { run, report, toast } = useRunner()
  const [editing, setEditing] = useState<'case' | 'arc' | null>(null)
  const [homePrompt, setHomePrompt] = useState<{ heroId: string; name: string } | null>(null)
  const heroes = heroesOf(characters)

  if (error) return <p className="error">{error}</p>
  if (!secrets) return <p className="muted">Loading the case file…</p>

  const c = secrets.case ?? {}
  const arc = secrets.arc ?? {}
  const empty = Object.keys(c).length === 0
  const heroByName = (n?: string) => (n ? heroes.find((h) => h.name.trim().toLowerCase() === n.trim().toLowerCase()) : undefined)
  const endgame = clocks.find((k) => k.kind === 'endgame')

  const setClue = (id: string, patch: Partial<CaseClue>) =>
    save({ case: { ...c, clues: (c.clues ?? []).map((k) => (k.id === id ? { ...k, ...patch } : k)) } })

  const reveal = (k: CaseClue, foundBy: string | null) => run(async () => {
    const personal = heroByName(k.personal_for)
    if (k.personal_for && !personal) report(`No hero named "${k.personal_for}"; revealed as an ordinary clue.`)
    const rowId = await revealClue(cid, k, campaign.night, personal?.id ?? null, foundBy)
    await setClue(k.id, { revealed: rowId })
    if (personal) setHomePrompt({ heroId: personal.id, name: personal.name })
    else report('Revealed. Players can see it now.')
  })

  const hide = (k: CaseClue) => run(async () => {
    if (k.revealed) await deleteRow('clues', k.revealed).catch(() => undefined)
    await setClue(k.id, { revealed: null })
    report('Hidden again. Players no longer see it.')
  })

  return (
    <>
      <p className="small muted">Hidden: only this GM device reads the case file. Players see a clue only after you press Reveal.</p>
      {homePrompt && (
        <div className="card stack notice">
          <p>That was a personal clue for <strong>{homePrompt.name}</strong>. Using it ticks their Home clock.</p>
          <div className="button-row">
            <button onClick={() => run(async () => { await bump(homePrompt.heroId, 'home_clock', 1); report(`${homePrompt.name}'s Home +1.`); setHomePrompt(null) })}>Tick {homePrompt.name}'s Home</button>
            <button className="secondary" onClick={() => setHomePrompt(null)}>Not now</button>
          </div>
        </div>
      )}

      {editing ? (
        <JsonEditor
          title={editing === 'case' ? 'Case file JSON' : 'Arc sheet JSON'}
          initial={editing === 'case' ? (empty ? blankCase() : c) : (Object.keys(arc).length ? arc : blankArc())}
          check={editing === 'case' ? checkCase : () => ({ ok: true, warnings: [] })}
          onCancel={() => setEditing(null)}
          onSave={(v) => run(async () => {
            await save(editing === 'case' ? { case: v as CaseData } : { arc: v as ArcSheet })
            setEditing(null)
            report('Saved.')
          })}
        />
      ) : empty ? (
        <section className="card stack">
          <h2>No case loaded</h2>
          <p className="small">Paste a case file as JSON (see <code>supabase/seed/CASE_FORMAT.md</code>), or start from a blank template.</p>
          <div className="button-row">
            <button onClick={() => run(async () => {
              await save({
                case: demoCase(),
                ...(Object.keys(arc).length ? {} : { arc: demoArc() }),
                ...(secrets.notes?.trim() ? {} : { notes: demoNotes() }),
              })
              await addDemoClocks(cid, clocks)
              report('Loaded The Butcher of Fifth Street. Set up its opening scene under Scenes.')
            })}>Load the Butcher case</button>
            <button className="secondary" onClick={() => setEditing('case')}>Paste or write a case</button>
          </div>
        </section>
      ) : (
        <>
          <section className="card stack">
            <h2>{c.title || 'Untitled case'}</h2>
            <p className="small">
              {c.mode === 'floating' ? 'Floating (the theory decides)' : 'Fixed Culprit'} · Complexity {c.complexity ?? '?'}
              {c.complexity != null && <> · Crack the Case against {crackDefense(c.complexity)}</>}
            </p>
            {heroes.length > 0 && (() => {
              const normal = caseComplexity('normal', heroes.length)
              const finale = caseComplexity('finale', heroes.length)
              const fits = c.complexity == null || [normal, finale, caseComplexity('one_night', heroes.length)].includes(c.complexity)
              return (
                <p className={fits ? 'muted small' : 'warn small'}>
                  {fits ? '' : '⚠ '}With {heroes.length} {heroes.length === 1 ? 'hero' : 'heroes'}, a normal case is Complexity {normal} and a finale is {finale}
                  {c.complexity != null && <> (prep about {prepClues(c.complexity)} clues; this case has {(c.clues ?? []).length})</>}.
                  {!fits && ' Edit the case to change it.'}
                </p>
              )
            })()}
            {c.culprit && <p><strong>Culprit:</strong> {c.culprit}</p>}
            {c.facets && (
              <ul className="plain small">
                <li><strong>Who's behind it?</strong> {c.facets.who || '—'}</li>
                <li><strong>What do they want?</strong> {c.facets.what || '—'}</li>
                <li><strong>Where will they strike?</strong> {c.facets.where || '—'}</li>
              </ul>
            )}
            <div className="button-row"><button className="secondary mini" onClick={() => setEditing('case')}>Edit as JSON</button></div>
          </section>

          <div className="gm-grid">
            <section className="card stack">
              <h2>Clues</h2>
              {(c.clues ?? []).length === 0 && <p className="muted small">No clues in the case file.</p>}
              {(c.clues ?? []).map((k) => <ClueRow key={k.id} clue={k} heroes={heroes} onReveal={reveal} onHide={hide} />)}
            </section>

            <section className="card stack">
              <h2>Leads</h2>
              {(c.leads ?? []).length === 0 && <p className="muted small">No leads.</p>}
              <ul className="plain small">
                {(c.leads ?? []).map((l, i) => (
                  <li key={i}><strong>{l.name}</strong> · rating {l.rating >= 0 ? `+${l.rating}` : l.rating}, defense {CORE.defense_base + l.rating}
                    {l.approach && <> · {l.approach}</>}{l.text && <span className="muted"> · {l.text}</span>}</li>
                ))}
              </ul>
              <h3>Cast</h3>
              <ul className="plain small">
                {(c.cast ?? []).map((p, i) => (
                  <li key={i}><strong>{p.name}</strong>{p.who && <> · {p.who}</>}{p.motive && <> · wants: {p.motive}</>}{p.hides && <> · hides: {p.hides}</>}</li>
                ))}
              </ul>
              <h3>Scheme steps</h3>
              <ol className="small">{(c.scheme_steps ?? []).map((s, i) => <li key={i}>{s}</li>)}</ol>
              {c.opening && <><h3>Opening</h3><p className="small">{c.opening}</p></>}
              {c.hostage && <><h3>Hostage</h3><p className="small">{c.hostage}</p></>}
              {c.confrontation && <><h3>Confrontation</h3><p className="small">{c.confrontation}</p></>}
            </section>
          </div>
        </>
      )}

      {!editing && !empty && (c.scenes ?? []).length > 0 && (
        <section className="card stack">
          <h2>Scenes</h2>
          {c.scenes!.map((sc) => <SceneRow key={sc.id} scene={sc} onSetUp={() => run(async () => {
            await setUpScene(cid, sc)
            report(`“${sc.title}” is set up on the Fight screen. Players now see its title, text and zones.`)
          })} />)}
        </section>
      )}

      {!editing && (
        <section className="card stack">
          <h2>Arc sheet</h2>
          {Object.keys(arc).length === 0 ? <p className="muted small">No arc yet. The Mastermind can start blank.</p> : (
            <ul className="plain small">
              <li><strong>Mastermind:</strong> {arc.mastermind || 'someone (not decided)'}</li>
              <li><strong>Endgame:</strong> {arc.endgame || '—'}</li>
              <li><strong>Calling card:</strong> {arc.calling_card || '—'}</li>
              {(arc.tools ?? []).map((t, i) => <li key={i}><strong>Pawn:</strong> {t.name}{t.knows && <> · knows {t.knows}</>}</li>)}
              {(arc.arc_clues ?? []).map((t, i) => <li key={i}><strong>Arc clue:</strong> {t}</li>)}
            </ul>
          )}
          {endgame
            ? <Track label="Endgame (hidden)" value={endgame.filled} max={endgame.size} onChange={(v) => run(() => setField('clocks', endgame.id, 'filled', v))} />
            : <button className="secondary mini" onClick={() => run(async () => {
                const rule = CORE.clocks.find((k) => k.kind === 'endgame')!
                const { error } = await supabase.from('clocks').insert({ campaign_id: cid, name: 'Endgame', kind: 'endgame', size: rule.size, visible_to_players: false, sort: 90 })
                if (error) throw error
              })}>Add the Endgame clock</button>}
          <p className="muted small">{CORE.clocks.find((k) => k.kind === 'endgame')!.ticks}</p>
          <div className="button-row"><button className="secondary mini" onClick={() => setEditing('arc')}>Edit arc as JSON</button></div>
        </section>
      )}

      {!editing && (
        <section className="card stack">
          <h2>GM notes</h2>
          <NotesBox value={secrets.notes} onSave={(v) => run(() => save({ notes: v }))} />
        </section>
      )}
      {toast}
    </>
  )
}

function SceneRow({ scene, onSetUp }: { scene: CaseScene; onSetUp: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="item stack">
      <p><strong>{scene.title}</strong></p>
      <p className="small">{scene.text}</p>
      <p className="small muted">
        Zones: {scene.zones.map((z) => z.name).join(', ')}
        {scene.obstacles?.length ? <> · Obstacles: {scene.obstacles.map((o) => `${o.name} (${o.rating >= 0 ? '+' : ''}${o.rating}, ${CORE.defense_base + o.rating})`).join(', ')}</> : null}
        {scene.extras?.length ? <> · Also here: {scene.extras.map((x) => x.name).join(', ')}</> : null}
        {scene.enemies?.length ? <> · Enemies: {scene.enemies.map((e) => e.kind === 'mooks' ? `${e.name} (${e.count})` : e.name).join(', ')}</> : null}
      </p>
      <div className="button-row">
        {confirm ? (
          <>
            <span className="small warn">This replaces the Fight screen's scene, zones and enemies.</span>
            <button onClick={() => { setConfirm(false); onSetUp() }}>Set it up</button>
            <button className="secondary" onClick={() => setConfirm(false)}>Cancel</button>
          </>
        ) : <button className="secondary mini" onClick={() => setConfirm(true)}>Set up on the Fight screen</button>}
      </div>
    </div>
  )
}

function ClueRow({ clue, heroes, onReveal, onHide }: {
  clue: CaseClue
  heroes: { id: string; name: string }[]
  onReveal: (k: CaseClue, foundBy: string | null) => void
  onHide: (k: CaseClue) => void
}) {
  const [foundBy, setFoundBy] = useState('')
  return (
    <div className={`item ${clue.revealed ? '' : 'hidden-clue'}`}>
      <p className="small">
        {clue.text}{' '}
        {clue.personal_for && <span className="tag">personal: {clue.personal_for} ×2</span>}
        {clue.is_arc && <span className="tag">arc</span>}
        {clue.red_herring && <span className="tag">red herring</span>}
      </p>
      {(clue.lead || clue.points_to?.length || clue.note) && (
        <p className="muted small">{clue.lead && <>From {clue.lead}. </>}{clue.points_to?.length ? <>Points to {clue.points_to.join(', ')}. </> : null}{clue.note}</p>
      )}
      {clue.revealed ? (
        <p className="small"><span className="tag">revealed</span> <button className="link" onClick={() => onHide(clue)}>hide again</button></p>
      ) : (
        <div className="button-row">
          <select aria-label="Found by" value={foundBy} onChange={(e) => setFoundBy(e.target.value)}>
            <option value="">Found by…</option>
            {heroes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <button className="mini" onClick={() => onReveal(clue, foundBy || null)}>Reveal</button>
        </div>
      )}
    </div>
  )
}

function JsonEditor({ title, initial, check, onSave, onCancel }: {
  title: string
  initial: unknown
  check: (v: unknown) => { ok: boolean; warnings: string[] }
  onSave: (v: unknown) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2))
  let parsed: unknown = null
  let parseError: string | null = null
  try { parsed = JSON.parse(text) } catch (e) { parseError = (e as Error).message }
  const result = parseError ? null : check(parsed)
  return (
    <section className="card stack">
      <h2>{title}</h2>
      <textarea className="code-area" rows={24} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label={title} />
      {parseError && <p className="error small">Not valid JSON: {parseError}</p>}
      {result?.warnings.map((w, i) => <p key={i} className="warn small">⚠ {w}</p>)}
      <div className="button-row">
        <button disabled={!result?.ok} onClick={() => onSave(parsed)}>Save</button>
        <button className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  )
}

function NotesBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(value) }, [value])
  return (
    <textarea rows={6} value={text} aria-label="GM notes" onChange={(e) => setText(e.target.value)}
      onFocus={() => { focused.current = true }} onBlur={() => { focused.current = false; if (text !== value) onSave(text) }} />
  )
}
