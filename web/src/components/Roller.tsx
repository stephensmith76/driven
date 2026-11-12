import { useMemo, useState } from 'react'
import { bump } from '../data/writes'
import { hitEnemy, hitHero, setEnemyField } from '../data/fight'
import { logRoll } from '../data/rolls'
import type { Character } from '../data/types'
import {
  CORE, OBSTACLE_RATINGS, defenses, diceNeeded, evaluate, harm, impactBand, obstacleDefense, parseDice,
  rollDice, rollRow, setupAdv, simHero, toughness, upgrade, villainStress,
  type Enemy, type RollRowData, type RollSetup, type WeaponId,
} from '../engine'

export type Run = (fn: () => Promise<unknown>) => void
export type Report = (message: string, warnings?: string[]) => void

type Actor = {
  key: string
  name: string
  characterId: string | null
  hero?: Character
  enemy?: Enemy
  bonuses: { id: string; label: string; value: number }[]
}

const STAT_IDS = ['force', 'flow', 'focus', 'presence'] as const
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
const DEFENSE_FOR_STAT: Record<string, 'guard' | 'wits' | 'poise'> = { force: 'guard', flow: 'guard', focus: 'wits', presence: 'poise' }

function actorsFor(heroes: Character[], enemies: Enemy[]): Actor[] {
  const out: Actor[] = heroes.map((h) => ({
    key: `h:${h.id}`, name: h.name, characterId: h.id, hero: h,
    bonuses: STAT_IDS.map((s) => ({ id: s, label: CORE.stats.find((x) => x.id === s)!.name, value: h.stats[s] })),
  }))
  for (const e of enemies) {
    const bonuses = e.kind === 'mooks'
      ? [{ id: 'attack', label: 'Attack', value: e.stats.attack ?? 0 }]
      : STAT_IDS.map((s) => ({ id: s, label: CORE.stats.find((x) => x.id === s)!.name, value: e.stats[s] ?? 0 }))
    out.push({ key: `e:${e.id}`, name: e.name, characterId: null, enemy: e, bonuses })
  }
  return out
}

type Done = {
  row: RollRowData
  setup: RollSetup
  actor: Actor
  impact: number
  upgraded: boolean
  attack: { type: 'harm' | 'stress'; weapon: WeaponId; toughness: number; extra: number; fromMook: boolean } | null
  target: { kind: 'hero' | 'enemy'; id: string } | null
  applied: string[] | null
  working: ReturnType<typeof evaluate>
}

/**
 * The one roll form (SPEC.md "Dice roller and roll log"): who, what, modifiers, against,
 * dice. The app rolls or you type what real dice showed; the math is the same either way.
 * A player's own hero is fixed. The GM picks any hero or enemy and can Apply the result.
 */
export function Roller({ campaignId, heroes, enemies = [], myHeroId, isGm, initialStat, run, report }: {
  campaignId: string
  heroes: Character[]
  enemies?: Enemy[]
  /** A player's own hero: the actor is fixed to it. */
  myHeroId?: string | null
  isGm: boolean
  initialStat?: string
  run: Run
  report: Report
}) {
  const actors = useMemo(() => {
    const list = actorsFor(heroes, isGm ? enemies : [])
    return isGm ? list : list.filter((a) => a.characterId === myHeroId)
  }, [heroes, enemies, isGm, myHeroId])

  const [actorKey, setActorKey] = useState(() => (myHeroId ? `h:${myHeroId}` : ''))
  const actor = actors.find((a) => a.key === actorKey) ?? actors[0]

  const [statId, setStatId] = useState<string>(initialStat ?? '')
  const [customBonus, setCustomBonus] = useState(0)
  const [label, setLabel] = useState('')
  const [edgeMode, setEdgeMode] = useState<'none' | 'free' | 'drive'>('none')
  const [advantage, setAdvantage] = useState(false)
  const [disadvantage, setDisadvantage] = useState(false)
  const [jab, setJab] = useState(false)

  const [againstKind, setAgainstKind] = useState<'enemy' | 'hero' | 'obstacle' | 'number'>(isGm ? 'enemy' : 'obstacle')
  const [enemyId, setEnemyId] = useState('')
  const [heroTargetId, setHeroTargetId] = useState('')
  const [defKind, setDefKind] = useState<'guard' | 'wits' | 'poise'>('guard')
  const [rating, setRating] = useState(1)
  const [typedDefense, setTypedDefense] = useState('12')

  const [attack, setAttack] = useState(false)
  const [attackType, setAttackType] = useState<'harm' | 'stress'>('harm')
  const [weapon, setWeapon] = useState<WeaponId | ''>('')
  const [extraHarm, setExtraHarm] = useState(0)
  const [toughOverride, setToughOverride] = useState('')

  const [diceMode, setDiceMode] = useState<'app' | 'manual'>('app')
  const [typed, setTyped] = useState<string[]>(['', '', ''])
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)

  if (!actor) return <p className="muted small">Pick a hero first.</p>

  const bonusOptions = actor.bonuses
  const stat = bonusOptions.find((b) => b.id === statId) ?? (statId === 'custom' ? null : bonusOptions[0])
  const bonus = stat ? stat.value : customBonus
  const statName = stat ? stat.id : null

  const enemy = enemies.find((e) => e.id === (enemyId || enemies[0]?.id))
  const targetHero = heroes.find((h) => h.id === (heroTargetId || heroes[0]?.id))
  const kind = againstKind === 'enemy' && !enemy ? 'number' : againstKind
  const defaultDef = DEFENSE_FOR_STAT[statName ?? ''] ?? defKind

  let defense = Number(typedDefense) || 0
  let againstText = `${defense}`
  if (kind === 'enemy' && enemy) {
    defense = enemy.defenses[defKind] ?? CORE.defense_base
    againstText = `${enemy.name}'s ${defKind} ${defense}`
  } else if (kind === 'hero' && targetHero) {
    defense = defenses(targetHero)[defKind].total
    againstText = `${targetHero.name}'s ${defKind} ${defense}`
  } else if (kind === 'obstacle') {
    defense = obstacleDefense(rating)
    againstText = `obstacle ${signed(rating)} (12 ${signed(rating)})`
  }

  const defaultWeapon: WeaponId = actor.hero ? (simHero(actor.hero).weapon as WeaponId) : 'unarmed'
  const weaponId = (weapon || defaultWeapon) as WeaponId
  const weaponDef = CORE.weapons.find((w) => w.id === weaponId)
  const attackKind = (weaponDef?.attack_kind ?? 'blunt') as 'blunt' | 'blade' | 'gun' | 'hazard'
  // A Jab with light melee has no -2 (rules.md, Your turn).
  const lightJab = jab && attack && attackType === 'harm' && weaponId === 'light'
  const setup: RollSetup = { bonus, edge: edgeMode !== 'none', advantage, disadvantage, jab, lightJab, defense }
  const need = diceNeeded(setup)
  const adv = setupAdv(setup)
  const targetEnemy = kind === 'enemy' ? enemy : undefined
  const targetHeroForHit = kind === 'hero' ? targetHero : undefined
  const autoToughness = targetHeroForHit
    ? toughness(targetHeroForHit, attackKind, {
      active: Object.keys(targetHeroForHit.fight_state).filter((k) => k.startsWith('active:') && targetHeroForHit.fight_state[k]).map((k) => k.slice(7)),
    }).value
    : attackKind === 'gun' ? 0 : targetEnemy?.toughness ?? 0 // enemy Toughness is innate; set it by hand for an armored enemy
  const toughNow = toughOverride === '' ? autoToughness : Number(toughOverride) || 0

  const go = () => run(async () => {
    setProblem(null)
    let dice: number[]
    if (diceMode === 'app') dice = rollDice(adv)
    else {
      const parsed = parseDice(typed.slice(0, need))
      if (parsed.some((d) => d == null)) { setProblem(`Type all ${need} dice.`); return }
      dice = parsed as number[]
    }
    const working = evaluate(setup, dice)
    if (working.errors.length) { setProblem(working.errors.join(' ')); return }

    const warnings: string[] = []
    if (edgeMode === 'drive' && actor.hero) {
      if (actor.hero.drive < 1) warnings.push(`Edge costs 1 Drive; ${actor.name} has ${actor.hero.drive}. Fix the tracker if the table says otherwise.`)
      await bump(actor.hero.id, 'drive', -1)
    }
    const row = rollRow({
      actorName: actor.name, characterId: actor.characterId, label: label || `${stat?.label ?? 'Roll'} vs ${againstText}`,
      stat: statName, setup, result: working, mode: diceMode,
      note: edgeMode === 'drive' ? 'Edge (1 Drive)' : '',
    })
    await logRoll(campaignId, row)
    setDone({
      row, setup, actor, impact: working.impact, upgraded: false, working,
      attack: attack ? { type: attackType, weapon: weaponId, toughness: toughNow, extra: extraHarm, fromMook: actor.enemy?.kind === 'mooks' } : null,
      target: targetEnemy ? { kind: 'enemy', id: targetEnemy.id } : targetHeroForHit ? { kind: 'hero', id: targetHeroForHit.id } : null,
      applied: null,
    })
    setTyped(['', '', ''])
    if (warnings.length) report('Rolled.', warnings)
  })

  return (
    <div className="stack roller">
      {isGm && actors.length > 1 && (
        <label className="stack small">Who rolls
          <select value={actor.key} onChange={(e) => { setActorKey(e.target.value); setStatId(''); setDone(null) }}>
            {actors.map((a) => <option key={a.key} value={a.key}>{a.name}{a.enemy ? ' (enemy)' : ''}</option>)}
          </select>
        </label>
      )}
      {!isGm && <p className="small"><strong>{actor.name}</strong> rolls</p>}

      <div className="button-row">
        <label className="small stack">What
          <select value={stat ? stat.id : 'custom'} onChange={(e) => {
            setStatId(e.target.value)
            const d = DEFENSE_FOR_STAT[e.target.value]
            if (d) setDefKind(d)
          }}>
            {bonusOptions.map((b) => <option key={b.id} value={b.id}>{b.label} {signed(b.value)}</option>)}
            <option value="custom">Typed bonus</option>
          </select>
        </label>
        {!stat && (
          <label className="small stack">Bonus
            <input type="number" value={customBonus} onChange={(e) => setCustomBonus(Number(e.target.value) || 0)} style={{ width: '5rem' }} />
          </label>
        )}
        <label className="small stack grow">Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Haymaker on the Butcher" maxLength={80} />
        </label>
      </div>

      <fieldset className="plain-fieldset stack">
        <legend className="small"><strong>Modifiers</strong></legend>
        <div className="chips">
          <button type="button" className={`chip ${edgeMode === 'free' ? 'on' : ''}`} aria-pressed={edgeMode === 'free'}
            onClick={() => setEdgeMode(edgeMode === 'free' ? 'none' : 'free')}>Edge (free)</button>
          {actor.hero && (
            <button type="button" className={`chip ${edgeMode === 'drive' ? 'on' : ''}`} aria-pressed={edgeMode === 'drive'}
              onClick={() => setEdgeMode(edgeMode === 'drive' ? 'none' : 'drive')}>Edge (spend 1 Drive)</button>
          )}
          <button type="button" className={`chip ${advantage ? 'on' : ''}`} aria-pressed={advantage} onClick={() => setAdvantage(!advantage)}>Advantage</button>
          <button type="button" className={`chip ${disadvantage ? 'on' : ''}`} aria-pressed={disadvantage} onClick={() => setDisadvantage(!disadvantage)}>Disadvantage</button>
          <button type="button" className={`chip ${jab ? 'on' : ''}`} aria-pressed={jab} onClick={() => setJab(!jab)}>{lightJab ? 'Jab (light melee, no penalty)' : 'Jab (-2)'}</button>
        </div>
        {advantage && disadvantage && <p className="small muted">Advantage and Disadvantage cancel: two dice, neither applies.</p>}
        {adv !== 0 && <p className="small muted">{adv > 0 ? 'Advantage' : 'Disadvantage'}: roll three dice and keep the {adv > 0 ? 'best' : 'worst'} two.</p>}
      </fieldset>

      <fieldset className="plain-fieldset stack">
        <legend className="small"><strong>Against</strong></legend>
        <div className="button-row">
          <select aria-label="Against" value={kind} onChange={(e) => setAgainstKind(e.target.value as typeof againstKind)}>
            {isGm && <option value="enemy">An enemy</option>}
            <option value="hero">A hero</option>
            <option value="obstacle">An obstacle</option>
            <option value="number">A number</option>
          </select>
          {kind === 'enemy' && (
            <select aria-label="Enemy" value={enemy?.id ?? ''} onChange={(e) => setEnemyId(e.target.value)}>
              {enemies.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          {kind === 'hero' && (
            <select aria-label="Hero" value={targetHero?.id ?? ''} onChange={(e) => setHeroTargetId(e.target.value)}>
              {heroes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          )}
          {(kind === 'enemy' || kind === 'hero') && (
            <select aria-label="Defense" value={defKind} onChange={(e) => setDefKind(e.target.value as typeof defKind)}>
              <option value="guard">Guard</option><option value="wits">Wits</option><option value="poise">Poise</option>
            </select>
          )}
          {kind === 'obstacle' && (
            <select aria-label="Obstacle rating" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
              {OBSTACLE_RATINGS.map((r) => <option key={r} value={r}>Rating {signed(r)} (defense {obstacleDefense(r)})</option>)}
            </select>
          )}
          {kind === 'number' && (
            <input type="number" aria-label="Defense number" value={typedDefense} onChange={(e) => setTypedDefense(e.target.value)} style={{ width: '5rem' }} />
          )}
        </div>
        <p className="small muted">Defense to beat: <strong>{defense}</strong> ({againstText}). {defaultDef !== defKind && kind !== 'obstacle' && kind !== 'number' ? `${statName} usually goes against ${defaultDef}.` : ''}</p>
      </fieldset>

      <details open={attack}>
        <summary onClick={(e) => { e.preventDefault(); setAttack(!attack) }}>{attack ? 'This is an attack (tap to turn off)' : 'This is an attack?'}</summary>
        {attack && (
          <div className="stack">
            <div className="button-row">
              <select aria-label="Attack type" value={attackType} onChange={(e) => setAttackType(e.target.value as typeof attackType)}>
                <option value="harm">Deals Harm</option>
                <option value="stress">Presence attack: deals Stress</option>
              </select>
              {attackType === 'harm' && (
                <>
                  <select aria-label="Weapon" value={weaponId} onChange={(e) => setWeapon(e.target.value as WeaponId)}>
                    {CORE.weapons.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <label className="small">Extra Harm{' '}
                    <input type="number" min={0} value={extraHarm} onChange={(e) => setExtraHarm(Number(e.target.value) || 0)} style={{ width: '4.5rem' }} />
                  </label>
                  <label className="small">Toughness{' '}
                    <input type="number" min={0} max={2} value={toughOverride === '' ? autoToughness : toughOverride}
                      onChange={(e) => setToughOverride(e.target.value)} style={{ width: '4.5rem' }} />
                  </label>
                </>
              )}
            </div>
            {attackType === 'harm' && weaponDef && <p className="small muted">{weaponDef.text}</p>}
          </div>
        )}
      </details>

      <fieldset className="plain-fieldset stack">
        <legend className="small"><strong>Dice</strong></legend>
        <div className="chips">
          <button type="button" className={`chip ${diceMode === 'app' ? 'on' : ''}`} aria-pressed={diceMode === 'app'} onClick={() => setDiceMode('app')}>Roll for me</button>
          <button type="button" className={`chip ${diceMode === 'manual' ? 'on' : ''}`} aria-pressed={diceMode === 'manual'} onClick={() => setDiceMode('manual')}>I rolled</button>
        </div>
        {diceMode === 'manual' && (
          <div className="button-row">
            {Array.from({ length: need }, (_, i) => (
              <input key={i} type="number" inputMode="numeric" min={1} max={CORE.dice.sides} aria-label={`Die ${i + 1}`}
                placeholder={`d${CORE.dice.sides}`} value={typed[i] ?? ''} style={{ width: '4.5rem' }}
                onChange={(e) => setTyped((t) => t.map((v, j) => (j === i ? e.target.value : v)))} />
            ))}
          </div>
        )}
        {problem && <p className="error small">{problem}</p>}
      </fieldset>

      <button onClick={go}>{diceMode === 'app' ? 'Roll' : 'Log roll'} {stat ? `${stat.label} ${signed(stat.value)}` : signed(customBonus)}</button>

      {done && <ResultCard done={done} setDone={setDone} campaignId={campaignId} heroes={heroes} enemies={enemies} isGm={isGm}
        run={run} report={report} />}
    </div>
  )
}

function ResultCard({ done, setDone, campaignId, heroes, enemies, isGm, run, report }: {
  done: Done; setDone: (d: Done | null) => void; campaignId: string
  heroes: Character[]; enemies: Enemy[]; isGm: boolean; run: Run; report: Report
}) {
  const { working, setup, row, attack, target, actor } = done
  const band = impactBand(done.impact)
  const sign = (n: number) => (n >= 0 ? `+${n}` : String(n))
  const hit = done.impact > 0

  const harmRes = attack?.type === 'harm' && hit
    ? harm({
      impact: done.impact, weapon: attack.weapon, targetToughness: attack.toughness, jab: setup.jab,
      fromMook: attack.fromMook, extra: attack.extra ? [{ source: 'Extra Harm', value: attack.extra }] : undefined,
    })
    : null
  const stress = attack?.type === 'stress' && hit ? done.impact : 0

  const canUpgrade = Boolean(actor.hero) && (done.impact === 1 || done.impact === 2) && !done.upgraded
  const doUpgrade = () => run(async () => {
    const hero = actor.hero!
    const to = upgrade(done.impact)
    await bump(hero.id, 'drive', -2)
    await logRoll(campaignId, {
      ...row, dice: [], kept: [], impact: to, mode: row.mode,
      note: `Upgrade: Impact ${done.impact} to ${to} (2 Drive)`, label: `${row.label} (upgrade)`,
    })
    setDone({ ...done, impact: to, upgraded: true })
    report(`Upgrade: ${hero.name} spent 2 Drive.`, hero.drive < 2 ? [`Upgrade costs 2 Drive; ${hero.name} has ${hero.drive}. Fix the tracker if the table says otherwise.`] : [])
  })

  const apply = () => run(async () => {
    if (!target) return
    const lines: string[] = []
    if (target.kind === 'enemy') {
      const e = enemies.find((x) => x.id === target.id)
      if (e && stress) {
        const max = villainStress(e.kind).max
        const to = Math.min(max, e.stress + stress)
        await setEnemyField(campaignId, e.id, 'stress', to)
        lines.push(`${e.name}: +${stress} Stress (${to} of ${max}).`)
      } else if (e) lines.push(await hitEnemy(campaignId, e, done.impact, harmRes?.harm ?? 0))
    } else {
      const h = heroes.find((x) => x.id === target.id)
      if (h && stress) { await bump(h.id, 'stress', stress); lines.push(`${h.name}: +${stress} Stress.`) }
      else if (h) lines.push(...(await hitHero(h, harmRes?.harm ?? 0)))
    }
    setDone({ ...done, applied: lines })
    report(lines[0] ?? 'Applied.', lines.slice(1))
  })

  const targetName = target?.kind === 'enemy' ? enemies.find((e) => e.id === target.id)?.name : heroes.find((h) => h.id === target?.id)?.name

  return (
    <div className="card result stack" aria-live="polite">
      <p className="dice-line">
        {working.dice.map((d, i) => (
          <span key={i} className={`die ${working.kept.includes(d) ? 'kept' : 'dropped'}`}>{d}</span>
        ))}
        <span className="muted small"> kept {working.kept.join(' + ')} {sign(row.bonus)}{setup.edge ? ' +2 Edge' : ''}</span>
      </p>
      <p>
        <strong>Total {working.total}</strong> vs {setup.defense} · margin {sign(working.margin)} ·{' '}
        <strong>{done.upgraded ? `${band.label} (upgraded)` : band.label}</strong>
        {row.mode === 'manual' && <span className="tag">manual</span>}
      </p>
      <p className="small">{band.fight}. <span className="muted">Outside a fight: {band.outside}.</span></p>
      {harmRes && (
        <ol className="harm-steps small">
          {harmRes.steps.map((s, i) => <li key={i}>{s.label}: {s.change ? sign(s.change) : '0'} <span className="muted">= {s.running}</span></li>)}
          <li><strong>Harm {harmRes.harm}</strong></li>
        </ol>
      )}
      {stress > 0 && <p className="small"><strong>{stress} Stress</strong> <span className="muted">(a Presence attack deals 1 Stress per Impact)</span></p>}
      <div className="button-row">
        {canUpgrade && <button className="secondary" onClick={doUpgrade}>Upgrade (2 Drive)</button>}
        {isGm && target && attack && hit && !done.applied && (
          <button onClick={apply}>Apply {harmRes ? `${harmRes.harm} Harm` : `${stress} Stress`} to {targetName}</button>
        )}
        <button className="secondary" onClick={() => setDone(null)}>Clear</button>
      </div>
      {done.applied && <p className="small muted">Applied. {done.applied.join(' ')}</p>}
    </div>
  )
}
