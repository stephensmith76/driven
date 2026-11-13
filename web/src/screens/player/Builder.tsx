import { useEffect, useState } from 'react'
import { go } from '../../router'
import { errorText, supabase } from '../../data/supabase'
import { useCampaign, useCharacters, useMe } from '../../data/hooks'
import { updateColumns } from '../../data/writes'
import { loadBank, saveBankEntry } from '../../data/bank'
import { deletePortrait, uploadPortrait, viaRun } from '../../data/portraits'
import { PortraitPicker } from '../../components/Portrait'
import { useRunner } from '../../components/Toast'
import type { Character, Connections, LoadoutItem, Stats } from '../../data/types'
import {
  ARCHETYPES, CORE, FLAIRS, GEAR, POWERS, TRAITS,
  buildWarnings, gearItem, power, slotsUsed, startingDrive, type Sheet as SheetData,
} from '../../engine'

type Draft = {
  name: string
  civilian: string
  archetype_id: string | null
  trait_id: string | null
  stats: Stats
  flair_ids: string[]
  loadout: LoadoutItem[]
  extra_slots: number
  connections: Connections
}

const CONNECTION_FIELDS = [
  { key: 'protect', label: 'Someone you protect', hint: 'Your stake: a person you would take a hit for, or cannot afford to lose.' },
  { key: 'leverage', label: 'Someone with leverage over you', hint: "A debt, a secret, a boss, a cop, a promise. This is the GM's lever." },
  { key: 'place', label: "A place you're tied to", hint: 'A block, a bar, a rooftop, a grave.' },
  { key: 'mistake', label: 'A mistake that could come back', hint: 'An old case gone wrong, someone you failed.' },
] as const

const STAT_IDS = ['force', 'flow', 'focus', 'presence'] as const
const FLAW_KINDS = ['Allergy', 'Unstable', 'Marked'] as const
const sign = (n: number) => (n > 0 ? `+${n}` : String(n))

const blank = (): Draft => ({
  name: '', civilian: '', archetype_id: null, trait_id: null,
  stats: { force: 3, flow: 2, focus: 1, presence: 0 }, // the Balanced array, ready to adjust
  flair_ids: [], loadout: [], extra_slots: 0, connections: {},
})

const fromCharacter = (c: Character): Draft => ({
  name: c.name, civilian: c.civilian, archetype_id: c.archetype_id, trait_id: c.trait_id,
  stats: c.stats, flair_ids: c.flair_ids, loadout: c.loadout, extra_slots: c.extra_slots ?? 0,
  connections: c.connections ?? {},
})

/** Builder (new hero) and Advancement (edit an existing hero) on one screen. */
export function Builder({ campaignId, characterId }: { campaignId: string; characterId?: string }) {
  const { campaign } = useCampaign(campaignId)
  const { rows: characters, loading } = useCharacters(campaignId)
  const { member, role } = useMe(campaignId)
  const existing = characterId ? characters.find((c) => c.id === characterId) : undefined

  if (!campaign || !member || loading) return <main className="page"><p className="muted">Loading…</p></main>
  if (characterId && !existing) {
    return <main className="page"><p className="error">That hero wasn't found.</p><a href={`#/c/${campaignId}/sheet`}>Back</a></main>
  }
  return <BuilderForm key={existing?.id ?? 'new'} campaignId={campaignId} existing={existing}
    isGm={role === 'gm'} canBuild={campaign.settings.players_can_build} />
}

/** Where a hero built straight in the bank is saved. */
type BankTarget = { bankId: string; entryId: string; isNew: boolean; portrait: string | null }

/** Build or edit a hero in the bank this campaign is linked to (GM only: the database enforces it). */
export function BankHeroBuilder({ campaignId, entryId }: { campaignId: string; entryId?: string }) {
  const [loaded, setLoaded] = useState<{ target: BankTarget; initial: Draft } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const wanted = entryId && entryId !== 'new' ? entryId : undefined
  useEffect(() => {
    let cancelled = false
    loadBank(campaignId).then((b) => {
      if (cancelled) return
      if (!b.bank) { setProblem('This campaign is not linked to a bank yet. Open the Bank tab first.'); return }
      if (!wanted) { setLoaded({ target: { bankId: b.bank.id, entryId: crypto.randomUUID(), isNew: true, portrait: null }, initial: blank() }); return }
      const entry = b.entries.find((x) => x.id === wanted && x.kind === 'hero')
      if (!entry) { setProblem('That hero is no longer in the bank.'); return }
      setLoaded({
        target: { bankId: b.bank.id, entryId: entry.id, isNew: false, portrait: entry.portrait },
        initial: { ...blank(), ...(entry.data as Partial<Draft>), name: entry.name },
      })
    }).catch((e) => { if (!cancelled) setProblem(errorText(e)) })
    return () => { cancelled = true }
  }, [campaignId, wanted])
  if (problem) return <main className="page"><p className="error">{problem}</p><a href={`#/gm/${campaignId}/bank`}>Back to the bank</a></main>
  if (!loaded) return <main className="page"><p className="muted">Loading…</p></main>
  return <BuilderForm key={loaded.target.entryId} campaignId={campaignId} isGm canBuild bankTarget={loaded.target} initial={loaded.initial} />
}

function BuilderForm({ campaignId, existing, isGm, canBuild, bankTarget, initial }: {
  campaignId: string; existing?: Character; isGm: boolean; canBuild: boolean
  bankTarget?: BankTarget; initial?: Draft
}) {
  const [draft, setDraft] = useState<Draft>(initial ?? (existing ? fromCharacter(existing) : blank()))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [gearPick, setGearPick] = useState('')
  const [powerPick, setPowerPick] = useState('')
  const [portrait, setPortrait] = useState<string | null>(bankTarget?.portrait ?? null)
  const { run, toast } = useRunner()

  const creation = bankTarget ? bankTarget.isNew : !existing
  const lockedOut = Boolean(existing?.locked) && !isGm
  const noBuild = creation && !isGm && !canBuild
  const disabled = lockedOut || noBuild

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const sheet: SheetData = draft
  const slots = slotsUsed(sheet, { creation })
  const warnings = buildWarnings(sheet, { creation })
  const back = bankTarget ? `#/gm/${campaignId}/bank` : existing ? `#/c/${campaignId}/sheet/${existing.id}` : isGm ? `#/gm/${campaignId}` : `#/c/${campaignId}/sheet`
  const arch = ARCHETYPES.find((a) => a.id === draft.archetype_id)
  const trait = TRAITS.find((t) => t.id === draft.trait_id)

  const setItem = (i: number, patch: Partial<LoadoutItem>) =>
    set('loadout', draft.loadout.map((it, n) => (n === i ? { ...it, ...patch } : it)))
  const removeItem = (i: number) => set('loadout', draft.loadout.filter((_, n) => n !== i))
  const freeIdx = draft.loadout.findIndex((it) => it.kind === 'gear' && it.free)
  const setFreeWeapon = (id: string) => {
    const rest = draft.loadout.filter((it) => !(it.kind === 'gear' && it.free))
    set('loadout', id ? [{ kind: 'gear', id, free: true }, ...rest] : rest)
  }
  const addGear = () => { if (gearPick) { set('loadout', [...draft.loadout, { kind: 'gear', id: gearPick }]); setGearPick('') } }
  const addPower = () => {
    if (!powerPick) return
    const p = power(powerPick)
    const flaw = p?.required_flaw ? FLAW_KINDS.find((k) => k.toLowerCase() === p.required_flaw) : undefined
    set('loadout', [...draft.loadout, { kind: 'power', id: powerPick, ability_level: 1, ...(p?.tier === 'strange' && flaw ? { flaw } : {}) }])
    setPowerPick('')
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const row = {
        name: draft.name.trim() || 'New hero', civilian: draft.civilian.trim(),
        archetype_id: draft.archetype_id, trait_id: draft.trait_id, stats: draft.stats,
        flair_ids: draft.flair_ids, loadout: draft.loadout, extra_slots: draft.extra_slots,
        connections: Object.fromEntries(Object.entries(draft.connections).map(([k, v]) => [k, (v ?? '').trim()]).filter(([, v]) => v)),
      }
      if (bankTarget) {
        const { name, ...data } = row
        await saveBankEntry({ id: bankTarget.entryId, bank_id: bankTarget.bankId, kind: 'hero', name, data, portrait })
        go(`/gm/${campaignId}/bank`)
      } else if (existing) {
        const original = fromCharacter(existing)
        const changed: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(row)) {
          if (JSON.stringify(v) !== JSON.stringify((original as Record<string, unknown>)[k])) changed[k] = v
        }
        await updateColumns(existing.id, changed)
        go(`/c/${campaignId}/sheet/${existing.id}`)
      } else {
        // The id is made here so the insert needn't read the row back (a player may not be allowed to see it yet).
        const id = crypto.randomUUID()
        const { error: e1 } = await supabase.from('characters')
          .insert({ id, campaign_id: campaignId, ...row, drive: startingDrive(draft) })
        if (e1) throw e1
        if (!isGm) {
          const { error: e2 } = await supabase.rpc('claim_character', { p_character_id: id })
          if (e2) throw e2
          go(`/c/${campaignId}/sheet`)
        } else {
          go(`/c/${campaignId}/sheet/${id}`)
        }
      }
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <h1>{bankTarget ? (bankTarget.isNew ? 'New hero for the bank' : `Edit ${draft.name || 'hero'} in the bank`) : existing ? `Edit ${existing.name}` : 'New character'}</h1>
      {bankTarget && <p className="muted small">This hero is saved in the bank, not in a campaign. Add it to a campaign from the Bank tab.</p>}
      {existing && <p className="muted small">Advancement: when a case closes, each hero picks one: +1 to a stat, a new Flair, the next ability on a power, a new slot, or an Asset.</p>}
      {lockedOut && <p className="warn">The GM has locked this sheet's build.</p>}
      {noBuild && <p className="warn">This campaign doesn't let players build characters.</p>}

      <fieldset disabled={disabled} className="stack plain-fieldset">
        <section className="card stack">
          <h2>Who</h2>
          {bankTarget && (
            <PortraitPicker value={portrait} name={draft.name || 'Hero'} size={72}
              onPick={viaRun(run, async (file: File) => setPortrait(await uploadPortrait(bankTarget.bankId, `entry-${bankTarget.entryId}`, file)))}
              onRemove={viaRun(run, async () => { await deletePortrait(portrait); setPortrait(null) })} />
          )}
          <label htmlFor="b-name">Name</label>
          <input id="b-name" value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={60} />
          <label htmlFor="b-civ">Civilian identity</label>
          <input id="b-civ" value={draft.civilian} onChange={(e) => set('civilian', e.target.value)} maxLength={120} placeholder="Name and what they do by day" />
        </section>

        <section className="card stack">
          <h2>Connections</h2>
          <p className="muted small">Four ties to the world, one line each. They are what the GM can lean on and what you have to lose. At least one should link you to another hero.</p>
          {CONNECTION_FIELDS.map((f) => (
            <div key={f.key} className="stack">
              <label htmlFor={`b-conn-${f.key}`}>{f.label}</label>
              <input id={`b-conn-${f.key}`} value={draft.connections[f.key] ?? ''} maxLength={160} placeholder={f.hint}
                onChange={(e) => set('connections', { ...draft.connections, [f.key]: e.target.value })} />
            </div>
          ))}
        </section>

        <section className="card stack">
          <h2>Archetype</h2>
          <div className="stack">
            {ARCHETYPES.map((a) => (
              <label key={a.id} className={`pick ${draft.archetype_id === a.id ? 'on' : ''}`}>
                <input type="radio" name="arch" checked={draft.archetype_id === a.id} onChange={() => set('archetype_id', a.id)} />
                <span><strong>{a.name}.</strong> {a.text}</span>
              </label>
            ))}
          </div>
          {arch && (
            <p className="small muted">
              Drive: {arch.drive_trigger} Signature: {arch.signature.name}.
              {arch.id === 'specialist' && ' You get a utility belt: 3 belt slots for tools or light armor, filled on your sheet at the start of each Night. It sits outside your slots.'}
            </p>
          )}
        </section>

        <section className="card stack">
          <h2>Trait</h2>
          <label htmlFor="b-trait" className="muted small">Your strength and your weak spot.</label>
          <select id="b-trait" value={draft.trait_id ?? ''} onChange={(e) => set('trait_id', e.target.value || null)}>
            <option value="">Pick a Trait…</option>
            {TRAITS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {trait && (
            <ul className="plain small">
              <li><strong>Drive:</strong> {trait.drive_trigger}</li>
              <li><strong>Steady:</strong> {trait.steady}</li>
              <li><strong>Fraying:</strong> {trait.fraying} <em>Hook: {trait.hook}</em></li>
              <li><strong>Breaking:</strong> {trait.breaking}</li>
            </ul>
          )}
        </section>

        <section className="card stack">
          <h2>Stats</h2>
          <div className="chips">
            {CORE.stat_arrays.map((a) => (
              <button key={a.id} type="button" className="chip" onClick={() => set('stats', { force: a.values[0], flow: a.values[1], focus: a.values[2], presence: a.values[3] })}>
                {a.name}: {a.values.map(sign).join(' ')}
              </button>
            ))}
          </div>
          <p className="muted small">Pick an array, then assign its numbers to the four stats.</p>
          <div className="stat-grid">
            {STAT_IDS.map((s) => (
              <div key={s} className="stat">
                <label htmlFor={`b-${s}`} className="muted small">{CORE.stats.find((x) => x.id === s)!.name}</label>
                <select id={`b-${s}`} value={draft.stats[s]} onChange={(e) => set('stats', { ...draft.stats, [s]: Number(e.target.value) })}>
                  {Array.from({ length: CORE.stat_max - CORE.stat_min + 1 }, (_, i) => CORE.stat_max - i).map((v) => <option key={v} value={v}>{sign(v)}</option>)}
                </select>
              </div>
            ))}
          </div>
          <p className="small">
            Guard {CORE.defense_base + draft.stats.flow} · Wits {CORE.defense_base + draft.stats.focus} · Poise {CORE.defense_base + draft.stats.presence}
          </p>
        </section>

        <section className="card stack">
          <h2>Flair{!creation && 's'}</h2>
          <div className="stack">
            {FLAIRS.map((f) => (
              <label key={f.id} className={`pick ${draft.flair_ids.includes(f.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={draft.flair_ids.includes(f.id)}
                  onChange={(e) => set('flair_ids', e.target.checked ? [...draft.flair_ids, f.id] : draft.flair_ids.filter((x) => x !== f.id))} />
                <span><strong>{f.name}</strong>{f.trial && <span className="tag">trial</span>}. {f.text}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="card stack">
          <h2>Loadout <span className={slots.used > slots.max ? 'warn' : 'muted'}>{slots.used} of {slots.max} slots</span></h2>
          <p className="muted small">Gear and street powers cost 1 slot (powered armor costs 2); a strange power costs 2 and needs a flaw. Go over and you'll see a warning, but you can still save.</p>
          <label className="small" htmlFor="free-weapon">Free weapon (no slot). Everyone also carries a knife.</label>
          <select id="free-weapon" value={freeIdx >= 0 ? draft.loadout[freeIdx].id : ''} onChange={(e) => setFreeWeapon(e.target.value)}>
            <option value="">Just the knife</option>
            {GEAR.filter((g) => g.free_pick).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>

          {draft.loadout.map((it, i) => {
            if (it.kind === 'kit') return null
            if (it.kind === 'gear') {
              const g = gearItem(it.id)
              return (
                <div key={i} className="item">
                  <p><strong>{g?.name ?? it.id}</strong> <span className="muted small">{it.free ? 'free weapon' : `${g?.slots ?? 1} slot${(g?.slots ?? 1) > 1 ? 's' : ''}`}</span>{' '}
                    <button type="button" className="mini secondary" onClick={() => removeItem(i)}>Remove</button></p>
                  <p className="small">{g?.text ?? "Not in the rules data."}</p>
                  <input aria-label={`Note for ${g?.name ?? it.id}`} placeholder="Note (optional)" value={it.custom_text ?? ''} onChange={(e) => setItem(i, { custom_text: e.target.value })} />
                </div>
              )
            }
            const p = power(it.id)
            const strange = p?.tier === 'strange'
            const m = (it.flaw ?? '').match(/^\s*(allergy|unstable|marked)\b[:\s-]*(.*)$/i)
            const flawKind = m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : ''
            const flawDetail = m ? m[2] : it.flaw ?? ''
            const setFlaw = (k: string, detail: string) => setItem(i, { flaw: k ? (detail ? `${k}: ${detail}` : k) : detail || undefined })
            return (
              <div key={i} className="item">
                <p>
                  <strong>{p?.name ?? it.id}</strong> <span className="tag">{p?.tier ?? '?'}</span>{' '}
                  <span className="muted small">{p?.slots ?? 1} slot{(p?.slots ?? 1) > 1 ? 's' : ''}</span>{' '}
                  <button type="button" className="mini secondary" onClick={() => removeItem(i)}>Remove</button>
                </p>
                {p && <p className="small">{p.abilities[0].name}: {p.abilities[0].text}</p>}
                <label className="small" htmlFor={`src-${i}`}>{strange ? 'Cost (a weakness, a side effect, a price)' : 'Source (training, technology, a small gift)'}</label>
                <input id={`src-${i}`} value={it.custom_text ?? ''} onChange={(e) => setItem(i, { custom_text: e.target.value })} />
                {strange && (
                  <div className="button-row">
                    <select aria-label="Flaw" value={flawKind} onChange={(e) => setFlaw(e.target.value, flawDetail)}>
                      <option value="">Flaw…</option>
                      {FLAW_KINDS.map((k) => <option key={k}>{k}</option>)}
                    </select>
                    <input aria-label="Flaw detail" placeholder="What triggers it" value={flawDetail} onChange={(e) => setFlaw(flawKind, e.target.value)} />
                  </div>
                )}
                {!creation && p && (
                  <label className="small">Abilities unlocked{' '}
                    <select value={it.ability_level ?? 1} onChange={(e) => setItem(i, { ability_level: Number(e.target.value) })}>
                      {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )
          })}

          <div className="button-row">
            <select aria-label="Add gear" value={gearPick} onChange={(e) => setGearPick(e.target.value)}>
              <option value="">Add gear (1 slot each)…</option>
              {GEAR.filter((g) => !g.baseline).map((g) => <option key={g.id} value={g.id}>{g.name}{g.trial ? ' (trial)' : ''}</option>)}
            </select>
            <button type="button" className="secondary" disabled={!gearPick} onClick={addGear}>Add</button>
          </div>
          <div className="button-row">
            <select aria-label="Add power" value={powerPick} onChange={(e) => setPowerPick(e.target.value)}>
              <option value="">Add power…</option>
              <optgroup label="Street powers (1 slot)">
                {POWERS.filter((p) => p.tier === 'street').sort((x, y) => Number(Boolean(x.trial)) - Number(Boolean(y.trial))).map((p) => <option key={p.id} value={p.id}>{p.name}{p.trial ? ' (trial)' : ''}</option>)}
              </optgroup>
              <optgroup label="Strange powers (2 slots)">
                {POWERS.filter((p) => p.tier === 'strange').sort((x, y) => Number(Boolean(x.trial)) - Number(Boolean(y.trial))).map((p) => <option key={p.id} value={p.id}>{p.name}{p.trial ? ' (trial)' : ''}</option>)}
              </optgroup>
            </select>
            <button type="button" className="secondary" disabled={!powerPick} onClick={addPower}>Add</button>
          </div>

          {!creation && (
            <label className="small">Extra slots from Advancement{' '}
              <input type="number" min={0} max={10} value={draft.extra_slots}
                onChange={(e) => set('extra_slots', Math.max(0, Math.min(10, Number(e.target.value) || 0)))} style={{ width: '4.5rem' }} />
            </label>
          )}
        </section>
      </fieldset>

      {warnings.length > 0 && (
        <section className="card stack" aria-live="polite">
          <h2>Heads up</h2>
          <ul className="plain small">{warnings.map((w, i) => <li key={i} className="warn">⚠ {w}</li>)}</ul>
          <p className="muted small">These are warnings, not blocks. The rules are still changing, so you can save anyway.</p>
        </section>
      )}
      {error && <p className="error">{error}</p>}
      <div className="button-row">
        <button disabled={busy || disabled} onClick={save}>{bankTarget ? 'Save to the bank' : existing ? 'Save changes' : 'Create character'}</button>
        <a className="button secondary" href={back}>Cancel</a>
      </div>
      {toast}
    </main>
  )
}
