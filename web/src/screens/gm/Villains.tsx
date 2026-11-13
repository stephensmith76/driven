import { useCallback, useEffect, useState } from 'react'
import { errorText } from '../../data/supabase'
import { addEnemy } from '../../data/fight'
import { deleteVillain, enemyDraft, listVillains, villainStatLine, type VillainSheet } from '../../data/villains'
import { Portrait } from '../../components/Portrait'
import { VillainDetailsView } from '../../components/VillainDetailsView'
import { useRunner } from '../../components/Toast'
import { GmShell, type GmContext } from './GmShell'

export function Villains({ campaignId }: { campaignId: string }) {
  return <GmShell campaignId={campaignId} tab="villains">{(ctx) => <VillainsBody {...ctx} />}</GmShell>
}

function VillainsBody({ campaign }: GmContext) {
  const cid = campaign.id
  const { run, report, toast } = useRunner()
  const [sheets, setSheets] = useState<VillainSheet[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [problem, setProblem] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try { setSheets(await listVillains(cid)); setState('ready') } catch (e) { setProblem(errorText(e)); setState('error') }
  }, [cid])
  useEffect(() => { void reload() }, [reload])

  if (state === 'loading') return <p className="muted">Loading villains…</p>
  if (state === 'error') {
    return (
      <section className="card stack">
        <h2>Villains</h2>
        <p className="warn">The villain roster could not be loaded: {problem}</p>
        <p className="small muted">If this is the first time, the database needs the villains migration applied (supabase db push).</p>
      </section>
    )
  }

  return (
    <>
      <section className="card stack">
        <h2>Villains</h2>
        <p>Villains you have built for this campaign. Build one here, then add it to a fight from this list or from the Fight screen.</p>
        <div className="button-row">
          <a className="button" href={`#/gm/${cid}/villains/new`}>Build a villain</a>
          <a className="button secondary" href={`#/c/${cid}/build`}>Build a hero</a>
          <a className="button secondary" href={`#/gm/${cid}/bank`}>Open the bank</a>
        </div>
      </section>

      {sheets.length === 0 && <p className="muted">No villains built yet. The Butcher, Voss, the Saints, cops and bruisers are always available on the Fight screen.</p>}

      <div className="gm-grid">
        {sheets.map((v) => (
          <article key={v.id} className="card stack">
            <div className="portrait-picker">
              <Portrait value={v.portrait} name={v.name} size={56} />
              <div>
                <h2>{v.name} <span className="tag">{v.kind}</span></h2>
                <p className="small muted">{villainStatLine(v.kind, v.data)}</p>
              </div>
            </div>
            <VillainDetailsView details={v.data.details} presence={v.kind === 'mooks' ? undefined : v.data.stats?.presence ?? 0} />
            <div className="button-row">
              <button className="mini" onClick={() => run(async () => { await addEnemy(cid, enemyDraft(v.name, v.data, v.portrait)); report(`${v.name} added to the Fight screen.`) })}>Add to the fight</button>
              <a className="button secondary mini-link" href={`#/gm/${cid}/villains/${v.id}`}>Edit</a>
              {confirm === v.id
                ? <>
                    <button className="mini secondary" onClick={() => run(async () => { await deleteVillain(v.id); setConfirm(null); await reload(); report(`${v.name} deleted from this campaign.`) })}>Yes, delete</button>
                    <button className="mini secondary" onClick={() => setConfirm(null)}>Keep</button>
                  </>
                : <button className="mini secondary" onClick={() => setConfirm(v.id)}>Delete…</button>}
            </div>
          </article>
        ))}
      </div>
      {toast}
    </>
  )
}
