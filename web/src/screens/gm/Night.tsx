import { useState } from 'react'
import { useCharacters, useLiveRows } from '../../data/hooks'
import { setField } from '../../data/writes'
import { heroesOf, startNight, tickClockAndStress, useGmSecrets } from '../../data/gm'
import type { Character, Clock, Clue } from '../../data/types'
import { Track } from '../../components/Track'
import { useRunner } from '../../components/Toast'
import {
  CORE, MISSED_CRACK_TICKS, PHASE_NAMES, confrontationText, crackDefense, crackResultText, crackWarnings,
  impactBand, minCluesToCrack, nextPhase, phases, priceOf, resolveRoll, rollDice, theoryCount, upgrade, type Phase,
} from '../../engine'
import { GmShell, type GmContext } from './GmShell'

export function Night({ campaignId }: { campaignId: string }) {
  return <GmShell campaignId={campaignId} tab="night">{(ctx) => <NightBody {...ctx} />}</GmShell>
}

function NightBody({ campaign }: GmContext) {
  const cid = campaign.id
  const { rows: characters } = useCharacters(cid)
  const { rows: clocks } = useLiveRows<Clock>('clocks', cid, '*', { column: 'sort' })
  const { rows: clues } = useLiveRows<Clue>('clues', cid, '*', { column: 'night' })
  const { secrets, save } = useGmSecrets(cid)
  const { run, report, toast } = useRunner()
  const heroes = heroesOf(characters)
  const scheme = clocks.find((c) => c.kind === 'scheme')
  const heat = clocks.find((c) => c.kind === 'heat')
  const [confirmStart, setConfirmStart] = useState(false)

  const setPhase = (p: Phase) => run(() => setField('campaigns', cid, 'phase', p))

  /** Tick Scheme: who takes the Stress. */
  const tick = (ticks: number, who: Character[] | 'everyone') => run(async () => {
    if (!scheme) throw new Error('This campaign has no Scheme clock. Add one on the Table screen.')
    const stressFor = who === 'everyone' ? heroes : who
    const t = await tickClockAndStress(scheme, ticks, stressFor)
    const whoText = stressFor.length === 0 ? 'nobody takes Stress' : who === 'everyone' ? 'every hero takes 1 Stress per tick' : `${stressFor[0].name} takes ${t.ticked} Stress`
    report(`Scheme ${scheme.filled} → ${t.filled}; ${t.ticked ? whoText : 'already full'}.`, t.events)
  })

  return (
    <>
      <section className="card stack">
        <h2>Night {campaign.night}: {PHASE_NAMES[campaign.phase as Phase]}</h2>
        <div className="chips" role="group" aria-label="Phase">
          {phases().map((p) => (
            <button key={p} className={`chip ${campaign.phase === p ? 'on' : ''}`} aria-pressed={campaign.phase === p} onClick={() => setPhase(p)}>
              {PHASE_NAMES[p]}
            </button>
          ))}
        </div>
        <div className="button-row">
          {nextPhase(campaign.phase as Phase) && (
            <button onClick={() => setPhase(nextPhase(campaign.phase as Phase)!)}>Next: {PHASE_NAMES[nextPhase(campaign.phase as Phase)!]}</button>
          )}
          {confirmStart ? (
            <>
              <button onClick={() => run(async () => {
                const raised = await startNight(cid, campaign.night, heroes)
                setConfirmStart(false)
                report(`Night ${campaign.night + 1} begins.`, raised.length ? [`Drive raised: ${raised.join(', ')}.`] : [])
              })}>Start Night {campaign.night + 1}</button>
              <button className="secondary" onClick={() => setConfirmStart(false)}>Not yet</button>
            </>
          ) : (
            <button className="secondary" onClick={() => setConfirmStart(true)}>Start Night {campaign.night + 1}…</button>
          )}
        </div>
        <p className="muted small">Start Night moves to Patrol and raises any hero below {CORE.drive.start_night} Drive to {CORE.drive.start_night} (4 with Already Broken).</p>
      </section>

      <div className="gm-grid">
        <section className="card stack">
          <h2>Scheme</h2>
          {scheme ? <Track label="Scheme" value={scheme.filled} max={scheme.size} onChange={(v) => run(() => setField('clocks', scheme.id, 'filled', v))} />
            : <p className="warn small">No Scheme clock in this campaign.</p>}
          {heat && <Track label="Heat" value={heat.filled} max={heat.size} onChange={(v) => run(() => setField('clocks', heat.id, 'filled', v))} />}
          {secrets?.case.scheme_steps && scheme && scheme.filled > 0 && (
            <p className="small"><strong>Scheme step {scheme.filled}:</strong> {secrets.case.scheme_steps[scheme.filled - 1] ?? '—'}</p>
          )}
          <TickScheme heroes={heroes} onTick={tick} />
          <p className="muted small">If a hero's roll made it tick, only that hero takes 1 Stress. At Dawn or on a missed Crack the Case, every hero takes 1.</p>
        </section>

        <section className="card stack">
          <h2>Crack the Case</h2>
          <CrackHelper campaignNight={campaign.night} clues={clues} complexityDefault={secrets?.case.complexity ?? 6}
            onRecord={(attempt) => run(async () => {
              if (!secrets) throw new Error('Case file not loaded.')
              await save({ case: { ...secrets.case, crack_log: [...(secrets.case.crack_log ?? []), attempt] } })
              report(`Recorded: ${impactBand(attempt.impact).label}. ${crackResultText(attempt.impact)}`)
            })}
            onMissTicks={() => tick(MISSED_CRACK_TICKS, 'everyone')} />
          {(secrets?.case.crack_log ?? []).length > 0 && (
            <details>
              <summary className="small">Earlier attempts ({secrets!.case.crack_log!.length})</summary>
              <ul className="plain small">
                {secrets!.case.crack_log!.map((a, i) => (
                  <li key={i}>Night {a.night}: {a.clues} clues, dice {a.dice.join(', ')} → {a.total} vs {a.defense}: {impactBand(a.impact).label}{a.upgraded ? ' (upgraded)' : ''}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>

      <section className="card stack">
        <h2>Dawn</h2>
        <p className="small muted">Each hero picks two on their own sheet. The Scheme clock ticks at every Dawn.</p>
        <table className="data">
          <thead><tr><th>Hero</th><th>Picks (Night {campaign.night})</th><th>For the GM</th></tr></thead>
          <tbody>
            {heroes.map((h) => {
              const dawn = h.fight_state.dawn as { night: number; picks: string[]; tasks?: string[] } | undefined
              const now = dawn && dawn.night === campaign.night
              return (
                <tr key={h.id}>
                  <td>{h.name}</td>
                  <td>{now ? dawn!.picks.map((p) => CORE.dawn.options.find((o) => o.id === p)?.name ?? p).join(', ') : <span className="muted">not yet</span>}</td>
                  <td className="small">{now && dawn!.tasks?.length ? dawn!.tasks.join(' ') : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="button-row">
          <button className="secondary" onClick={() => tick(1, 'everyone')}>Dawn: tick Scheme (everyone takes 1 Stress)</button>
          {heat && <button className="secondary" onClick={() => run(() => setField('clocks', heat.id, 'filled', Math.max(0, heat.filled - 1)))}>Lay Low: clear 1 Heat</button>}
        </div>
      </section>
      {toast}
    </>
  )
}

function TickScheme({ heroes, onTick }: { heroes: Character[]; onTick: (ticks: number, who: Character[] | 'everyone') => void }) {
  const [who, setWho] = useState('')
  return (
    <div className="button-row">
      <select aria-label="Who takes the Stress" value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">Whose roll caused it?</option>
        {heroes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        <option value="everyone">Everyone (Dawn or a missed Crack)</option>
        <option value="nobody">Nobody takes Stress</option>
      </select>
      <button disabled={!who} onClick={() => onTick(1, who === 'everyone' ? 'everyone' : who === 'nobody' ? [] : heroes.filter((h) => h.id === who))}>
        Tick Scheme
      </button>
    </div>
  )
}

type Attempt = NonNullable<NonNullable<import('../../data/caseFile').CaseFile['crack_log']>>[number]

function CrackHelper({ campaignNight, clues, complexityDefault, onRecord, onMissTicks }: {
  campaignNight: number
  clues: Clue[]
  complexityDefault: number
  onRecord: (a: Attempt) => void
  onMissTicks: () => void
}) {
  const caseClues = clues.filter((c) => !c.is_arc)
  const [chosen, setChosen] = useState<string[]>([])
  const [caseSense, setCaseSense] = useState(false)
  const [complexity, setComplexity] = useState(complexityDefault)
  const [dice, setDice] = useState<[string, string]>(['', ''])
  const [upgraded, setUpgraded] = useState(false)

  const theory = caseClues.filter((c) => chosen.includes(c.id)).map((c) => ({ id: c.id, personal: Boolean(c.personal_for) }))
  const count = theoryCount(theory, caseSense)
  const defense = crackDefense(complexity)
  const warn = crackWarnings(count, complexity)
  const nums = dice.map(Number)
  const ready = nums.every((d) => Number.isInteger(d) && d >= 1 && d <= 10)
  const roll = ready ? resolveRoll({ dice: nums, bonus: count, defense }) : null
  const impact = roll ? (upgraded ? upgrade(roll.impact) : roll.impact) : null

  return (
    <div className="stack">
      <label className="small">Complexity{' '}
        <select value={complexity} onChange={(e) => setComplexity(Number(e.target.value))}>
          {CORE.case.complexity.map((c) => <option key={c.value} value={c.value}>{c.value}: {c.text}</option>)}
        </select>
      </label>
      <p className="small">Clues in the theory (red herrings don't count). Personal clues count 2.</p>
      {caseClues.length === 0 ? <p className="muted small">No case clues found yet.</p> : (
        <ul className="plain small">
          {caseClues.map((c) => (
            <li key={c.id}><label className="check">
              <input type="checkbox" checked={chosen.includes(c.id)} onChange={(e) => setChosen((x) => e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id))} />
              {c.text}{c.personal_for && <span className="tag">personal ×2</span>}
            </label></li>
          ))}
        </ul>
      )}
      <label className="small check"><input type="checkbox" checked={caseSense} onChange={(e) => setCaseSense(e.target.checked)} /> Detective's Case Sense (one clue counts as two, once per case)</label>
      <p><strong>Roll 2d10 + {count} against {defense}</strong> <span className="muted small">(10 + Complexity {complexity}; needs {minCluesToCrack(complexity)}+ clues)</span></p>
      {warn.map((w, i) => <p key={i} className="warn small">⚠ {w}</p>)}
      <div className="button-row">
        <input aria-label="First die" inputMode="numeric" value={dice[0]} onChange={(e) => setDice([e.target.value, dice[1]])} style={{ width: '4rem' }} />
        <input aria-label="Second die" inputMode="numeric" value={dice[1]} onChange={(e) => setDice([dice[0], e.target.value])} style={{ width: '4rem' }} />
        <button className="secondary" onClick={() => { const d = rollDice(0); setDice([String(d[0]), String(d[1])]) }}>Roll for me</button>
      </div>
      {roll && impact !== null && (
        <div className="item stack small">
          <p><strong>{roll.total} vs {defense}: {impactBand(impact).label}</strong> (margin {roll.margin}). {crackResultText(impact)}</p>
          <p className="muted">Confrontation: {confrontationText(impact)}</p>
          {roll.impact > 0 && roll.impact < 3 && (
            <label className="check"><input type="checkbox" checked={upgraded} onChange={(e) => setUpgraded(e.target.checked)} /> A hero spent {priceOf('upgrade')} Drive to upgrade it</label>
          )}
          <div className="button-row">
            <button onClick={() => onRecord({ at: new Date().toISOString(), night: campaignNight, clues: count, dice: nums, total: roll.total, defense, impact, upgraded: upgraded || undefined })}>Record result</button>
            {impact === 0 && <button className="secondary" onClick={onMissTicks}>Tick Scheme twice (everyone takes Stress)</button>}
          </div>
        </div>
      )}
    </div>
  )
}
