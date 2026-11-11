import { useMemo, useState } from 'react'
import { CORE, dawn } from '../../../engine'
import { setFlag, updateColumns } from '../../../data/writes'
import type { Campaign, Character } from '../../../data/types'
import type { Report } from './Actions'

/** Dawn: pick two options, see exactly what changes, then apply. */
export function DawnPanel({ hero, campaign, report, run, onClose }: {
  hero: Character
  campaign: Campaign
  report: Report
  run: (fn: () => Promise<unknown>) => void
  onClose: () => void
}) {
  const [picks, setPicks] = useState<string[]>([])
  const need = CORE.dawn.picks

  const result = useMemo(
    () => dawn(hero, { harm: hero.harm, stress: hero.stress, drive: hero.drive, home_clock: hero.home_clock, dying: hero.dying }, picks),
    [hero, picks],
  )

  const toggle = (id: string) =>
    setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= need ? [...p.slice(1), id] : [...p, id]))

  const apply = () => run(async () => {
    await updateColumns(hero.id, result.patch)
    await setFlag(hero.id, 'dawn', { night: campaign.night, picks, tasks: result.gmTasks })
    report(`Dawn applied. ${result.notes.join(' ')}`, result.gmTasks)
    onClose()
  })

  return (
    <div className="item stack" role="group" aria-label="Dawn">
      <p><strong>Dawn: pick {need}.</strong> <span className="muted small">You can never do everything. That's the point.</span></p>
      <div className="chips">
        {CORE.dawn.options.map((o) => (
          <button key={o.id} className={`chip ${picks.includes(o.id) ? 'on' : ''}`} aria-pressed={picks.includes(o.id)} onClick={() => toggle(o.id)} title={o.text}>
            {o.name}
          </button>
        ))}
      </div>
      <ul className="plain small">
        {CORE.dawn.options.filter((o) => picks.includes(o.id)).map((o) => <li key={o.id}><strong>{o.name}.</strong> {o.text}</li>)}
      </ul>
      {picks.length === need && (
        <div className="small">
          <p><strong>This will:</strong></p>
          <ul className="plain">
            {result.notes.map((n, i) => <li key={i}>{n}</li>)}
            {result.gmTasks.map((n, i) => <li key={`g${i}`} className="muted">{n}</li>)}
          </ul>
        </div>
      )}
      <div className="button-row">
        <button disabled={picks.length !== need} onClick={apply}>Apply Dawn</button>
        <button className="secondary" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
