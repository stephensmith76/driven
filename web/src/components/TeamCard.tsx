import { TEAM, lairStyle, type TeamSheet } from '../engine'

/** The team sheet, read only: the Lair, its style and rooms, and the team's Assets. `brief` leaves out the rules text. */
export function TeamCard({ team, brief }: { team: TeamSheet | null | undefined; brief?: boolean }) {
  if (!team) return null
  const lair = team.lair
  const style = lairStyle(lair?.style)
  const rooms = TEAM.lair.rooms.filter((r) => lair?.rooms?.includes(r.id))
  const assets = TEAM.assets.filter((a) => team.assets?.includes(a.id))
  return (
    <div className="stack small">
      {lair && (
        <div className="stack">
          <p>
            <strong>Lair{lair.name ? `: ${lair.name}` : ''}.</strong>{' '}
            {style && <span className="tag">{style.name}</span>}{' '}
            {lair.burned && <span className="tag warn">Burned</span>}{' '}
            {lair.found && !lair.burned && <span className="tag warn">Found</span>}
          </p>
          {lair.burned
            ? <p className="warn">{TEAM.lair.burned}</p>
            : (
              <ul className="plain">
                {!brief && TEAM.lair.basics.map((b) => <li key={b.name}><strong>{b.name}.</strong> {b.text}</li>)}
                {style && <li><strong>{style.name}.</strong> {brief ? style.what : style.text}</li>}
                {rooms.map((r) => <li key={r.id}><strong>{r.name}.</strong> {!brief && r.text}</li>)}
              </ul>
            )}
        </div>
      )}
      {assets.length > 0 && (
        <ul className="plain">
          {assets.map((a) => <li key={a.id}><strong>{a.name}.</strong> {!brief && a.text}</li>)}
        </ul>
      )}
      {team.notes?.trim() && <p className="muted">{team.notes}</p>}
    </div>
  )
}
