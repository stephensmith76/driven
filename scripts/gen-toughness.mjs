// Generates rules/data/toughness.json from the Toughness table in rules/rules.md.
// The table is the authority: values are never typed here, only which data entries
// each row stands for. Run `npm run gen:toughness` after editing the table.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Which entries in rules/data each table row covers (names only, no numbers).
const REFS = {
  'Force +3 or higher': [{ kind: 'force' }],
  'Kevlar vest': [{ kind: 'gear', id: 'kevlar-vest' }],
  'Tactical armor, Armored power': [{ kind: 'gear', id: 'tactical-armor' }, { kind: 'power', id: 'armored' }],
  'Toughness (street power)': [{ kind: 'power', id: 'toughness' }],
}
const COLUMNS = ['blunt', 'blade', 'gun', 'hazard']
const HEADER = ['Where your Toughness comes from', 'Blunt', 'Blades', 'Guns', 'Electricity, gas, fire']

export function parseToughnessTable(md) {
  const lines = md.replace(/\r/g, '').split('\n')
  const start = lines.findIndex((l) => l.startsWith(`| ${HEADER[0]}`))
  if (start < 0) throw new Error('Toughness table not found in rules.md')
  const cells = (l) => l.split('|').slice(1, -1).map((c) => c.trim())
  if (cells(lines[start]).join('|') !== HEADER.join('|')) throw new Error(`Toughness table header changed: ${cells(lines[start]).join(' | ')}`)
  const rows = []
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const [source, ...vals] = cells(lines[i])
    if (!REFS[source]) throw new Error(`Toughness row "${source}" has no entry in REFS (scripts/gen-toughness.mjs)`)
    const nums = vals.map(Number)
    if (nums.length !== COLUMNS.length || nums.some((n) => !Number.isInteger(n) || n < 0 || n > 2)) throw new Error(`Bad values in row "${source}"`)
    rows.push({ source, ...Object.fromEntries(COLUMNS.map((k, j) => [k, nums[j]])), refs: REFS[source] })
  }
  const missing = Object.keys(REFS).filter((s) => !rows.some((r) => r.source === s))
  if (missing.length) throw new Error(`Rows missing from the rules.md table: ${missing.join('; ')}`)
  return rows
}

export function build() {
  const md = readFileSync(resolve(root, 'rules/rules.md'), 'utf8')
  return { generated_from: 'rules/rules.md, Toughness table. Do not edit by hand: run `npm run gen:toughness`.', rows: parseToughnessTable(md) }
}

if (process.argv[1]?.endsWith('gen-toughness.mjs')) {
  const text = JSON.stringify(build(), null, 2) + String.fromCharCode(10)
  writeFileSync(resolve(root, 'rules/data/toughness.json'), text)
  console.log('Wrote rules/data/toughness.json')
}
