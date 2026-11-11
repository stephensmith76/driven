import { CORE, archetype, priceOf, secondWind } from '../../../engine'
import { bump, setFlag } from '../../../data/writes'
import type { Character } from '../../../data/types'

export type Report = (message: string, warnings?: string[]) => void

/** Archetype actions plus the Drive and Stress buttons: Signature, Second Wind, Strain, Edge. */
export function Actions({ hero, report, run }: {
  hero: Character
  report: Report
  run: (fn: () => Promise<unknown>) => void
}) {
  const arch = archetype(hero.archetype_id)
  const spend = (cost: number, what: string) => run(async () => {
    const warn = hero.drive < cost ? [`${what} costs ${cost} Drive; you have ${hero.drive}. Fix the tracker if the table says otherwise.`] : []
    await bump(hero.id, 'drive', -cost)
    report(`Spent ${cost} Drive: ${what}.`, warn)
  })

  const wind = () => run(async () => {
    const sw = secondWind(hero, Boolean(hero.fight_state.second_wind_used))
    await bump(hero.id, 'drive', -sw.cost)
    if (sw.harmDelta) await bump(hero.id, 'harm', sw.harmDelta)
    await setFlag(hero.id, 'second_wind_used', true)
    report('Second Wind: spent 3 Drive and cleared one Harm box.', sw.warnings)
  })

  const strain = () => run(async () => {
    await bump(hero.id, 'stress', 1)
    report('Strain: +1 Stress for an extra Quick Action.')
  })

  return (
    <div className="stack">
      {arch && (
        <>
          <p className="small"><strong>Drive trigger.</strong> {arch.drive_trigger} <span className="muted">Once per round.</span></p>
          {arch.feature && <p className="small"><strong>{arch.feature.name}.</strong> {arch.feature.text}</p>}
          {arch.quick_actions.map((q) => <p key={q.id} className="small"><strong>{q.name} (Quick).</strong> {q.text}</p>)}
          <p className="small"><strong>Signature: {arch.signature.name}.</strong> {arch.signature.text}</p>
        </>
      )}
      <div className="button-row">
        <button onClick={() => spend(priceOf('signature'), arch?.signature.name ?? 'Signature Move')}>
          Spend {priceOf('signature')} Drive: Signature
        </button>
        <button className="secondary" onClick={() => spend(priceOf('edge'), 'Edge')}>Edge ({priceOf('edge')} Drive)</button>
        <button className="secondary" onClick={wind}>
          Second Wind ({priceOf('second_wind')} Drive){hero.fight_state.second_wind_used ? ' · used' : ''}
        </button>
        <button className="secondary" onClick={strain}>Strain (1 Stress)</button>
      </div>
      <p className="muted small">{CORE.strain.text} Tap a tracker to undo any of these.</p>

      <details>
        <summary>Full and Quick Actions</summary>
        <div className="stack small">
          <p className="muted">{CORE.actions.free_move}</p>
          <ul className="plain">
            {CORE.actions.full.map((a) => <li key={a.id}><strong>{a.name} (Full).</strong> {a.text}</li>)}
            {CORE.actions.quick.map((a) => <li key={a.id}><strong>{a.name} (Quick).</strong> {a.text}</li>)}
          </ul>
          <p className="muted">{CORE.actions.breaking_away}</p>
        </div>
      </details>
    </div>
  )
}
