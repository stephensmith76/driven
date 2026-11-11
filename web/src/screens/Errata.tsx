import { useEffect, useState } from 'react'
import { RULES_VERSION } from '../engine'
import { parseMarkdown, type Block, type Inline } from '../data/markdownLite'

const spans = (xs: Inline[]) =>
  xs.map((x, i) => x.bold ? <strong key={i}>{x.text}</strong> : x.italic ? <em key={i}>{x.text}</em> : <span key={i}>{x.text}</span>)

function render(b: Block, i: number) {
  switch (b.kind) {
    case 'h1': return <h1 key={i}>{spans(b.text)}</h1>
    case 'h2': return <h2 key={i}>{spans(b.text)}</h2>
    case 'p': return <p key={i}>{spans(b.text)}</p>
    case 'list': return (
      <ul key={i} className="errata-list">
        {b.items.map((it, j) => <li key={j} style={{ marginLeft: `${it.depth * 1.25}rem` }}>{spans(it.text)}</li>)}
      </ul>
    )
    case 'table': return (
      <div key={i} className="errata-table">
        <table>
          <thead><tr>{b.head.map((c, j) => <th key={j}>{spans(c)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{spans(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    )
  }
}

/** The errata for the printed rules. Public: anyone with the link can read it. */
export function Errata() {
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    fetch('./rules/errata.md', { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text() })
      .then((t) => setBlocks(parseMarkdown(t)))
      .catch(() => setError(true))
  }, [])
  const entries = blocks?.filter((b) => b.kind === 'h2').length ?? 0
  return (
    <main className="page wide errata">
      <p className="small">
        <a href="#/">← Back</a> · <a href="./rules/rules.md" target="_blank" rel="noreferrer">Read the current rules</a>
      </p>
      {error && <p className="error">Couldn't load the errata. Try again when you have a connection.</p>}
      {!blocks && !error && <p className="muted">Loading…</p>}
      {blocks && entries === 0 && (
        <>
          <h1>Errata</h1>
          <p>No changes since the printed rules. The current rules version is {RULES_VERSION}.</p>
        </>
      )}
      {blocks && entries > 0 && blocks.map(render)}
      {blocks && entries > 0 && <p className="muted small">Current rules version {RULES_VERSION}.</p>}
    </main>
  )
}
