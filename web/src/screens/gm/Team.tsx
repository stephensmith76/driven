import { useEffect, useRef, useState } from 'react'
import { setField } from '../../data/writes'
import { useRunner } from '../../components/Toast'
import { TeamCard } from '../../components/TeamCard'
import { TEAM, type LairSheet, type TeamSheet } from '../../engine'
import { GmShell, type GmContext } from './GmShell'

/** GM Team sheet: the Lair (style, rooms, found or burned) and the team's Assets. Players see it on their sheets. */
export function Team({ campaignId }: { campaignId: string }) {
  return <GmShell campaignId={campaignId} tab="team">{(ctx) => <TeamBody {...ctx} />}</GmShell>
}

function TeamBody({ campaign }: GmContext) {
  const { run, report, toast } = useRunner()
  const team: TeamSheet = campaign.settings.team ?? {}
  const lair = team.lair ?? null

  const save = (next: TeamSheet, said?: string) => run(async () => {
    await setField('campaigns', campaign.id, 'settings', { ...campaign.settings, team: next })
    if (said) report(said)
  })
  const setLair = (patch: Partial<LairSheet>, said?: string) => save({ ...team, lair: { ...(lair ?? {}), ...patch } }, said)
  const toggle = (list: string[] | undefined, id: string) => (list?.includes(id) ? list.filter((x) => x !== id) : [...(list ?? []), id])

  return (
    <>
      <section className="card stack">
        <h2>Team sheet</h2>
        <p className="small"><strong>Team pick.</strong> {TEAM.team_pick}</p>
        <p className="small muted">Everything here is shared by the team. Players see it on their sheets, and a Lair changes what Dawn does for every hero.</p>
      </section>

      <div className="gm-grid">
        <section className="card stack">
          <h2>Lair</h2>
          {!lair ? (
            <>
              <p className="muted">The team has no Lair yet.</p>
              <div className="button-row">
                <button onClick={() => save({ ...team, lair: { name: '', style: TEAM.lair.styles[0].id, rooms: [] } }, 'The team has a Lair.')}>Found a Lair</button>
              </div>
            </>
          ) : (
            <>
              <label htmlFor="lair-name">Name</label>
              <SavedInput id="lair-name" value={lair.name ?? ''} onSave={(v) => setLair({ name: v })} />

              <label htmlFor="lair-style">Style</label>
              <select id="lair-style" value={lair.style ?? ''} onChange={(e) => setLair({ style: e.target.value })}>
                <option value="">No style</option>
                {TEAM.lair.styles.map((s) => <option key={s.id} value={s.id}>{s.name}: {s.what}</option>)}
              </select>
              {TEAM.lair.styles.filter((s) => s.id === lair.style).map((s) => <p key={s.id} className="small muted">{s.text}</p>)}

              <p><strong>Rooms</strong> <span className="muted small">one Advancement pick each</span></p>
              {TEAM.lair.rooms.map((r) => (
                <label key={r.id} className="check small">
                  <input type="checkbox" checked={lair.rooms?.includes(r.id) ?? false} onChange={() => setLair({ rooms: toggle(lair.rooms, r.id) })} />
                  <span><strong>{r.name}.</strong> {r.text}</span>
                </label>
              ))}

              <p><strong>Trouble</strong></p>
              <label className="check small">
                <input type="checkbox" checked={Boolean(lair.found)} onChange={(e) => setLair({ found: e.target.checked }, e.target.checked ? 'The Lair is found. Tick Home by 2 for every hero who uses it.' : undefined)} />
                <span><strong>Found.</strong> {TEAM.lair.found}</span>
              </label>
              <label className="check small">
                <input type="checkbox" checked={Boolean(lair.burned)} onChange={(e) => setLair({ burned: e.target.checked }, e.target.checked ? 'The Lair is burned. It gives nothing at Dawn until you clear this.' : undefined)} />
                <span><strong>Burned.</strong> {TEAM.lair.burned}</span>
              </label>

              <div className="button-row">
                <button className="secondary" onClick={() => save({ ...team, lair: null }, 'The Lair is removed from the team sheet.')}>Remove the Lair</button>
              </div>
            </>
          )}
        </section>

        <section className="card stack">
          <h2>Assets</h2>
          <p className="small muted">One Advancement pick each. With a Lair, the Crime lab and the Back-alley clinic are rooms in it instead.</p>
          {TEAM.assets.map((a) => (
            <label key={a.id} className="check small">
              <input type="checkbox" checked={team.assets?.includes(a.id) ?? false} onChange={() => save({ ...team, assets: toggle(team.assets, a.id) })} />
              <span><strong>{a.name}{a.trial ? ' (trial)' : ''}.</strong> {a.text}</span>
            </label>
          ))}
          <label htmlFor="team-notes">Notes</label>
          <SavedInput id="team-notes" value={team.notes ?? ''} onSave={(v) => save({ ...team, notes: v })} long />
        </section>

        <section className="card stack">
          <h2>What players see</h2>
          <TeamCard team={team} />
          {!lair && !(team.assets?.length) && !team.notes?.trim() && <p className="muted small">Nothing yet. The Team section appears on player sheets once there is a Lair, an Asset or a note.</p>}
        </section>
      </div>
      {toast}
    </>
  )
}

/** A text field that saves when you leave it, and follows changes from other devices while you're not typing. */
function SavedInput({ id, value, onSave, long }: { id: string; value: string; onSave: (v: string) => void; long?: boolean }) {
  const [text, setText] = useState(value)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(value) }, [value])
  const props = {
    id, value: text,
    onFocus: () => { focused.current = true },
    onBlur: () => { focused.current = false; if (text !== value) onSave(text) },
  }
  return long
    ? <textarea rows={3} maxLength={600} {...props} onChange={(e) => setText(e.target.value)} />
    : <input maxLength={80} {...props} onChange={(e) => setText(e.target.value)} />
}
