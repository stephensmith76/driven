import { flair, heroTrait, stressStage, traitLine, type CustomTrait } from '../engine'

/** A hero's Trait in full (the perk for their current Stress stage is marked) and their Flairs. */
export function TraitCard({ hero }: {
  hero: { stress: number; trait_id?: string | null; custom_trait?: CustomTrait | null; flair_ids?: string[] | null }
}) {
  const t = heroTrait(hero)
  const stage = stressStage(hero.stress).id
  const flairs = (hero.flair_ids ?? []).map((id) => flair(id)).filter((f) => f !== undefined)
  const now = <span className="tag">now</span>
  return (
    <div className="stack small">
      {!t ? <p className="muted">No Trait picked. Edit the build to pick one.</p> : (
        <>
          <p><strong>{t.name}</strong></p>
          <ul className="plain">
            {t.drive_trigger && <li><strong>Drive trigger.</strong> {t.drive_trigger}</li>}
            <li><strong>Steady (0 to 3 Stress).</strong> {traitLine(t, 'steady')} {stage === 'steady' && now}</li>
            <li><strong>Fraying (4 to 7).</strong> {traitLine(t, 'fraying')} <span className="muted">Replaces Steady.</span> {stage === 'fraying' && now}</li>
            {t.hook && <li><strong>Hook (while Fraying).</strong> {t.hook}</li>}
            <li><strong>Breaking (8).</strong> {traitLine(t, 'breaking')} <span className="muted">Your Fraying perk is off.</span> {stage === 'breaking' && now}</li>
          </ul>
        </>
      )}
      <p><strong>Flairs</strong></p>
      {flairs.length === 0 ? <p className="muted">None.</p> : (
        <ul className="plain">
          {flairs.map((f) => <li key={f.id}><strong>{f.name}{f.trial ? ' (trial)' : ''}.</strong> {f.text}</li>)}
        </ul>
      )}
    </div>
  )
}
