import { useEffect, useState } from 'react'
import { go } from '../../router'
import { errorText } from '../../data/supabase'
import { loadBank, saveBankEntry } from '../../data/bank'
import { blankVillainData, listVillains, namedDefenses, saveVillain, type VillainData } from '../../data/villains'
import { deletePortrait, enemyKey, uploadPortrait, viaRun } from '../../data/portraits'
import { PortraitPicker } from '../../components/Portrait'
import { useRunner } from '../../components/Toast'
import { CORE, CUSTOM_TRAIT_ID, POWERS, TRAITS, VILLAIN_TRAITS, VILLAINS, villainStress, type EnemyKind, type VillainDetails, type WeaponId } from '../../engine'
import { GmShell } from './GmShell'

type Loaded = { id: string; name: string; data: VillainData; portrait: string | null; isNew: boolean; bankId: string | null }

const ROLES = VILLAINS.roles.filter((r) => r.id !== 'mooks')
const NAMED_STATS = ['force', 'flow', 'focus', 'presence'] as const
const WEAPONS: { id: WeaponId; name: string }[] = [
  { id: 'unarmed', name: 'Fists' }, { id: 'light', name: 'Light melee' }, { id: 'heavy', name: 'Heavy melee' },
  { id: 'knife', name: 'Blade' }, { id: 'pistol', name: 'Gun' },
]
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n))
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Build or edit a villain sheet. In a campaign it is saved to that campaign's roster;
 * with `bank` it is saved straight to the bank the campaign is linked to.
 */
export function VillainBuilder({ campaignId, id, bank = false }: { campaignId: string; id?: string; bank?: boolean }) {
  return (
    <GmShell campaignId={campaignId} tab={bank ? 'bank' : 'villains'}>
      {() => <Loader campaignId={campaignId} id={id && id !== 'new' ? id : undefined} bank={bank} />}
    </GmShell>
  )
}

function Loader({ campaignId, id, bank }: { campaignId: string; id?: string; bank: boolean }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const back = bank ? `#/gm/${campaignId}/bank` : `#/gm/${campaignId}/villains`

  useEffect(() => {
    let cancelled = false
    const fresh = (bankId: string | null): Loaded =>
      ({ id: crypto.randomUUID(), name: '', data: blankVillainData('villain'), portrait: null, isNew: true, bankId })
    const load = async (): Promise<Loaded> => {
      if (bank) {
        const b = await loadBank(campaignId)
        if (!b.bank) throw new Error('This campaign is not linked to a bank yet. Open the Bank tab first.')
        if (!id) return fresh(b.bank.id)
        const entry = b.entries.find((x) => x.id === id && x.kind === 'enemy')
        if (!entry) throw new Error('That villain is no longer in the bank.')
        return { id: entry.id, name: entry.name, data: { ...blankVillainData('villain'), ...(entry.data as Partial<VillainData>) }, portrait: entry.portrait, isNew: false, bankId: b.bank.id }
      }
      if (!id) return fresh(null)
      const sheet = (await listVillains(campaignId)).find((v) => v.id === id)
      if (!sheet) throw new Error('That villain was not found in this campaign.')
      return { id: sheet.id, name: sheet.name, data: { ...blankVillainData(sheet.kind), ...sheet.data }, portrait: sheet.portrait, isNew: false, bankId: null }
    }
    load().then((l) => { if (!cancelled) setLoaded(l) }).catch((e) => { if (!cancelled) setProblem(errorText(e)) })
    return () => { cancelled = true }
  }, [campaignId, id, bank])

  if (problem) {
    return (
      <section className="card stack">
        <p className="warn">{problem}</p>
        <p className="small muted">If this is the first time, the database needs the villains migration applied (supabase db push).</p>
        <a href={back}>Back</a>
      </section>
    )
  }
  if (!loaded) return <p className="muted">Loading…</p>
  return <Form key={loaded.id} campaignId={campaignId} initial={loaded} back={back} />
}

function Form({ campaignId, initial, back }: { campaignId: string; initial: Loaded; back: string }) {
  const { run, toast } = useRunner()
  const [name, setName] = useState(initial.name)
  const [data, setData] = useState<VillainData>(initial.data)
  const [portrait, setPortrait] = useState(initial.portrait)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [powerPick, setPowerPick] = useState('')

  const details: VillainDetails = data.details ?? {}
  const named = data.kind !== 'mooks'
  const setDetails = (patch: Partial<VillainDetails>) => setData((d) => ({ ...d, details: { ...(d.details ?? {}), ...patch } }))
  const setStat = (k: string, v: number) => setData((d) => ({ ...d, stats: { ...d.stats, [k]: v } }))
  const setKind = (kind: EnemyKind) => setData((d) => {
    const next = blankVillainData(kind)
    const keepStats = (kind === 'mooks') === (d.kind === 'mooks')
    return { ...next, ...(keepStats ? { stats: d.stats, defenses: d.defenses, toughness: d.toughness, count_max: d.count_max } : {}), line: d.line, details: d.details }
  })
  const role = ROLES.find((r) => r.id === details.role)
  const heroTrait = TRAITS.find((t) => t.id === details.trait?.id)
  const villainTrait = VILLAIN_TRAITS.find((t) => t.id === details.trait?.id)
  const ownTrait = details.trait?.id === CUSTOM_TRAIT_ID
  /** Pick a Trait. A villain Trait fills in its two lines, unless the GM has written their own there. */
  const pickTrait = (traitId: string) => {
    const prev = details.trait ?? {}
    const was = VILLAIN_TRAITS.find((t) => t.id === prev.id)
    const next = VILLAIN_TRAITS.find((t) => t.id === traitId)
    const line = (k: 'fraying' | 'breaking') => {
      const cur = prev[k] ?? ''
      return !cur.trim() || cur === was?.[k] ? next?.[k] ?? '' : cur
    }
    const name = traitId === CUSTOM_TRAIT_ID ? '' : (next ?? TRAITS.find((t) => t.id === traitId))?.name
    setDetails({ trait: { id: traitId || undefined, name, fraying: line('fraying'), breaking: line('breaking') } })
  }
  const tricks = details.tricks ?? []
  const defs = named ? namedDefenses(data.stats) : data.defenses
  const stress = villainStress(data.kind)
  const pictureFolder = initial.bankId ?? campaignId
  const pictureKey = initial.bankId ? `entry-${initial.id}` : enemyKey(name)

  const num = (label: string, value: number, onChange: (n: number) => void, min = -1, max = 20) => (
    <label className="small">{label}{' '}
      <input type="number" value={value} min={min} max={max} style={{ width: '4.5rem' }}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
    </label>
  )

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const clean: VillainData = {
        ...data,
        defenses: named ? namedDefenses(data.stats) : data.defenses,
        count_max: named ? 1 : Math.max(1, data.count_max),
        drive: named ? data.drive : 0,
        details: { ...details, tricks: tricks.filter((k) => k.text.trim()) },
      }
      const finalName = name.trim() || (named ? 'Unnamed villain' : 'Mooks')
      if (initial.bankId) await saveBankEntry({ id: initial.id, bank_id: initial.bankId, kind: 'enemy', name: finalName, data: clean, portrait })
      else await saveVillain({ id: initial.id, campaign_id: campaignId, name: finalName, kind: clean.kind, data: clean, portrait })
      go(back.replace(/^#/, ''))
    } catch (e) {
      setError(errorText(e)); setBusy(false)
    }
  }

  return (
    <>
      <section className="card stack">
        <h2>{initial.isNew ? 'New villain' : `Edit ${initial.name}`}{initial.bankId && <span className="tag">in the bank</span>}</h2>
        <p className="muted small">A villain uses the same stats, defenses and Drive prices as a hero, in a shorter sheet. Nothing here is enforced: the numbers are yours to set.</p>
        <label htmlFor="v-name">Name</label>
        <input id="v-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="v-concept">Who they are, in a line</label>
        <input id="v-concept" value={details.concept ?? ''} maxLength={200} placeholder="A protection racket boss who used to be a butcher"
          onChange={(e) => setDetails({ concept: e.target.value })} />
        <PortraitPicker value={portrait} name={name || 'Villain'} size={72}
          onPick={viaRun(run, async (file: File) => {
            if (!initial.bankId && !name.trim()) throw new Error('Give the villain a name first: the picture is stored under it.')
            setPortrait(await uploadPortrait(pictureFolder, pictureKey, file))
          })}
          onRemove={viaRun(run, async () => { await deletePortrait(portrait); setPortrait(null) })} />
      </section>

      <section className="card stack">
        <h2>Kind and role</h2>
        <div className="chips">
          {(['villain', 'lieutenant', 'mooks'] as EnemyKind[]).map((k) => (
            <button key={k} type="button" className={`chip ${data.kind === k ? 'on' : ''}`} aria-pressed={data.kind === k} onClick={() => setKind(k)}>
              {k === 'villain' ? 'Case villain' : k === 'lieutenant' ? 'Lieutenant' : 'Mook group'}
            </button>
          ))}
        </div>
        <p className="muted small">
          {data.kind === 'villain' && `A case's main villain: ${CORE.harm.villain_boxes} Harm (${CORE.harm.small_villain_boxes} for a smaller one), ${stress.max} Stress, one turn per two heroes.`}
          {data.kind === 'lieutenant' && `A lieutenant: ${CORE.harm.lieutenant_boxes} Harm, ${stress.max} Stress, one turn a round.`}
          {data.kind === 'mooks' && 'A mook group: one attack per group per turn, with Edge if the whole group is standing. Use 2 Harm each for bruisers.'}
        </p>
        {named && (
          <>
            <label htmlFor="v-role">Role</label>
            <select id="v-role" value={details.role ?? ''} onChange={(e) => setDetails({ role: e.target.value || undefined })}>
              <option value="">No role</option>
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {role && <p className="muted small">Earns Drive when: {role.drive_trigger}. Typical Trick: {role.trick}</p>}
          </>
        )}
      </section>

      <section className="card stack">
        <h2>Numbers</h2>
        {named ? (
          <>
            <div className="button-row">{NAMED_STATS.map((s) => <span key={s}>{num(cap(s), data.stats[s] ?? 0, (n) => setStat(s, n), -1, 6)}</span>)}</div>
            <p className="small">Guard {defs.guard} · Wits {defs.wits} · Poise {defs.poise} <span className="muted">(12 + Flow, Focus, Presence)</span></p>
            <div className="button-row">
              {num('Harm boxes', data.harm_max, (n) => setData({ ...data, harm_max: n }), 1, 20)}
              {num('Toughness', data.toughness, (n) => setData({ ...data, toughness: n }), 0, CORE.toughness.max)}
              {num('Starting Drive', data.drive, (n) => setData({ ...data, drive: n }), 0, CORE.drive.max)}
            </div>
            <p className="muted small">Stress: {stress.max} boxes (Fraying at {stress.fraying}, Breaking at {stress.breaking}). If they have Toughness, make sure the heroes have a way past it.</p>
            <label htmlFor="v-weapon">Weapon</label>
            <select id="v-weapon" value={details.weapon ?? 'unarmed'} onChange={(e) => setDetails({ weapon: e.target.value as WeaponId })}>
              {WEAPONS.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </>
        ) : (
          <>
            <div className="button-row">
              {num('Attack', data.stats.attack ?? 2, (n) => setStat('attack', n), -1, 6)}
              {num('Guard', data.defenses.guard ?? 13, (n) => setData({ ...data, defenses: { ...data.defenses, guard: n } }), 8, 20)}
              {num('Wits', data.defenses.wits ?? 12, (n) => setData({ ...data, defenses: { ...data.defenses, wits: n } }), 8, 20)}
              {num('Poise', data.defenses.poise ?? 12, (n) => setData({ ...data, defenses: { ...data.defenses, poise: n } }), 8, 20)}
            </div>
            <div className="button-row">
              {num('In the group', data.count_max, (n) => setData({ ...data, count_max: n }), 1, 12)}
              {num('Harm each', data.harm_max, (n) => setData({ ...data, harm_max: n }), 1, 3)}
              <label className="check small"><input type="checkbox" checked={Boolean(details.gunner)} onChange={(e) => setDetails({ gunner: e.target.checked })} /> One carries a gun</label>
            </div>
          </>
        )}
      </section>

      {named && (
        <section className="card stack">
          <h2>Trait</h2>
          <p className="muted small">A villain's Trait is two lines: what they do when Fraying, and what they do when they Break. Fraying should give the heroes an opening; Breaking should be reckless.</p>
          <label htmlFor="v-trait">Trait</label>
          <select id="v-trait" value={details.trait?.id ?? ''} onChange={(e) => pickTrait(e.target.value)}>
            <option value="">Pick one</option>
            <optgroup label="Villain Traits">
              {VILLAIN_TRAITS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
            <optgroup label="Hero Traits">
              {TRAITS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
            <option value={CUSTOM_TRAIT_ID}>Write your own…</option>
          </select>
          {villainTrait && <p className="muted small">{villainTrait.text}</p>}
          {ownTrait && (
            <>
              <label htmlFor="v-trait-name">Trait name</label>
              <input id="v-trait-name" value={details.trait?.name ?? ''} maxLength={40} placeholder="Devotion"
                onChange={(e) => setDetails({ trait: { ...(details.trait ?? {}), name: e.target.value } })} />
            </>
          )}
          <label htmlFor="v-fray">Fraying</label>
          <input id="v-fray" value={details.trait?.fraying ?? ''} maxLength={240} placeholder={heroTrait ? `For heroes: ${heroTrait.hook}` : 'Goes after whoever hurt him last, plan or no plan.'}
            onChange={(e) => setDetails({ trait: { ...(details.trait ?? {}), fraying: e.target.value } })} />
          <label htmlFor="v-break">Breaking</label>
          <input id="v-break" value={details.trait?.breaking ?? ''} maxLength={240} placeholder={heroTrait ? `For heroes: ${heroTrait.breaking}` : 'Wrecks everything in reach, his own men included.'}
            onChange={(e) => setDetails({ trait: { ...(details.trait ?? {}), breaking: e.target.value } })} />
        </section>
      )}

      {named && (
        <section className="card stack">
          <h2>Drive, Tricks and Weakness</h2>
          <label htmlFor="v-drive">Earns Drive when</label>
          <input id="v-drive" value={details.drive_trigger ?? ''} maxLength={200} placeholder={role?.drive_trigger ?? 'From their role'}
            onChange={(e) => setDetails({ drive_trigger: e.target.value })} />
          <p className="small"><strong>Tricks</strong> <span className="muted">(special moves that cost Drive)</span></p>
          {tricks.map((k, i) => (
            <div key={i} className="button-row">
              {num('Drive', k.cost, (n) => setDetails({ tricks: tricks.map((x, j) => (j === i ? { ...x, cost: n } : x)) }), 1, 6)}
              <input aria-label={`Trick ${i + 1}`} value={k.text} maxLength={240} style={{ flex: 1, minWidth: '12rem' }} placeholder={role?.trick ?? 'Human shield. Redirect a hit to a hostage in his zone.'}
                onChange={(e) => setDetails({ tricks: tricks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              <button type="button" className="mini secondary" onClick={() => setDetails({ tricks: tricks.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div><button type="button" className="mini secondary" onClick={() => setDetails({ tricks: [...tricks, { cost: 2, text: '' }] })}>Add a Trick</button></div>
          <label htmlFor="v-threat">Presence attack: what they say</label>
          <input id="v-threat" value={details.threat ?? ''} maxLength={160} placeholder="I know where you sleep."
            onChange={(e) => setDetails({ threat: e.target.value })} />
          <p className="muted small">Free, once per round: {signed(data.stats.presence ?? 0)} vs Poise, 1 Stress per Impact.</p>
          <label htmlFor="v-weak">Weakness</label>
          <input id="v-weak" value={details.weakness ?? ''} maxLength={240} placeholder="Can't turn down a challenge in front of his crew."
            onChange={(e) => setDetails({ weakness: e.target.value })} />
        </section>
      )}

      <section className="card stack">
        <h2>Powers and notes</h2>
        {named && (
          <>
            {(details.powers ?? []).map((pid) => {
              const p = POWERS.find((x) => x.id === pid)
              return (
                <div key={pid} className="button-row">
                  <span><strong>{p?.name ?? pid}</strong> <span className="muted small">{p?.tier}</span></span>
                  <button type="button" className="mini secondary" onClick={() => setDetails({ powers: (details.powers ?? []).filter((x) => x !== pid) })}>Remove</button>
                </div>
              )
            })}
            <div className="button-row">
              <select aria-label="Power" value={powerPick} onChange={(e) => setPowerPick(e.target.value)}>
                <option value="">Add a power…</option>
                {POWERS.filter((p) => !(details.powers ?? []).includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.tier})</option>)}
              </select>
              <button type="button" className="mini secondary" disabled={!powerPick}
                onClick={() => { setDetails({ powers: [...(details.powers ?? []), powerPick] }); setPowerPick('') }}>Add</button>
            </div>
            <p className="muted small">Villains get every ability of a power. Villain-only powers (Flight, Invisibility, Telekinesis and the like) go in the notes.</p>
          </>
        )}
        <label htmlFor="v-line">One-line note for the Fight screen</label>
        <input id="v-line" value={data.line} maxLength={200} onChange={(e) => setData({ ...data, line: e.target.value })} />
        <label htmlFor="v-notes">Notes</label>
        <textarea id="v-notes" rows={4} value={details.notes ?? ''} onChange={(e) => setDetails({ notes: e.target.value })} />
      </section>

      {error && <p className="error">{error}</p>}
      <div className="button-row">
        <button disabled={busy} onClick={() => { void save() }}>{initial.isNew ? 'Save villain' : 'Save changes'}</button>
        <a className="button secondary" href={back}>Cancel</a>
      </div>
      {toast}
    </>
  )
}
