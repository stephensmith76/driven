import { useState } from 'react'
import { errorText } from '../../data/supabase'
import { useCampaign, useCharacters, useMembers } from '../../data/hooks'
import { setField } from '../../data/writes'
import { joinLink } from '../../router'
import { Track } from '../../components/Track'

// M0 GM Table: join link, who's here, live hero trackers. Full Table is M3.
export function GmTable({ campaignId }: { campaignId: string }) {
  const { campaign, error: cErr } = useCampaign(campaignId)
  const { rows: characters } = useCharacters(campaignId)
  const members = useMembers(campaignId)
  const [error, setError] = useState<string | null>(null)

  if (cErr) return <main className="page"><p className="error">{cErr}</p><a href="#/gm">Back</a></main>
  if (!campaign) return <main className="page"><p className="muted">Loading…</p></main>

  const link = joinLink(campaign.join_code)
  const write = (id: string, field: string, v: unknown) =>
    setField('characters', id, field, v).catch((e) => setError(errorText(e)))

  return (
    <main className="page wide">
      <h1>{campaign.name}</h1>
      <section className="card stack">
        <p>Join code <strong className="code">{campaign.join_code}</strong></p>
        <p className="small break"><a href={link}>{link}</a></p>
        <button className="secondary" onClick={() => navigator.clipboard?.writeText(link)}>Copy join link</button>
      </section>
      {error && <p className="error">{error}</p>}
      <section className="grid">
        {characters.map((h) => {
          const holders = members.filter((m) => m.character_id === h.id)
          return (
            <article key={h.id} className="card">
              <h2>{h.name}</h2>
              <p className="muted small">{holders.length ? `${holders.length} device(s)` : 'unclaimed'}</p>
              <Track label="Harm" value={h.harm} max={4} onChange={(v) => write(h.id, 'harm', v)} />
              <Track label="Stress" value={h.stress} max={8} onChange={(v) => write(h.id, 'stress', v)} />
              <Track label="Drive" value={h.drive} max={6} onChange={(v) => write(h.id, 'drive', v)} />
            </article>
          )
        })}
      </section>
      <p className="muted small">{members.filter((m) => m.role === 'player').length} player device(s) joined.</p>
    </main>
  )
}
