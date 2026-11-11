import { describe, expect, it } from 'vitest'
import { inline, parseMarkdown } from './markdownLite'

describe('markdownLite', () => {
  it('reads bold and italic', () => {
    expect(inline('a **b** *c* d')).toEqual([{ text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' d' }])
  })
  it('reads headings, paragraphs, nested bullets and tables', () => {
    const b = parseMarkdown('# T\n\nline one\nline two\n\n- a\n  - b\n\n| X | Y |\n| --- | --- |\n| 1 | 2 |\n\nend')
    expect(b.map((x) => x.kind)).toEqual(['h1', 'p', 'list', 'table', 'p'])
    expect((b[1] as { text: { text: string }[] }).text[0].text).toBe('line one line two')
    expect((b[2] as { items: { depth: number }[] }).items.map((i) => i.depth)).toEqual([0, 1])
    const t = b[3] as { head: unknown[]; rows: unknown[][] }
    expect(t.head).toHaveLength(2)
    expect(t.rows).toHaveLength(1)
  })
  it('never produces markup from html', () => {
    expect(parseMarkdown('<script>x</script>')[0]).toEqual({ kind: 'p', text: [{ text: '<script>x</script>' }] })
  })
  it('parses the real errata file into sections', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const text = readFileSync(resolve(import.meta.dirname, '../../../rules/errata.md'), 'utf8')
    const blocks = parseMarkdown(text)
    expect(blocks[0].kind).toBe('h1')
    expect(blocks.filter((b) => b.kind === 'h2').length).toBeGreaterThan(0)
  })
})
