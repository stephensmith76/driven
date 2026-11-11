import { useState } from 'react'
import { supabase } from '../../data/supabase'
import { useCharacters, useLiveRows } from '../../data/hooks'
import { setField } from '../../data/writes'
import { deleteRow } from '../../data/gm'
import { applyPatch, exportCampaign, resolvePatch, show, undoImport, type Resolution } from '../../data/campaignIO'
import { sessionReport } from '../../data/sessionReport'
import { joinLink } from '../../router'
import { useRunner } from '../../components/Toast'
import { GmShell, type GmContext } from './GmShell'

export function Admin({ campaignId }: { campaignId: string }) {
  return <GmShell campaignId={campaignId} tab="admin">{(ctx) => <AdminBody {...ctx} />}</GmShell>
}

type ImportRow = { id: string; at: string; note: string; applied: boolean }

function AdminBody({ campaign, members, uid }: GmContext) {
  const cid = campaign.id
  const { rows: characters } = useCharacters(cid)
  const { run, report, toast } = useRunner()
  const [confirm, setConfirm] = useState<string | null>(null)
  const [name, setName] = useState(campaign.name)
  const [passcode, setPasscode] = useState('')

  const setSetting = (key: 'players_can_build' | 'players_see_sheets', v: boolean) =>
    run(() => setField('campaigns', cid, 'settings', { ...campaign.settings, [key]: v }))

  return (
    <>
      <div className="gm-grid">
        <section className="card stack">
          <h2>Campaign</h2>
          <label htmlFor="a-name">Name</label>
          <div className="button-row">
            <input id="a-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <button className="secondary" disabled={!name.trim() || name === campaign.name} onClick={() => run(async () => { await setField('campaigns', cid, 'name', name.trim()); report('Renamed.') })}>Rename</button>
          </div>
          <label className="check"><input type="checkbox" checked={campaign.settings.players_can_build} onChange={(e) => setSetting('players_can_build', e.target.checked)} /> Players can build their own characters</label>
          <label className="check"><input type="checkbox" checked={campaign.settings.players_see_sheets} onChange={(e) => setSetting('players_see_sheets', e.target.checked)} /> Players can see each other's sheets (read only)</label>
        </section>

        <section className="card stack">
          <h2>Join code and passcode</h2>
          <p>Join code <strong className="code">{campaign.join_code}</strong></p>
          <p className="small break">{joinLink(campaign.join_code)}</p>
          {confirm === 'rotate' ? (
            <div className="button-row">
              <button onClick={() => run(async () => { const { error } = await supabase.rpc('rotate_join_code', { p_campaign_id: cid }); if (error) throw error; setConfirm(null); report('New join code. Old links no longer let new devices join; devices already in stay in.') })}>Make a new code</button>
              <button className="secondary" onClick={() => setConfirm(null)}>Keep this one</button>
            </div>
          ) : <button className="secondary" onClick={() => setConfirm('rotate')}>New join code…</button>}
          <label htmlFor="a-pass" className="small">New GM passcode (4+ characters)</label>
          <div className="button-row">
            <input id="a-pass" type="password" autoComplete="new-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
            <button className="secondary" disabled={passcode.length < 4} onClick={() => run(async () => {
              const { error } = await supabase.rpc('set_gm_passcode', { p_campaign_id: cid, p_passcode: passcode })
              if (error) throw error
              setPasscode('')
              report('Passcode changed. Devices that are already GM stay GM.')
            })}>Change passcode</button>
          </div>
        </section>
      </div>

      <section className="card stack">
        <h2>Heroes</h2>
        <table className="data">
          <thead><tr><th>Hero</th><th>Devices</th><th>Build</th><th></th></tr></thead>
          <tbody>
            {characters.map((h) => {
              const holders = members.filter((m) => m.character_id === h.id).length
              return (
                <tr key={h.id}>
                  <td>{h.name}{h.is_npc && <span className="tag">NPC</span>}</td>
                  <td>{holders || '—'}{holders > 0 && <> <button className="link small" onClick={() => run(async () => { const { error } = await supabase.rpc('unclaim_character', { p_character_id: h.id }); if (error) throw error; report(`${h.name} is free to pick again.`) })}>unclaim</button></>}</td>
                  <td><label className="check small"><input type="checkbox" checked={h.locked} onChange={(e) => run(() => setField('characters', h.id, 'locked', e.target.checked))} /> locked</label></td>
                  <td className="small">
                    <label className="check"><input type="checkbox" checked={h.is_npc} onChange={(e) => run(() => setField('characters', h.id, 'is_npc', e.target.checked))} /> NPC</label>{' '}
                    {confirm === `del:${h.id}` ? (
                      <><button className="mini" onClick={() => run(async () => { await deleteRow('characters', h.id); setConfirm(null) })}>Delete {h.name} for good</button>{' '}
                        <button className="mini secondary" onClick={() => setConfirm(null)}>Keep</button></>
                    ) : <button className="link" onClick={() => setConfirm(`del:${h.id}`)}>delete</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="small muted">Locked: the player can still use their trackers, notes and Kit, but not change the build.</p>
      </section>

      <section className="card stack">
        <h2>Devices</h2>
        <table className="data">
          <thead><tr><th>Device</th><th>Role</th><th>Hero</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.display_name || `Device ${m.user_id.slice(0, 6)}`}{m.user_id === uid && <span className="tag">this device</span>}</td>
                <td>{m.role}</td>
                <td>{characters.find((c) => c.id === m.character_id)?.name ?? '—'}</td>
                <td>
                  {m.user_id !== uid && (confirm === `rm:${m.id}` ? (
                    <><button className="mini" onClick={() => run(async () => { await deleteRow('members', m.id); setConfirm(null); report('Removed. It can rejoin only with the join link (make a new code to stop that).') })}>Remove</button>{' '}
                      <button className="mini secondary" onClick={() => setConfirm(null)}>Keep</button></>
                  ) : <button className="link small" onClick={() => setConfirm(`rm:${m.id}`)}>remove</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ExportImport campaignId={cid} campaignName={campaign.name} run={run} report={report} />
      {toast}
    </>
  )
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ExportImport({ campaignId, campaignName, run, report }: {
  campaignId: string
  campaignName: string
  run: (fn: () => Promise<unknown>) => void
  report: (msg: string, warnings?: string[]) => void
}) {
  const { rows: imports, reload } = useLiveRows<ImportRow>('imports', campaignId, 'id, at, note, applied', { column: 'at', ascending: false })
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ patch: unknown; res: Resolution } | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const last = imports.find((i) => i.applied)

  const check = () => run(async () => {
    setPreview(null)
    setParseError(null)
    let patch: unknown
    try { patch = JSON.parse(text) } catch (e) { setParseError(`Not valid JSON: ${(e as Error).message}`); return }
    const data = await exportCampaign(supabase, campaignId)
    setPreview({ patch, res: resolvePatch(data, patch, campaignId) })
  })

  return (
    <section className="card stack">
      <h2>Export and import</h2>
      <div className="button-row">
        <button onClick={() => run(async () => {
          const data = await exportCampaign(supabase, campaignId)
          const day = new Date().toISOString().slice(0, 10)
          download(`${campaignName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${day}.json`, JSON.stringify(data, null, 2))
          report('Exported every table, hidden ones included. Keep the file private: it has the case file.')
        })}>Export campaign</button>
        <button className="secondary" onClick={() => run(async () => {
          const r = await sessionReport(supabase, campaignId)
          download(`session-report-night-${r.campaign.night}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(r, null, 2))
          report(`Session report for Night ${r.campaign.night}: ${r.rolls.length} rolls, ${r.helper_questions.length} helper questions.`,
            r.start_of_night ? [] : ['No start-of-Night snapshot for this Night, so the report holds every roll and has no start state.'])
        })}>Session report</button>
      </div>
      <p className="muted small">For Claude after a session: attach the export, get back a patch, import it here. The session report is the evidence for balance work (it includes your GM notes).</p>

      <h3>Import a patch</h3>
      <div className="button-row">
        <input type="file" accept="application/json,.json" aria-label="Patch file" onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void f.text().then((t) => { setText(t); setPreview(null) })
        }} />
      </div>
      <textarea className="code-area" rows={8} placeholder='{"format": "street-level-patch/1", "campaign": "…", "ops": [ … ]}'
        value={text} onChange={(e) => { setText(e.target.value); setPreview(null) }} aria-label="Patch JSON" spellCheck={false} />
      <div className="button-row"><button className="secondary" disabled={!text.trim()} onClick={check}>Check patch</button></div>
      {parseError && <p className="error small">{parseError}</p>}

      {preview && !preview.res.ok && (
        <div className="item stack">
          <p className="error"><strong>Refused.</strong> Nothing will be written.</p>
          <ul className="plain small">{preview.res.errors.map((e, i) => <li key={i} className="warn">⚠ {e}</li>)}</ul>
        </div>
      )}
      {preview?.res.ok && (
        <div className="item stack">
          <p><strong>{preview.res.note || 'Patch'}</strong>: {preview.res.lines.length} change{preview.res.lines.length === 1 ? '' : 's'}. Nothing is written until you press Apply.</p>
          <ol className="small preview">
            {preview.res.lines.map((l) => (
              <li key={l.n}>
                <strong>{l.kind === 'insert' ? `Add to ${l.table}` : `${l.table}: ${l.target}`}</strong>
                <ul className="plain">
                  {l.changes.map((c, i) => (
                    <li key={i}><code>{c.field}</code> {l.kind === 'insert' ? show(c.after) : <>{show(c.before)} → {show(c.after)}{c.how && c.how !== 'set' ? ` (${c.how})` : ''}</>}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <div className="button-row">
            <button onClick={() => run(async () => {
              await applyPatch(supabase, campaignId, preview.patch, preview.res)
              setPreview(null)
              setText('')
              reload()
              report('Imported. Every op was applied.')
            })}>Apply all</button>
            <button className="secondary" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}

      <h3>Recent imports</h3>
      {imports.length === 0 ? <p className="muted small">None yet.</p> : (
        <ul className="plain small">
          {imports.slice(0, 8).map((i) => (
            <li key={i.id}>
              {new Date(i.at).toLocaleString()} · {i.note || 'no note'} · {i.applied ? 'applied' : <span className="muted">undone</span>}
              {last?.id === i.id && <> · <button className="link" onClick={() => run(async () => { await undoImport(supabase, i.id); reload(); report('Undone. The old values are back.') })}>Undo last import</button></>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
