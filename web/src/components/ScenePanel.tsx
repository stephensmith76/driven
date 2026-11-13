import { TAGS } from '../engine'
import type { Character, Scene } from '../data/types'
import { Portrait } from './Portrait'

const tagName = (id: string) => TAGS.tags.find((t) => t.id === id)?.name ?? id

/** What players see of the fight: zones with tags, where the heroes are, and the safe summary of enemies. */
export function ScenePanel({ scene, characters }: { scene: Scene | undefined; characters: Character[] }) {
  if (!scene) return null
  const hasMap = scene.zones.length > 0 || scene.public_enemies.length > 0
  if (!scene.title && !hasMap) return <p className="muted small">No scene set up yet.</p>
  const heroAt = (zoneId: string) => characters.filter((c) => scene.positions[c.id] === zoneId)
  const enemiesAt = (zoneId: string) => scene.public_enemies.filter((e) => e.zone === zoneId)
  const loose = scene.public_enemies.filter((e) => !e.zone || !scene.zones.some((z) => z.id === e.zone))

  return (
    <div className="stack">
      <p>{scene.title && <strong>{scene.title}</strong>}{scene.round > 0 && <span className="muted small"> · Round {scene.round}</span>}</p>
      {scene.text && <p className="small">{scene.text}</p>}
      <div className="zones">
        {scene.zones.map((z) => (
          <div key={z.id} className="zone card">
            <strong>{z.name}</strong>
            <div className="chips">{z.tags.map((t) => <span key={t} className="tag" title={TAGS.tags.find((x) => x.id === t)?.text}>{tagName(t)}</span>)}</div>
            <p className="small">
              {heroAt(z.id).map((h) => <span key={h.id} className="token hero">{h.portrait && <Portrait value={h.portrait} name={h.name} size={22} />}{h.name}</span>)}
              {enemiesAt(z.id).map((e) => <span key={e.id} className="token enemy">{e.portrait && <Portrait value={e.portrait} name={e.name} size={22} />}{e.name}{e.standing != null ? ` ×${e.standing}` : ''} · {e.state}</span>)}
            </p>
          </div>
        ))}
      </div>
      {loose.length > 0 && (
        <p className="small">Elsewhere: {loose.map((e) => <span key={e.id} className="token enemy">{e.portrait && <Portrait value={e.portrait} name={e.name} size={22} />}{e.name}{e.standing != null ? ` ×${e.standing}` : ''} · {e.state}</span>)}</p>
      )}
    </div>
  )
}
