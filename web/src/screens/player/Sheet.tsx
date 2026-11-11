import { useEffect, useState } from 'react'
import { ensureSignedIn, errorText } from '../../data/supabase'
import { useCampaign, useCharacters, useMembers } from '../../data/hooks'
import { setField } from '../../data/writes'
import { HeroTrackers } from '../../components/HeroTrackers'
import { RulesNotice } from '../../components/RulesNotice'
import { archetype, defenses, trait } from '../../engine'

// M0 placeholder sheet: proves claim + live sync. The full Sheet is M2.
export function Sheet({ campaignId }: { campaignId: string }) {
  const [uid, setUid] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void ensureSignedIn().then(setUid) }, [])

  const { campaign } = useCampaign(campaignId)
  const { rows: characters } = useCharacters(campaignId)
  const members = useMembers(campaignId)
  const me = members.find((m) => m.user_id === uid)
  const hero = characters.find((c) => c.id === me?.character_id)

  const write = (field: string, v: unknown) =>
    hero && setField('characters', hero.id, field, v).catch((e) => setError(errorText(e)))

  if (!campaign) return <main className="page"><p className="muted">Loading…</p></main>
  if (me && !hero && me.character_id === null) {
    return <main className="page"><p>No hero picked yet.</p><a href={`#/join/${campaign.join_code}`}>Pick one</a></main>
  }
  if (!hero) return <main className="page"><p className="muted">Loading hero…</p></main>
  const d = defenses(hero)

  return (
    <main className="page">
      <header className="sheet-header card">
        <h1>{hero.name}</h1>
        <p className="muted small">
          {hero.civilian} · {archetype(hero.archetype_id)?.name ?? '—'} · {trait(hero.trait_id)?.name ?? '—'}
        </p>
        <HeroTrackers hero={hero} onChange={write} />
      </header>
      <RulesNotice campaign={campaign} canAcknowledge={false} />
      <p className="small">Guard {d.guard.total} · Wits {d.wits.total} · Poise {d.poise.total}</p>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        {campaign.name} · Night {campaign.night} · {campaign.phase}. The full sheet arrives in M2.
      </p>
      <p className="small"><a href={`#/join/${campaign.join_code}`}>Switch hero</a></p>
    </main>
  )
}
