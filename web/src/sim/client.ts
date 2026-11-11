// The page side of the simulator worker: one worker per tab, created on first use.
import type { SimConfig, SimResult } from '../engine'
import type { FromWorker, ToWorker } from './worker'

export type Progress = { stage: string; done?: number; total?: number }

let worker: Worker | null = null
let loading: Promise<number> | null = null
let nextId = 1
const pending = new Map<number, { resolve: (r: { result: SimResult; ms: number }) => void; reject: (e: Error) => void; onProgress?: (p: Progress) => void }>()
let loadProgress: ((p: Progress) => void) | undefined

/** The published simulator file, next to the page (the build copies it there; dev serves it). */
export const simUrl = () => new URL('sim/street_level_sim.py', window.location.href.split('#')[0]).href

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data
    if (m.type === 'progress') {
      if (m.id != null) pending.get(m.id)?.onProgress?.(m)
      else loadProgress?.(m)
    } else if (m.type === 'result') {
      pending.get(m.id)?.resolve({ result: m.result as SimResult, ms: m.ms }); pending.delete(m.id)
    } else if (m.type === 'error' && m.id != null) {
      pending.get(m.id)?.reject(new Error(m.message)); pending.delete(m.id)
    }
  }
  return worker
}

/** Load Pyodide and the simulator. Resolves with the load time in ms. Safe to call repeatedly. */
export function loadSim(onProgress?: (p: Progress) => void): Promise<number> {
  loadProgress = onProgress
  if (loading) return loading
  const w = getWorker()
  loading = new Promise<number>((resolve, reject) => {
    const on = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data
      if (m.type === 'ready') { w.removeEventListener('message', on); resolve(m.ms) }
      if (m.type === 'error' && m.id == null) { w.removeEventListener('message', on); loading = null; reject(new Error(m.message)) }
    }
    w.addEventListener('message', on)
    w.postMessage({ type: 'load', simUrl: simUrl() } satisfies ToWorker)
  })
  return loading
}

export async function runEncounter(config: SimConfig, onProgress?: (p: Progress) => void) {
  await loadSim()
  const id = nextId++
  return new Promise<{ result: SimResult; ms: number }>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    getWorker().postMessage({ type: 'run', id, config } satisfies ToWorker)
  })
}
