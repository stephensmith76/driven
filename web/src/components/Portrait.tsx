import { useRef, useState } from 'react'
import { portraitUrl } from '../data/portraits'

const initials = (name: string) =>
  name.replace(/^the\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'

/** A round picture, or the name's initials when there is none. Tap a picture to open it full size. */
export function Portrait({ value, name, size = 48 }: { value: string | null | undefined; name: string; size?: number }) {
  const url = portraitUrl(value)
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }
  if (!url) return <span className="portrait blank" style={style} aria-hidden="true">{initials(name)}</span>
  return (
    <a href={url} target="_blank" rel="noreferrer" className="portrait-link" title={`Open ${name}'s picture`}>
      <img className="portrait" src={url} alt={name} style={style} loading="lazy" />
    </a>
  )
}

/** A picture with buttons to add, change or remove it. `onPick` uploads the file and saves the new value. */
export function PortraitPicker({ value, name, size = 64, onPick, onRemove }: {
  value: string | null | undefined
  name: string
  size?: number
  onPick: (file: File) => Promise<unknown>
  onRemove?: () => Promise<unknown>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try { await onPick(file) } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className="portrait-picker">
      <Portrait value={value} name={name} size={size} />
      <input ref={input} type="file" accept="image/*" hidden aria-label={`Picture for ${name}`}
        onChange={(e) => { void pick(e.target.files?.[0]) }} />
      <div className="button-row">
        <button type="button" className="mini secondary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Uploading…' : value ? 'Change picture' : 'Add picture'}
        </button>
        {value && onRemove && !busy && (
          <button type="button" className="mini secondary" onClick={() => { void onRemove() }}>Remove</button>
        )}
      </div>
    </div>
  )
}
