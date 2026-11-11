import { useState } from 'react'
import { supabase } from '../../data/supabase'
import { setField } from '../../data/writes'
import { deleteRow } from '../../data/gm'
import type { Clock } from '../../data/types'
import { CORE, tickClock } from '../../engine'
import { Track } from '../Track'

const KINDS: Clock['kind'][] = ['scheme', 'heat', 'goal', 'endgame', 'custom']

/** Every clock in the campaign, hidden ones included. All editable by hand. */
export function ClocksPanel({ campaignId, clocks, run, report, kinds }: {
  campaignId: string
  clocks: Clock[]
  run: (fn: () => Promise<unknown>) => void
  report: (msg: string) => void
  /** Show only these kinds (default: all). */
  kinds?: Clock['kind'][]
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Clock['kind']>('goal')
  const [size, setSize] = useState(4)
  const [visible, setVisible] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const shown = clocks.filter((c) => !kinds || kinds.includes(c.kind)).sort((a, b) => a.sort - b.sort)

  const setFilled = (c: Clock, v: number) => run(async () => {
    const t = tickClock(c, v - c.filled)
    await setField('clocks', c.id, 'filled', t.filled)
    if (t.events.length) report(`${c.name}: ${t.events.join(' ')}`)
  })

  const add = () => run(async () => {
    const { error } = await supabase.from('clocks').insert({
      campaign_id: campaignId, name: name.trim() || 'Clock', kind, size, visible_to_players: visible,
      sort: Math.max(0, ...clocks.map((c) => c.sort)) + 1,
    })
    if (error) throw error
    setAdding(false)
    setName('')
  })

  return (
    <div className="stack">
      {shown.length === 0 && <p className="muted small">No clocks.</p>}
      {shown.map((c) => (
        <div key={c.id} className="clock-row">
          <Track label={`${c.name}${c.visible_to_players ? '' : ' (hidden)'}`} value={c.filled} max={c.size} onChange={(v) => setFilled(c, v)} />
          <div className="button-row small">
            <button className="mini secondary" onClick={() => run(() => setField('clocks', c.id, 'visible_to_players', !c.visible_to_players))}>
              {c.visible_to_players ? 'Hide from players' : 'Show to players'}
            </button>
            {confirmDelete === c.id ? (
              <>
                <button className="mini" onClick={() => run(async () => { await deleteRow('clocks', c.id); setConfirmDelete(null) })}>Delete {c.name}</button>
                <button className="mini secondary" onClick={() => setConfirmDelete(null)}>Keep</button>
              </>
            ) : (
              <button className="mini secondary" onClick={() => setConfirmDelete(c.id)}>Delete</button>
            )}
            {CORE.clocks.find((r) => r.kind === c.kind) && (
              <span className="muted">Half: {CORE.clocks.find((r) => r.kind === c.kind)!.half}</span>
            )}
          </div>
        </div>
      ))}
      {adding ? (
        <div className="item stack">
          <div className="button-row">
            <input aria-label="Clock name" placeholder="Name (a hostage, a fuse, sirens…)" value={name} onChange={(e) => setName(e.target.value)} />
            <select aria-label="Kind" value={kind} onChange={(e) => {
              const k = e.target.value as Clock['kind']
              setKind(k)
              const rule = CORE.clocks.find((r) => r.kind === k)
              if (rule) setSize(rule.size)
              setVisible(k !== 'endgame')
            }}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <label className="small">Size <input type="number" min={1} max={20} value={size} onChange={(e) => setSize(Number(e.target.value) || 1)} style={{ width: '4.5rem' }} /></label>
            <label className="small check"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Players can see it</label>
          </div>
          <div className="button-row">
            <button onClick={add}>Add clock</button>
            <button className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="secondary" onClick={() => setAdding(true)}>New clock</button>
      )}
    </div>
  )
}
