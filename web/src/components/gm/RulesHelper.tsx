import { useState } from 'react'
import { supabase } from '../../data/supabase'
import { useCharacters } from '../../data/hooks'
import { ARCHETYPES, CORE, GEAR, POWERS } from '../../engine'
import { partySummary, type Hero, type RulesData } from '../../../../supabase/functions/rules-helper/party'

const MAX = 500
const TIMEOUT_MS = 20_000
const RULES_DATA: RulesData = {
  defenseBase: CORE.defense_base, archetypes: ARCHETYPES, gear: GEAR, powers: POWERS,
}

/** The GM-only rules helper, docked at the bottom of every GM screen. */
export function RulesHelper({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [scene, setScene] = useState(false)
  const [caseFile, setCaseFile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { rows: characters } = useCharacters(open ? campaignId : null)

  const ask = async () => {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true); setError(null); setAnswer(null)
    const timer = new AbortController()
    const t = setTimeout(() => timer.abort(), TIMEOUT_MS)
    try {
      const { data, error } = await supabase.functions.invoke('rules-helper', {
        body: { campaign_id: campaignId, question: q, include_scene: scene, include_case: caseFile },
        signal: timer.signal,
      } as never)
      if (error) {
        // Non-2xx replies carry the function's own message in the response body.
        const res = (error as { context?: Response }).context
        const msg = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null
        throw new Error(msg ?? error.message)
      }
      setAnswer((data as { answer: string }).answer)
    } catch (e) {
      setError((e as Error).name === 'AbortError' ? 'The helper took longer than 20 seconds.' : (e as Error).message)
    } finally { clearTimeout(t); setBusy(false) }
  }

  const copy = async () => {
    const party = partySummary(characters.filter((c) => !c.is_npc) as unknown as Hero[], RULES_DATA)
    const rules = new URL('rules/rules.md', window.location.href.split('#')[0]).href
    const text = `Driven rules question: ${question.trim()}\n\nParty:\n${party}\n\nRules: ${rules}\n\n` +
      'Answer from the rules only. Name the roll (who, which stat, defense as a number), what a Miss and each Impact level mean, and two costs for Impact 1.'
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { setError('Could not copy. Select and copy from the box instead.') }
  }

  return (
    <aside className="helper-dock" aria-label="Rules helper">
      <button className="secondary helper-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide rules helper' : 'Rules helper'}
      </button>
      {open && (
        <div className="card stack helper-body">
          <label htmlFor="rh-q">Ask how to run something</label>
          <textarea id="rh-q" rows={2} maxLength={MAX} value={question} placeholder="Sneak past guards into a building"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void ask() }} />
          <div className="small muted">{question.length}/{MAX}</div>
          <label className="check"><input type="checkbox" checked={scene} onChange={(e) => setScene(e.target.checked)} /> Include the current scene and enemies</label>
          <label className="check"><input type="checkbox" checked={caseFile} onChange={(e) => setCaseFile(e.target.checked)} /> Include the hidden case file</label>
          <div className="button-row">
            <button disabled={!question.trim() || busy} onClick={() => void ask()}>{busy ? 'Thinking…' : 'Ask'}</button>
            <button className="secondary" disabled={!question.trim()} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy question with context'}</button>
          </div>
          {error && (
            <div role="alert">
              <p className="error">{error}</p>
              <button className="mini secondary" disabled={busy} onClick={() => void ask()}>Retry</button>
            </div>
          )}
          {answer && (
            <div aria-live="polite">
              <p className="helper-answer">{answer}</p>
              <p className="small muted">Check the rule if this looks wrong.</p>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
