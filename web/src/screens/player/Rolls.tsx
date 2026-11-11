import { useCampaign, useCharacters, useLiveRows, useMe } from '../../data/hooks'
import type { Scene } from '../../data/types'
import { Roller } from '../../components/Roller'
import { RollLog } from '../../components/RollLog'
import { ScenePanel } from '../../components/ScenePanel'
import { useRunner } from '../../components/Toast'

/** Player Rolls screen: the dice roller for their hero, the scene, and the table's roll log. */
export function Rolls({ campaignId, characterId, stat }: { campaignId: string; characterId?: string; stat?: string }) {
  const { campaign } = useCampaign(campaignId)
  const { rows: characters } = useCharacters(campaignId)
  const { rows: scenes } = useLiveRows<Scene>('scene', campaignId)
  const { member, role } = useMe(campaignId)
  const { run, report, toast } = useRunner()

  const isGm = role === 'gm'
  const heroId = characterId ?? member?.character_id ?? null
  if (!campaign || !member) return <main className="page"><p className="muted">Loading…</p></main>
  if (!heroId) {
    return <main className="page"><p>No hero picked yet.</p><a href={`#/join/${campaign.join_code}`}>Pick one</a></main>
  }
  const hero = characters.find((c) => c.id === heroId)

  return (
    <main className="page">
      <header className="card">
        <h1>Rolls</h1>
        <p className="small"><a href={`#/c/${campaignId}/sheet/${heroId}`}>← {hero?.name ?? 'Sheet'}</a>{' · '}{campaign.name}</p>
      </header>
      <section className="card stack">
        <h2>Roll</h2>
        {hero
          ? <Roller key={`${heroId}:${stat ?? ''}`} campaignId={campaignId} heroes={characters} myHeroId={heroId} isGm={isGm}
            initialStat={stat} run={run} report={report} />
          : <p className="muted small">Loading hero…</p>}
      </section>
      <section className="card stack">
        <h2>Scene</h2>
        <ScenePanel scene={scenes[0]} characters={characters} />
      </section>
      <section className="card stack">
        <h2>Roll log</h2>
        <RollLog campaignId={campaignId} isGm={isGm} run={run} />
      </section>
      {toast}
    </main>
  )
}
