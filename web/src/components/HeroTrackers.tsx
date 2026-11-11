import { CORE, harmBoxes, stressStage, trait, type Sheet } from '../engine'
import { Track } from './Track'

/** Harm, Stress and Drive for one hero, sized and labeled from the rules data. */
export function HeroTrackers({ hero, onChange }: {
  hero: Sheet & { harm: number; stress: number; drive: number; trait_id?: string | null }
  onChange?: (field: 'harm' | 'stress' | 'drive', value: number) => void
}) {
  const boxes = harmBoxes(hero)
  const stage = stressStage(hero.stress)
  const t = trait(hero.trait_id)
  const stageLine = t && (stage.id === 'steady' ? t.steady : stage.id === 'fraying' ? t.fraying : t.breaking)
  return (
    <>
      <Track label="Harm" value={hero.harm} max={boxes.length} names={boxes}
        onChange={onChange && ((v) => onChange('harm', v))} />
      {hero.harm > 0 && <p className="small muted">{boxes[Math.min(hero.harm, boxes.length) - 1]}</p>}
      <Track label={`Stress · ${stage.name}`} value={hero.stress} max={CORE.stress.boxes}
        onChange={onChange && ((v) => onChange('stress', v))} />
      {stageLine && <p className="small muted">{stageLine}</p>}
      <Track label="Drive" value={hero.drive} max={CORE.drive.max}
        onChange={onChange && ((v) => onChange('drive', v))} />
    </>
  )
}
