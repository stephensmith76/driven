import { ScenePanel } from '../components/ScenePanel'
import { RollLog } from '../components/RollLog'
import { useCampaign, useCharacters, useLiveRows } from '../data/hooks'
import type { Clock, Scene } from '../data/types'

/** Read-only Table display for a TV or spare tablet: zone board, public clocks and the roll log. Open it on a device that has joined the campaign. */
export function Display({ campaignId }: { campaignId: string }) {
  const { campaign, error } = useCampaign(campaignId)
  const { rows: characters } = useCharacters(campaignId)
  const { rows: scenes } = useLiveRows<Scene>('scene', campaignId)
  const { rows: clocks } = useLiveRows<Clock>('clocks', campaignId, '*', { column: 'sort' })
  if (error) return <main className="page"><p className="error">{error}</p></main>
  if (!campaign) return <main className="page"><p className="muted">Loading…</p></main>
  const shown = clocks.filter((c) => c.visible_to_players)
  return (
    <main className="page wide display">
      <h1>{campaign.name} · Night {campaign.night}</h1>
      <ScenePanel scene={scenes[0]} characters={characters} />
      {shown.length > 0 && (
        <section className="chips">
          {shown.map((c) => <span key={c.id} className="tag">{c.name} {c.filled}/{c.size}</span>)}
        </section>
      )}
      <section className="card stack">
        <h2>Roll log</h2>
        <RollLog campaignId={campaignId} isGm={false} run={() => undefined} limit={12} showExport={false} />
      </section>
    </main>
  )
}
