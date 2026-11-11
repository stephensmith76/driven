import { useCharacters, useLiveRows } from '../../data/hooks'
import { bump, setField } from '../../data/writes'
import { heroesOf } from '../../data/gm'
import type { Clock, Clue } from '../../data/types'
import { joinLink } from '../../router'
import { HeroTrackers } from '../../components/HeroTrackers'
import { RulesNotice } from '../../components/RulesNotice'
import { ClocksPanel } from '../../components/gm/ClocksPanel'
import { CluesPanel } from '../../components/gm/CluesPanel'
import { useRunner } from '../../components/Toast'
import { PHASE_NAMES, archetype, defenses, phases, type Phase } from '../../engine'
import { GmShell, type GmContext } from './GmShell'

/** GM home: Night and phase, the team clocks, a card per hero, found clues, and the join link. */
export function GmTable({ campaignId }: { campaignId: string }) {
  return <GmShell campaignId={campaignId} tab="">{(ctx) => <TableBody campaignId={campaignId} {...ctx} />}</GmShell>
}

function TableBody({ campaignId, campaign, members }: GmContext & { campaignId: string }) {
  const { rows: characters } = useCharacters(campaignId)
  const { rows: clocks } = useLiveRows<Clock>('clocks', campaignId, '*', { column: 'sort' })
  const { rows: clues } = useLiveRows<Clue>('clues', campaignId, '*', { column: 'night' })
  const { run, report, toast } = useRunner()
  const heroes = heroesOf(characters)
  const link = joinLink(campaign.join_code)

  return (
    <>
      <RulesNotice campaign={campaign} canAcknowledge />

      <section className="card button-row">
        <label className="small">Night{' '}
          <input type="number" min={1} value={campaign.night} style={{ width: '4.5rem' }}
            onChange={(e) => run(() => setField('campaigns', campaign.id, 'night', Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <label className="small">Phase{' '}
          <select value={campaign.phase} onChange={(e) => run(() => setField('campaigns', campaign.id, 'phase', e.target.value as Phase))}>
            {phases().map((p) => <option key={p} value={p}>{PHASE_NAMES[p]}</option>)}
          </select>
        </label>
        <a href={`#/gm/${campaignId}/night`}>Run the Night →</a>
        <span className="muted small">Join code <strong className="code">{campaign.join_code}</strong></span>
        <button className="mini secondary" onClick={() => { void navigator.clipboard?.writeText(link); report('Join link copied.') }}>Copy join link</button>
      </section>

      <div className="gm-grid">
        <section className="card stack">
          <h2>Clocks</h2>
          <ClocksPanel campaignId={campaignId} clocks={clocks} run={run} report={report} />
        </section>

        <section className="card stack">
          <h2>Found clues</h2>
          <CluesPanel campaignId={campaignId} clues={clues} heroes={heroes} night={campaign.night} run={run} />
        </section>
      </div>

      <section className="grid">
        {characters.map((h) => {
          const holders = members.filter((m) => m.character_id === h.id)
          const d = defenses(h)
          return (
            <article key={h.id} className="card stack">
              <h2>{h.name}{h.is_npc && <span className="tag">NPC</span>}{h.locked && <span className="tag">locked</span>}</h2>
              <p className="muted small">
                {archetype(h.archetype_id)?.name ?? '—'} · Guard {d.guard.total} / Wits {d.wits.total} / Poise {d.poise.total}
                {' · '}{holders.length ? `${holders.length} device${holders.length > 1 ? 's' : ''}` : 'unclaimed'}
              </p>
              <HeroTrackers hero={h} onChange={(f, v) => run(() => bump(h.id, f, v - h[f]))} />
              <div className="button-row small">
                <span>Home {h.home_clock}/6</span>
                <button className="mini secondary" onClick={() => run(() => bump(h.id, 'home_clock', 1))}>+1</button>
                <button className="mini secondary" onClick={() => run(() => bump(h.id, 'home_clock', -1))}>−1</button>
                <label className="check"><input type="checkbox" checked={h.dying} onChange={(e) => run(() => setField('characters', h.id, 'dying', e.target.checked))} /> Dying</label>
              </div>
              <p className="small">
                <a href={`#/c/${campaignId}/sheet/${h.id}`}>Open sheet</a>{' · '}
                <a href={`#/c/${campaignId}/build/${h.id}`}>Edit build</a>
              </p>
            </article>
          )
        })}
      </section>
      <p className="small"><a href={`#/c/${campaignId}/build`}>Add a hero</a> · {members.filter((m) => m.role === 'player').length} player device(s) joined</p>
      {toast}
    </>
  )
}
