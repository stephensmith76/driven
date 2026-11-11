import { useEffect, useMemo, useState } from 'react'
import { errorText, supabase } from '../../data/supabase'
import { useCampaign, useCharacters, useMembers } from '../../data/hooks'
import { go } from '../../router'

export function Join({ code }: { code: string }) {
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('join_campaign', { p_join_code: code }).then(({ data, error }) => {
      if (error) setError(error.message)
      else setCampaignId(data as string)
    })
  }, [code])

  const { campaign } = useCampaign(campaignId)
  const { rows: characters, loading } = useCharacters(campaignId)
  const members = useMembers(campaignId)

  const claimed = useMemo(
    () => new Set(members.map((m) => m.character_id).filter(Boolean)),
    [members],
  )
  const heroes = useMemo(
    () => characters.filter((c) => !c.is_npc)
      .sort((x, y) => Number(claimed.has(x.id)) - Number(claimed.has(y.id)) || x.name.localeCompare(y.name)),
    [characters, claimed],
  )

  const claim = async (id: string) => {
    const { error } = await supabase.rpc('claim_character', { p_character_id: id })
    if (error) setError(errorText(error))
    else go(`/c/${campaignId}/sheet`)
  }

  if (error) return <main className="page"><p className="error">{error}</p><a href="#/">Back</a></main>
  if (!campaign) return <main className="page"><p className="muted">Joining…</p></main>

  return (
    <main className="page">
      <h1>{campaign.name}</h1>
      <p className="muted">Pick your hero.</p>
      {loading ? <p className="muted">Loading heroes…</p> : (
        <ul className="list">
          {heroes.map((h) => (
            <li key={h.id}>
              <button className="row-button" onClick={() => claim(h.id)}>
                <span>
                  <strong>{h.name}</strong>
                  <span className="muted small block">{h.civilian}</span>
                </span>
                {claimed.has(h.id) && <span className="tag">taken</span>}
              </button>
            </li>
          ))}
          {heroes.length === 0 && <li className="muted">No heroes yet.</li>}
        </ul>
      )}
      {campaign.settings.players_can_build && (
        <button className="secondary" onClick={() => go(`/c/${campaignId}/build`)}>Make a new character</button>
      )}
    </main>
  )
}
