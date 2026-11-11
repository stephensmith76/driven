import { useConnection } from '../data/offline'

/** Shown only when the connection is down or writes are waiting to be sent. */
export function ConnectionBadge() {
  const { online, pending, retry } = useConnection()
  if (online && pending === 0) return null
  return (
    <div className="conn-badge" role="status" aria-live="polite">
      <span>{online ? 'Sending…' : 'Offline'}{pending > 0 ? ` · ${pending} change${pending === 1 ? '' : 's'} waiting` : ''}</span>
      <button className="mini secondary" onClick={retry}>Retry</button>
    </div>
  )
}
