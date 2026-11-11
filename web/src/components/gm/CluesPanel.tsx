import { useState } from 'react'
import { supabase } from '../../data/supabase'
import { deleteRow } from '../../data/gm'
import type { Character, Clue } from '../../data/types'

/** Found clues (what players see), with add and remove. */
export function CluesPanel({ campaignId, clues, heroes, night, run }: {
  campaignId: string
  clues: Clue[]
  heroes: Character[]
  night: number
  run: (fn: () => Promise<unknown>) => void
}) {
  const [text, setText] = useState('')
  const [personal, setPersonal] = useState('')
  const [arc, setArc] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const name = (id: string | null) => heroes.find((h) => h.id === id)?.name

  const add = () => run(async () => {
    const { error } = await supabase.from('clues').insert({
      campaign_id: campaignId, text: text.trim(), night, personal_for: personal || null, is_arc: arc,
    })
    if (error) throw error
    setText('')
    setPersonal('')
    setArc(false)
  })

  const caseClues = clues.filter((c) => !c.is_arc)
  const arcClues = clues.filter((c) => c.is_arc)
  const row = (c: Clue) => (
    <li key={c.id}>
      {c.text}{' '}
      {c.personal_for && <span className="tag">personal: {name(c.personal_for) ?? '?'}</span>}
      {c.night != null && <span className="muted small"> · Night {c.night}</span>}{' '}
      {confirm === c.id ? (
        <>
          <button className="mini" onClick={() => run(async () => { await deleteRow('clues', c.id); setConfirm(null) })}>Remove</button>{' '}
          <button className="mini secondary" onClick={() => setConfirm(null)}>Keep</button>
        </>
      ) : <button className="link small" onClick={() => setConfirm(c.id)}>remove</button>}
    </li>
  )

  return (
    <div className="stack">
      <p className="small muted">{caseClues.length} case clue{caseClues.length === 1 ? '' : 's'} found
        ({caseClues.reduce((s, c) => s + (c.personal_for ? 2 : 1), 0)} counting personal clues twice) · {arcClues.length} arc</p>
      {caseClues.length > 0 && <ul className="plain small">{caseClues.map(row)}</ul>}
      {arcClues.length > 0 && <><h3>Arc clues</h3><ul className="plain small">{arcClues.map(row)}</ul></>}
      <div className="button-row">
        <input aria-label="New clue" placeholder="Add a found clue" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: '12rem' }} />
        <select aria-label="Personal for" value={personal} onChange={(e) => setPersonal(e.target.value)}>
          <option value="">Not personal</option>
          {heroes.map((h) => <option key={h.id} value={h.id}>Personal: {h.name}</option>)}
        </select>
        <label className="small check"><input type="checkbox" checked={arc} onChange={(e) => setArc(e.target.checked)} /> Arc clue</label>
        <button disabled={!text.trim()} onClick={add}>Add</button>
      </div>
    </div>
  )
}
