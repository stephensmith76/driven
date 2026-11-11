// M5 check (SPEC.md): the browser's simulator (Pyodide) and the command line (CPython)
// agree within 2 points, and a hero with an unmodeled power shows under "Not simulated".
// Runs the exact published file through the same Pyodide build the Encounter lab loads.
//   npm run test:sim     (pytest first, then this)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadPyodide } from 'pyodide'
import demo from '../supabase/seed/demo-heroes.json'
import check from '../sim/tests/encounter_check.json'
import { encounterConfig, libraryMooks, libraryVillains, type EncounterForm, type SimConfig, type SimResult, type Sheet } from '../web/src/engine'
import { PYODIDE_VERSION } from '../web/src/sim/pyodide'

const repo = resolve(import.meta.dirname, '..')
const simFile = join(repo, 'sim', 'street_level_sim.py')
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')

let failed = 0
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failed++ }

function cli(config: SimConfig): SimResult {
  const dir = mkdtempSync(join(tmpdir(), 'sim-check-'))
  const p = join(dir, 'encounter.json')
  writeFileSync(p, JSON.stringify(config))
  return JSON.parse(execFileSync(python, [simFile, '--config', p], { encoding: 'utf8' }))
}

function agree(name: string, a: SimResult, b: SimResult) {
  const pairs: [string, number, number][] = [
    ['win', a.win_pct, b.win_pct], ['anyone Down', a.any_down_pct, b.any_down_pct], ['Dying', a.dying_pct, b.dying_pct],
    ...Object.keys(a.heroes).map((k) => [`${k} Down`, a.heroes[k].down_pct, b.heroes[k]?.down_pct ?? NaN] as [string, number, number]),
  ]
  const worst = Math.max(...pairs.map(([, x, y]) => Math.abs(x - y)))
  ok(worst <= 2, `${name}: command line ${a.win_pct}% wins / ${a.any_down_pct}% Down, browser ${b.win_pct}% / ${b.any_down_pct}% (largest gap ${worst.toFixed(1)} points)`)
}

async function main() {
  console.log(`Pyodide ${PYODIDE_VERSION}; command line: ${execFileSync(python, ['--version'], { encoding: 'utf8' }).trim()}`)
  const py = await loadPyodide()
  py.FS.writeFile('/home/pyodide/street_level_sim.py', readFileSync(simFile, 'utf8'))
  py.runPython(`
import sys, json
sys.path.insert(0, '/home/pyodide')
import street_level_sim as _sls
def _run(c): return json.dumps(_sls.run_encounter(json.loads(c)))
`)
  const run = py.globals.get('_run') as (c: string) => string
  const browser = (c: SimConfig) => {
    const t0 = performance.now()
    const r = JSON.parse(run(JSON.stringify(c))) as SimResult
    return { r, s: (performance.now() - t0) / 1000 }
  }

  // 1. The spec's pytest party, same config through both.
  const a = cli(check as SimConfig); const b = browser(check as SimConfig)
  agree('Rook, Nightjar, Ledger vs the Butcher + 1 Saints group (2,000 runs, seed 7)', a, b.r)
  ok(b.r.win_pct >= 95 && b.r.win_pct <= 99, `wins between 95 and 99% (${b.r.win_pct}%)`)

  // 2. Four heroes built from sheets, one with an unmodeled power. Also the speed target.
  const chars = (demo as unknown as Sheet[]).map((s, i) => ({ ...s, id: `c${i}`, harm: 0, stress: 0, drive: 2 }))
  const mara = { ...chars[3], id: 'mara', name: 'Mara', loadout: [{ kind: 'power' as const, id: 'telepathy', ability_level: 1, flaw: 'Unstable' }] }
  const form: EncounterForm = {
    party: ['c0', 'c1', 'c2', 'mara'], mode: 'fresh',
    villains: [libraryVillains().find((v) => v.id === 'the-butcher')!.sim, libraryVillains().find((v) => v.id === 'lieutenant')!.sim],
    mook_groups: [libraryMooks()[0].sim, libraryMooks()[0].sim], dark: false, runs: 1000,
  }
  const cfg = encounterConfig(form, [...chars, mara], 21)
  const c4 = cli(cfg); const b4 = browser(cfg)
  agree('Bulwark, Rook, Nightjar, Mara vs the Butcher + a lieutenant + 2 Saints groups (1,000 runs, seed 21)', c4, b4.r)
  ok(b4.r.not_simulated.includes('Mara: Telepathy'), `"Not simulated" lists Mara's power: ${JSON.stringify(b4.r.not_simulated)}`)
  console.log(`info  1,000 fights with four heroes took ${b4.s.toFixed(1)} s in Pyodide under Node (target in a browser: under 10 s)`)

  // 3. Unseeded: two independent samples still land within 2 points.
  const u = { ...(check as SimConfig), seed: null, runs: 10000 }
  agree('unseeded, 10,000 runs each', cli(u), browser(u).r)

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll M5 checks passed.')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
