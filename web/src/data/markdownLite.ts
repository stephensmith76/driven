// A tiny Markdown reader for the errata page: headings, paragraphs, nested bullets, tables, **bold** and *italic*.
// It builds plain data (no HTML), so rendering it can never inject markup.

export type Inline = { text: string; bold?: boolean; italic?: boolean }
export type Block =
  | { kind: 'h1' | 'h2'; text: Inline[] }
  | { kind: 'p'; text: Inline[] }
  | { kind: 'list'; items: { depth: number; text: Inline[] }[] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] }

export function inline(s: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g
  let last = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) })
    out.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], italic: true })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last) })
  return out
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
const isDivider = (line: string | undefined) => !!line && /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-')

export function parseMarkdown(src: string): Block[] {
  const lines = src.split(/\r?\n/)
  const blocks: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) { blocks.push({ kind: 'p', text: inline(para.join(' ')) }); para = [] }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) { flush(); continue }
    const h = line.match(/^(#{1,2})\s+(.*)$/)
    if (h) { flush(); blocks.push({ kind: h[1].length === 1 ? 'h1' : 'h2', text: inline(h[2]) }); continue }
    if (line.trim().startsWith('|') && isDivider(lines[i + 1])) {
      flush()
      const head = cells(line).map(inline)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]).map(inline))
      i--
      blocks.push({ kind: 'table', head, rows })
      continue
    }
    const b = line.match(/^(\s*)[-*]\s+(.*)$/)
    if (b) {
      flush()
      const item = { depth: Math.floor(b[1].length / 2), text: inline(b[2]) }
      const prev = blocks[blocks.length - 1]
      if (prev?.kind === 'list') prev.items.push(item)
      else blocks.push({ kind: 'list', items: [item] })
      continue
    }
    para.push(line.trim())
  }
  flush()
  return blocks
}
