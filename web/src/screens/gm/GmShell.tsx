import type { ReactNode } from 'react'
import { useCampaign, useMe } from '../../data/hooks'
import type { Campaign, Member } from '../../data/types'
import { RulesHelper } from '../../components/gm/RulesHelper'

export type GmContext = { campaign: Campaign; members: Member[]; uid: string | null }

const TABS = [
  { id: '', name: 'Table' },
  { id: 'night', name: 'Night' },
  { id: 'case', name: 'Case file' },
  { id: 'fight', name: 'Fight' },
  { id: 'villains', name: 'Villains' },
  { id: 'lab', name: 'Encounter lab' },
  { id: 'bank', name: 'Bank' },
  { id: 'admin', name: 'Admin' },
] as const

/** The frame for every GM screen: checks this device is the GM, then shows the nav. */
export function GmShell({ campaignId, tab, children }: {
  campaignId: string
  tab: (typeof TABS)[number]['id']
  children: (ctx: GmContext) => ReactNode
}) {
  const { campaign, error } = useCampaign(campaignId)
  const { role, members, uid } = useMe(campaignId)

  if (error) return <main className="page"><p className="error">{error}</p><a href="#/gm">Back</a></main>
  if (!campaign || !role) return <main className="page"><p className="muted">Loading…</p></main>
  if (role !== 'gm') {
    return (
      <main className="page">
        <p>This device has joined {campaign.name} as a player, not the GM.</p>
        <a href="#/gm">Enter the GM passcode</a>
      </main>
    )
  }
  return (
    <main className="page wide">
      <nav className="gm-nav" aria-label="GM screens">
        <strong className="gm-title">{campaign.name}</strong>
        {TABS.map((t) => (
          <a key={t.id} href={`#/gm/${campaignId}${t.id ? `/${t.id}` : ''}`} aria-current={t.id === tab ? 'page' : undefined}
            className={t.id === tab ? 'on' : ''}>{t.name}</a>
        ))}
        <span className="muted small">Night {campaign.night}</span>
      </nav>
      {children({ campaign, members, uid })}
      <RulesHelper campaignId={campaignId} />
    </main>
  )
}
