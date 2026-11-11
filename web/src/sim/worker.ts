/// <reference lib="webworker" />
// Runs sim/street_level_sim.py inside Pyodide (SPEC.md "How it runs"). Loaded only
// when the GM opens the Encounter lab; keeps Python and the simulator in memory after.
import { PYODIDE_URL } from './pyodide'

type PyodideAPI = {
  runPython: (code: string) => unknown
  globals: { get: (name: string) => unknown }
  FS: { writeFile: (path: string, data: string) => void }
}
export type ToWorker =
  | { type: 'load'; simUrl: string }
  | { type: 'run'; id: number; config: unknown }
export type FromWorker =
  | { type: 'progress'; id?: number; stage: string; done?: number; total?: number }
  | { type: 'ready'; ms: number }
  | { type: 'result'; id: number; result: unknown; ms: number }
  | { type: 'error'; id?: number; message: string }

const post = (m: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m)
let ready: Promise<PyodideAPI> | null = null

async function load(simUrl: string): Promise<PyodideAPI> {
  const t0 = performance.now()
  post({ type: 'progress', stage: 'Loading Python (about 10 MB, first time only)…' })
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)
  const py: PyodideAPI = await loadPyodide({ indexURL: PYODIDE_URL })
  post({ type: 'progress', stage: 'Loading the simulator…' })
  const res = await fetch(simUrl, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`Couldn't load the simulator (${res.status} ${simUrl})`)
  py.FS.writeFile('/home/pyodide/street_level_sim.py', await res.text())
  py.runPython(`
import sys, json
sys.path.insert(0, '/home/pyodide')
import street_level_sim as _sls
def _run(config_json, progress):
    return json.dumps(_sls.run_encounter(json.loads(config_json), progress))
`)
  post({ type: 'ready', ms: performance.now() - t0 })
  return py
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data
  try {
    if (m.type === 'load') {
      ready ??= load(m.simUrl)
      await ready
      return
    }
    if (!ready) throw new Error('Simulator not loaded')
    const py = await ready
    const run = py.globals.get('_run') as (cfg: string, cb: (d: number, n: number) => void) => string
    const t0 = performance.now()
    const out = run(JSON.stringify(m.config), (done, total) =>
      post({ type: 'progress', id: m.id, stage: 'Running fights…', done, total }))
    post({ type: 'result', id: m.id, result: JSON.parse(out), ms: performance.now() - t0 })
  } catch (e) {
    if (m.type === 'load') ready = null
    const message = e instanceof Error ? e.message.split('\n').filter(Boolean).slice(-1)[0] ?? e.message : String(e)
    post({ type: 'error', id: m.type === 'run' ? m.id : undefined, message })
  }
}
