// Offline queue (SPEC.md "Table wifi drops"): small writes made while the connection is down are
// kept on the device, shown immediately, and replayed in order when the connection returns.
import { useSyncExternalStore } from 'react'

/** A write that can be stored as JSON and replayed. Replaying must be safe to repeat. */
export type QueuedOp = {
  qid: string
  /** What to call when replaying (see `handlers`). */
  kind: string
  args: unknown[]
  /** Optimistic effect on what the screen shows until the write lands. */
  table: string
  id: string
  /** Fields to overlay on the row, or `add` to deltas, or a whole row to `insert`. */
  set?: Record<string, unknown>
  add?: Record<string, number>
  insert?: Record<string, unknown>
}

export type Handler = (...args: never[]) => Promise<unknown>
const handlers = new Map<string, Handler>()
export const registerHandler = (kind: string, fn: Handler) => handlers.set(kind, fn)

const KEY = 'street-level-offline-queue'
let queue: QueuedOp[] = []
let online = typeof navigator === 'undefined' ? true : navigator.onLine
let flushing = false
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; listeners.forEach((l) => l()) }

const load = () => { try { queue = JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { queue = [] } }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(queue)) } catch { /* private window: keep in memory */ } }
load()

/** True when a failure means "couldn't reach the server" (not "the server said no"). */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = String((e as { message?: unknown } | null)?.message ?? e)
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout/i.test(msg)
}

/**
 * Run a write. If the connection is down it is queued and the call resolves with `fallback`;
 * any other error is thrown to the caller as before.
 */
export async function queuedWrite<T>(op: Omit<QueuedOp, 'qid'>, run: () => Promise<T>, fallback: T): Promise<T> {
  // Keep order: if older writes are waiting, this one waits behind them.
  if (queue.length === 0) {
    try {
      const out = await run()
      setOnline(true)
      return out
    } catch (e) {
      if (!isNetworkError(e)) throw e
      setOnline(false)
    }
  }
  queue.push({ ...op, qid: crypto.randomUUID() })
  save(); emit()
  void flush()
  return fallback
}

function setOnline(v: boolean) { if (online !== v) { online = v; emit() } }

/** Replay waiting writes in order. Stops at the first network failure; drops writes the server refuses. */
export async function flush() {
  if (flushing) return
  flushing = true
  try {
    while (queue.length > 0) {
      const op = queue[0]
      const fn = handlers.get(op.kind)
      try {
        if (fn) await (fn as (...a: unknown[]) => Promise<unknown>)(...op.args)
        setOnline(true)
      } catch (e) {
        if (isNetworkError(e)) { setOnline(false); return }
        // The server refused it (for example a duplicate insert that already landed): drop it.
        console.warn('Dropped queued write', op.kind, e)
      }
      queue.shift(); save(); emit()
    }
  } finally { flushing = false }
}

/** Apply the optimistic overlay for waiting writes to a table's rows. */
export function overlay<T extends { id: string }>(table: string, rows: T[]): T[] {
  const mine = queue.filter((o) => o.table === table)
  if (mine.length === 0) return rows
  let out = rows
  for (const o of mine) {
    if (o.insert) {
      if (!out.some((r) => r.id === o.id)) out = [...out, o.insert as unknown as T]
      continue
    }
    out = out.map((r) => {
      if (r.id !== o.id) return r
      const next: Record<string, unknown> = { ...r, ...(o.set ?? {}) }
      for (const [k, d] of Object.entries(o.add ?? {})) next[k] = Math.max(0, Number(next[k] ?? 0) + d)
      return next as T
    })
  }
  return out
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { setOnline(true); void flush() })
  window.addEventListener('offline', () => setOnline(false))
  // Also retry on a timer: the browser's "online" event is unreliable on phones.
  setInterval(() => { if (queue.length > 0) void flush() }, 5000)
  if (queue.length > 0) void flush()
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useOfflineVersion = () => useSyncExternalStore(subscribe, () => version)

/** For the badge. */
export function useConnection() {
  useOfflineVersion()
  return { online, pending: queue.length, retry: () => void flush() }
}

/** Test hooks. */
export const _test = { reset: () => { queue = []; online = true; flushing = false; version = 0 }, pending: () => queue.length }
