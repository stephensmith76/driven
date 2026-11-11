import { useState } from 'react'
import { errorText } from '../data/supabase'

/** run() catches errors; report() shows a floating notice that never moves the page. */
export function useRunner() {
  const [status, setStatus] = useState<{ message: string; warnings: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const report = (message: string, warnings: string[] = []) => setStatus({ message, warnings })
  const run = (fn: () => Promise<unknown>) => {
    setError(null)
    fn().catch((e) => setError(errorText(e)))
  }
  const toast = (
    <div role="status" aria-live="polite">
      {(status || error) && (
        <div className="card small toast">
          {status && <p>{status.message}</p>}
          {status?.warnings.map((w, i) => <p key={i} className="warn">⚠ {w}</p>)}
          {error && <p className="error">{error}</p>}
          <button className="mini secondary" onClick={() => { setStatus(null); setError(null) }}>Dismiss</button>
        </div>
      )}
    </div>
  )
  return { run, report, toast }
}
