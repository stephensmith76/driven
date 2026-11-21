import { useState } from 'react'
import { setField, updateColumns } from '../../../data/writes'
import type { Campaign, Character } from '../../../data/types'
import {
  ADVANCEMENT_KINDS, advancementOptions, pickLabel, sheetAfterPick, teamAfterPick,
  type AdvancementKind, type AdvancementPick,
} from '../../../engine'
import type { Report } from './Actions'

/**
 * Advancement on the sheet: take this case's pick, see every pick so far, undo the last one.
 * The pick changes the sheet (stat, Flair, ability, slot) and is kept in the hero's history.
 * Asset and Lair room picks go on the team sheet, which only the GM can write.
 */
export function AdvancementPanel({ hero, campaign, isGm, report, run }: {
  hero: Character; campaign: Campaign; isGm: boolean; report: Report
  run: (fn: () => Promise<unknown>) => void
}) {
  const history = hero.advancements ?? []
  const team = campaign.settings.team
  const options = advancementOptions(hero, history, team)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<AdvancementKind | null>(null)
  const [choice, setChoice] = useState('')
  const locked = hero.locked && !isGm
  const current = options.find((o) => o.kind === kind)
  const needsChoice = kind !== null && kind !== 'slot'
  const ready = current?.ok && (!needsChoice || current.choices.some((c) => c.id === choice && c.ok))

  /** Write the sheet change and the history together. Before the migration, the history can't be saved: say so. */
  const write = async (patch: Record<string, unknown>, next: AdvancementPick[]) => {
    try {
      await updateColumns(hero.id, { ...patch, advancements: next })
      return true
    } catch (e) {
      if (!String((e as { message?: string })?.message ?? e).includes('advancements')) throw e
      await updateColumns(hero.id, patch)
      return false
    }
  }

  const take = () => run(async () => {
    if (!kind || !ready) return
    const id = kind === 'slot' ? undefined : choice
    const pick: AdvancementPick = { kind, ...(id ? { id } : {}), label: pickLabel(kind, id, hero), night: campaign.night, at: new Date().toISOString() }
    const saved = await write(sheetAfterPick(hero, pick, 1), [...history, pick])
    const notes: string[] = []
    if (!saved) notes.push("The pick is on the sheet, but the history couldn't be saved yet: the GM needs to apply the advancements migration.")
    const nextTeam = teamAfterPick(team, pick, 1)
    let said = `Advancement: ${pick.label}.`
    if (nextTeam && isGm) await setField('campaigns', campaign.id, 'settings', { ...campaign.settings, team: nextTeam })
    if (nextTeam && !isGm) said += ' Ask the GM to add it to the team sheet.'
    if (kind === 'slot') said += ' Fill it in Edit build, or bank it for a strange power (2 slots).'
    report(said, notes)
    setOpen(false); setKind(null); setChoice('')
  })

  const undo = () => run(async () => {
    const last = history[history.length - 1]
    if (!last) return
    await write(sheetAfterPick(hero, last, -1), history.slice(0, -1))
    const nextTeam = teamAfterPick(team, last, -1)
    if (nextTeam && isGm) await setField('campaigns', campaign.id, 'settings', { ...campaign.settings, team: nextTeam })
    report(`Undid: ${last.label}.`, nextTeam && !isGm ? ['Ask the GM to take it off the team sheet too.'] : [])
  })

  return (
    <div className="stack small">
      <p className="muted">When a case closes, each hero takes one pick.</p>
      {history.length === 0 ? <p className="muted">No picks yet.</p> : (
        <ol className="abilities">
          {history.map((p, i) => <li key={i}>{p.label}{p.night != null && <span className="muted"> · Night {p.night}</span>}</li>)}
        </ol>
      )}
      {locked ? <p className="muted">The GM has locked this sheet's build.</p> : (
        <div className="button-row">
          <button className={open ? 'secondary' : ''} onClick={() => { setOpen((o) => !o); setKind(null); setChoice('') }}>{open ? 'Cancel' : 'Take a pick (case closed)'}</button>
          {history.length > 0 && !open && <button className="secondary" onClick={undo}>Undo last pick</button>}
        </div>
      )}
      {open && !locked && (
        <div className="item stack">
          {ADVANCEMENT_KINDS.map((k) => {
            const o = options.find((x) => x.kind === k.kind)!
            return (
              <label key={k.kind} className={`pick ${kind === k.kind ? 'on' : ''}`}>
                <input type="radio" name="adv-kind" checked={kind === k.kind} disabled={!o.ok}
                  onChange={() => { setKind(k.kind); setChoice('') }} />{' '}
                <strong>{k.name}.</strong> <span className="muted">{k.text}</span>
                {!o.ok && o.reason && <span className="warn"> {o.reason}</span>}
              </label>
            )
          })}
          {current && needsChoice && current.ok && (
            <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Which one">
              <option value="">Pick one…</option>
              {current.choices.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.ok}>{c.label}{c.reason ? ` (${c.reason})` : ''}</option>
              ))}
            </select>
          )}
          {kind === 'asset' && !isGm && <p className="muted">The GM adds Assets and Lair rooms to the team sheet.</p>}
          <button disabled={!ready} onClick={take}>Take it</button>
        </div>
      )}
    </div>
  )
}
