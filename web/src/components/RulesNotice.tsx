import { useState } from 'react'
import { RULES_VERSION } from '../engine'
import { errorText } from '../data/supabase'
import { setField } from '../data/writes'
import type { Campaign } from '../data/types'

/** Shown when the published rules are newer than the version this campaign last loaded. */
export function RulesNotice({ campaign, canAcknowledge }: { campaign: Campaign; canAcknowledge: boolean }) {
  const [error, setError] = useState<string | null>(null)
  if (campaign.rules_version === RULES_VERSION) return null
  return (
    <div className="card notice small">
      <p>
        <strong>Rules updated</strong> to {RULES_VERSION}
        {campaign.rules_version ? ` (this campaign last loaded ${campaign.rules_version})` : ''}.{' '}
        <a href="./rules/rules.md" target="_blank" rel="noreferrer">Read the rules</a>
      </p>
      {canAcknowledge && (
        <button className="secondary" onClick={() =>
          setField('campaigns', campaign.id, 'rules_version', RULES_VERSION).catch((e) => setError(errorText(e)))}>
          Got it
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
