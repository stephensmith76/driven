import { useCallback, useEffect, useState } from 'react'
import { errorText } from '../../data/supabase'
import { useCharacters } from '../../data/hooks'
import {
  addHeroToCampaign, addVillainToCampaign, createBank, linkBank, loadBank, removeEntry, saveHero, saveVillainSheet, unlinkBank,
  type Bank as BankInfo, type BankEntry,
} from '../../data/bank'
import { listVillains, villainStatLine, type VillainData, type VillainSheet } from '../../data/villains'
import { VillainDetailsView } from '../../components/VillainDetailsView'
import { Portrait } from '../../components/Portrait'
import { useRunner } from '../../components/Toast'
import { archetype, trait } from '../../engine'
import { GmShell, type GmContext } from './GmShell'

export function Bank({ campaignId }: { campaignId: string }) {
  return <GmShell campaignId={campaignId} tab="bank">{(ctx) => <BankBody {...ctx} />}</GmShell>
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function heroLine(d: Record<string, unknown>) {
  const a = archetype((d.archetype_id as string | null) ?? null)?.name
  const t = trait((d.trait_id as string | null) ?? null)?.name
  return [a, t].filter(Boolean).join(' · ') || 'No archetype yet'
}

function enemyLine(d: Record<string, unknown>) {
  const v = d as unknown as VillainData
  return `${v.kind ?? 'enemy'} · ${villainStatLine(v.kind ?? 'villain', v)}`
}

function BankBody({ campaign }: GmContext) {
  const cid = campaign.id
  const { rows: characters } = useCharacters(cid)
  const [roster, setRoster] = useState<VillainSheet[]>([])
  const { run, report, toast } = useRunner()
  const [bank, setBank] = useState<BankInfo | null>(null)
  const [entries, setEntries] = useState<BankEntry[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', newPass: '', code: '', pass: '' })

  const reload = useCallback(async () => {
    try {
      const r = await loadBank(cid)
      setBank(r.bank); setEntries(r.entries); setState('ready')
      setRoster(await listVillains(cid).catch(() => []))
    } catch (e) {
      setProblem(errorText(e)); setState('error')
    }
  }, [cid])
  useEffect(() => { void reload() }, [reload])

  /** Run one bank action, then reload the lists. */
  const act = (fn: () => Promise<string | void>) => {
    setBusy(true)
    run(async () => {
      try {
        const msg = await fn()
        if (msg) report(msg)
      } finally {
        setBusy(false); setConfirm(null)
        await reload()
      }
    })
  }

  if (state === 'loading') return <p className="muted">Loading the bank…</p>
  if (state === 'error') {
    return (
      <section className="card stack">
        <h2>Bank</h2>
        <p className="warn">The bank could not be loaded: {problem}</p>
        <p className="small muted">If this is the first time, the database needs the bank migration applied (supabase db push).</p>
        {toast}
      </section>
    )
  }

  if (!bank) {
    return (
      <>
        <section className="card stack">
          <h2>Bank</h2>
          <p>A bank is a private store of heroes and villains that you can use in more than one campaign. Each campaign you link gets its own copy of whatever you add, so nothing you do here changes another table's game.</p>
        </section>
        <div className="gm-grid">
          <section className="card stack">
            <h2>Start a new bank</h2>
            <label htmlFor="b-name">Bank name</label>
            <input id="b-name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label htmlFor="b-newpass">Bank passcode (4 or more characters)</label>
            <input id="b-newpass" type="password" value={form.newPass} onChange={(e) => setForm({ ...form, newPass: e.target.value })} />
            <button disabled={busy || !form.name.trim() || form.newPass.length < 4}
              onClick={() => act(async () => { await createBank(cid, form.name, form.newPass); return 'Bank created and linked to this campaign.' })}>
              Create bank
            </button>
          </section>
          <section className="card stack">
            <h2>Use a bank you already have</h2>
            <label htmlFor="b-code">Bank code</label>
            <input id="b-code" value={form.code} maxLength={12} autoCapitalize="characters" onChange={(e) => setForm({ ...form, code: e.target.value })} />
            <label htmlFor="b-pass">Bank passcode</label>
            <input id="b-pass" type="password" value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} />
            <button disabled={busy || !form.code.trim() || !form.pass}
              onClick={() => act(async () => { await linkBank(cid, form.code, form.pass); return 'This campaign now uses that bank.' })}>
              Link bank
            </button>
          </section>
        </div>
        {toast}
      </>
    )
  }

  const heroes = entries.filter((x) => x.kind === 'hero')
  const foes = entries.filter((x) => x.kind === 'enemy')
  const inBank = (kind: 'hero' | 'enemy', name: string) => entries.some((x) => x.kind === kind && sameName(x.name, name))

  const entryRow = (x: BankEntry) => (
    <div key={x.id} className="item">
      <div className="portrait-picker">
        <Portrait value={x.portrait} name={x.name} size={48} />
        <div>
          <strong>{x.name}</strong>
          <p className="small muted">{x.kind === 'hero' ? heroLine(x.data) : enemyLine(x.data)}</p>
        </div>
      </div>
      {x.kind === 'enemy' && (
        <VillainDetailsView details={(x.data as unknown as VillainData).details}
          presence={(x.data as unknown as VillainData).kind === 'mooks' ? undefined : (x.data as unknown as VillainData).stats?.presence ?? 0} />
      )}
      <div className="button-row">
        <button className="mini" disabled={busy} onClick={() => act(async () => {
          if (x.kind === 'hero') { await addHeroToCampaign(cid, x); return `${x.name} added to ${campaign.name} as a new hero.` }
          await addVillainToCampaign(cid, x); return `${x.name} added to this campaign's Villains.`
        })}>Add to this campaign</button>
        <a className="button secondary mini-link" href={`#/gm/${cid}/bank/${x.kind === 'hero' ? 'hero' : 'villain'}/${x.id}`}>Edit</a>
        {confirm === x.id
          ? <>
              <button className="mini secondary" disabled={busy} onClick={() => act(async () => { await removeEntry(x); return `${x.name} removed from the bank.` })}>Yes, remove from the bank</button>
              <button className="mini secondary" onClick={() => setConfirm(null)}>Keep</button>
            </>
          : <button className="mini secondary" disabled={busy} onClick={() => setConfirm(x.id)}>Remove…</button>}
      </div>
    </div>
  )

  return (
    <>
      <section className="card stack">
        <h2>Bank: {bank.name}</h2>
        <p>Bank code <strong>{bank.code}</strong>. To use this bank in another campaign, open that campaign's Bank tab and enter this code and the bank's passcode.</p>
        <p className="small muted">Adding from the bank makes a separate copy in this campaign. Changes here never reach the bank until you save again.</p>
        <div className="button-row">
          {confirm === 'unlink'
            ? <>
                <button className="mini secondary" disabled={busy} onClick={() => act(async () => { await unlinkBank(cid); return 'This campaign no longer uses the bank. The bank itself is untouched.' })}>Yes, stop using this bank here</button>
                <button className="mini secondary" onClick={() => setConfirm(null)}>Keep</button>
              </>
            : <button className="mini secondary" onClick={() => setConfirm('unlink')}>Stop using this bank…</button>}
        </div>
        <div className="button-row">
          <a className="button" href={`#/gm/${cid}/bank/hero/new`}>Build a hero in the bank</a>
          <a className="button" href={`#/gm/${cid}/bank/villain/new`}>Build a villain in the bank</a>
        </div>
      </section>

      <div className="gm-grid">
        <section className="card stack">
          <h2>Heroes in the bank</h2>
          {heroes.length === 0 ? <p className="muted small">None yet. Save one from this campaign below.</p> : heroes.map(entryRow)}
        </section>
        <section className="card stack">
          <h2>Villains and enemies in the bank</h2>
          {foes.length === 0 ? <p className="muted small">None yet. Build one here, or save one from this campaign below.</p> : foes.map(entryRow)}
        </section>
      </div>

      <div className="gm-grid">
        <section className="card stack">
          <h2>Save heroes from this campaign</h2>
          {characters.length === 0 && <p className="muted small">This campaign has no heroes yet.</p>}
          {characters.map((h) => (
            <div key={h.id} className="item">
              <div className="portrait-picker">
                <Portrait value={h.portrait} name={h.name} size={40} />
                <div><strong>{h.name}</strong><p className="small muted">{heroLine(h as unknown as Record<string, unknown>)}</p></div>
              </div>
              <div className="button-row">
                <button className="mini secondary" disabled={busy} onClick={() => act(async () => {
                  const r = await saveHero(bank, entries, h)
                  return r === 'added' ? `${h.name} saved to the bank.` : `${h.name} updated in the bank.`
                })}>{inBank('hero', h.name) ? 'Update in the bank' : 'Save to the bank'}</button>
              </div>
            </div>
          ))}
          <p className="small muted">The build is saved: stats, Trait, archetype, Flairs, loadout, connections and picture. Harm, Stress, Drive and notes stay in this campaign.</p>
        </section>
        <section className="card stack">
          <h2>Save villains from this campaign</h2>
          {roster.length === 0 && <p className="muted small">This campaign has no built villains yet. <a href={`#/gm/${cid}/villains/new`}>Build one</a>.</p>}
          {roster.map((v) => (
            <div key={v.id} className="item">
              <div className="portrait-picker">
                <Portrait value={v.portrait} name={v.name} size={40} />
                <div><strong>{v.name}</strong><p className="small muted">{v.kind} · {villainStatLine(v.kind, v.data)}</p></div>
              </div>
              <div className="button-row">
                <button className="mini secondary" disabled={busy} onClick={() => act(async () => {
                  const r = await saveVillainSheet(bank, entries, v)
                  return r === 'added' ? `${v.name} saved to the bank.` : `${v.name} updated in the bank.`
                })}>{inBank('enemy', v.name) ? 'Update in the bank' : 'Save to the bank'}</button>
              </div>
            </div>
          ))}
          <p className="small muted">The whole sheet and picture are saved: stats, role, Trait lines, Tricks, Weakness, powers and notes.</p>
        </section>
      </div>
      {toast}
    </>
  )
}
