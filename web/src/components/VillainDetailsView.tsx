import { POWERS, VILLAINS, type VillainDetails } from '../engine'

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n))

/** The parts of a villain sheet that aren't numbers on a track: role, Trait lines, Tricks, Weakness, powers. */
export function VillainDetailsView({ details, presence }: { details: VillainDetails | null | undefined; presence?: number }) {
  if (!details) return null
  const role = VILLAINS.roles.find((r) => r.id === details.role)
  const t = details.trait
  const powers = (details.powers ?? []).map((id) => POWERS.find((p) => p.id === id)).filter((p) => p !== undefined)
  const empty = !role && !details.concept && !t?.name && !t?.fraying && !t?.breaking && !details.drive_trigger
    && !(details.tricks ?? []).length && !details.weakness && !details.threat && !powers.length && !details.notes
  if (empty) return null
  return (
    <div className="stack small villain-details">
      {(role || details.concept) && <p>{role && <span className="tag">{role.name}</span>} {details.concept}</p>}
      {(t?.name || t?.fraying || t?.breaking) && (
        <p>
          <strong>Trait{t?.name ? `: ${t.name}` : ''}.</strong>
          {t?.fraying && <> <em>Fraying:</em> {t.fraying}</>}
          {t?.breaking && <> <em>Breaking:</em> {t.breaking}</>}
        </p>
      )}
      {(details.drive_trigger || role) && <p><strong>Earns Drive when:</strong> {details.drive_trigger || role?.drive_trigger}</p>}
      {details.threat !== undefined && presence !== undefined && (
        <p><strong>Presence attack</strong> (free, once per round): {signed(presence)} vs Poise, 1 Stress per Impact.{details.threat && <> “{details.threat}”</>}</p>
      )}
      {(details.tricks ?? []).filter((k) => k.text).map((k, i) => <p key={i}><strong>Trick ({k.cost} Drive):</strong> {k.text}</p>)}
      {details.weakness && <p><strong>Weakness:</strong> {details.weakness}</p>}
      {details.weapon && details.weapon !== 'unarmed' && <p><strong>Weapon:</strong> {details.weapon === 'pistol' ? 'gun' : details.weapon}</p>}
      {powers.map((p) => (
        <p key={p.id}><strong>{p.name}:</strong> {p.abilities.map((a) => a.text).join(' ')}</p>
      ))}
      {details.gunner && <p>One in the group carries a gun.</p>}
      {details.notes && <p className="muted">{details.notes}</p>}
    </div>
  )
}
