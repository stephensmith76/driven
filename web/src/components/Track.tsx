/** A row of boxes; tap box n to fill up to n, tap the last filled box to clear it. */
export function Track({ label, value, max, onChange, names }: {
  label: string
  value: number
  max: number
  onChange?: (v: number) => void
  names?: string[]
}) {
  return (
    <div className="track">
      <span className="track-label">{label} <span className="muted">{value}/{max}</span></span>
      <div className="boxes" role="group" aria-label={label}>
        {Array.from({ length: max }, (_, i) => {
          const n = i + 1
          const filled = n <= value
          return (
            <button
              key={n}
              type="button"
              className={`box ${filled ? 'filled' : ''}`}
              aria-pressed={filled}
              title={names?.[i] ?? `${label} ${n}`}
              disabled={!onChange}
              onClick={() => onChange?.(value === n ? n - 1 : n)}
            >
              {names?.[i]?.[0] ?? ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}
