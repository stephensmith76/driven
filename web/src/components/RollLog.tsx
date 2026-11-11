import { deleteRoll, useRolls } from '../data/rolls'
import { CORE, rollsCsv } from '../engine'
import type { Run } from './Roller'

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const sign = (n: number | null) => (n == null ? '' : n >= 0 ? `+${n}` : String(n))

/** The table's roll log: everyone sees it within a couple of seconds, newest first. The GM can delete a roll. */
export function RollLog({ campaignId, isGm, run, limit = 40 }: {
  campaignId: string
  isGm: boolean
  run: Run
  limit?: number
}) {
  const { rows, error } = useRolls(campaignId)

  const exportCsv = () => {
    const blob = new Blob([rollsCsv(rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `roll-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="stack">
      <div className="button-row">
        <span className="muted small">{rows.length} roll{rows.length === 1 ? '' : 's'}</span>
        <button className="mini secondary" disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
      </div>
      {error && <p className="error small">{error}</p>}
      {rows.length === 0 && <p className="muted small">No rolls yet.</p>}
      <ul className="plain roll-log">
        {rows.slice(0, limit).map((r) => (
          <li key={r.id} className="roll-entry small">
            <span className="muted">{time(r.at)}</span>{' '}
            <strong>{r.actor_name}</strong>: {r.label}
            {r.mode === 'manual' && <span className="tag">manual</span>}
            <br />
            <span className="dice-line">
              {r.dice.length > 0 ? r.dice.map((d, i) => <span key={i} className="die small">{d}</span>) : <span className="muted">(no dice)</span>}
            </span>{' '}
            <strong>{r.total}</strong> vs {r.defense} ({sign(r.margin)}){' '}
            <strong>{CORE.impact_bands.find((b) => b.impact === r.impact)?.label}</strong>
            {r.note && <span className="muted"> · {r.note}</span>}
            {isGm && <>{' '}<button className="link" onClick={() => run(() => deleteRoll(r.id))}>delete</button></>}
          </li>
        ))}
      </ul>
      {rows.length > limit && <p className="muted small">Showing the latest {limit}. Export for the full log.</p>}
    </div>
  )
}
