/**
 * The table component's model: a GFM table in the note, its own settings in a comment over it (invisible in other
 * Markdown viewers) — column widths, summed columns, merged cells, the value it is filled from:
 * `<!-- qa:table widths=120,0 sums=1 merge=0.1.2.1;3.0.1.2 -->`.
 * Below: what the table block does to it (columns, sums, order, chosen cells, filling from a value).
 */
import { rangeBounds, tsvRows, type CellRange } from '../../../shared/gridRange'

/** The settings comment over a table. */
export const TABLE_META = /^<!--\s*qa:table\s+([^>]*?)\s*-->\s*$/
export const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
export const isSepRow = (l: string) => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(l) && l.includes('-')

/** A column's alignment in Markdown: how its separator cell reads and writes, how its cells are padded. */
interface AlignRule {
  /** The separator cell (`:---:`, `---:`, `:---`). */
  mark: RegExp
  /** The separator cell `w` wide. */
  rule: (w: number) => string
  /** A cell's text with `sp` spaces added to line the column up. */
  pad: (s: string, sp: number) => string
}
const ALIGN_RULES = {
  left: { mark: /^:-+$/, rule: (w) => `:${'-'.repeat(w - 1)}`, pad: (s, sp) => s + ' '.repeat(sp) },
  center: { mark: /^:-+:$/, rule: (w) => `:${'-'.repeat(w - 2)}:`, pad: (s, sp) => ' '.repeat(Math.floor(sp / 2)) + s + ' '.repeat(Math.ceil(sp / 2)) },
  right: { mark: /^-+:$/, rule: (w) => `${'-'.repeat(w - 1)}:`, pad: (s, sp) => ' '.repeat(sp) + s },
} satisfies Record<string, AlignRule>
/** No alignment set: a plain separator, the text on the left. */
const NO_ALIGN: AlignRule = { mark: /^-+$/, rule: (w) => '-'.repeat(w), pad: ALIGN_RULES.left.pad }
export type Align = keyof typeof ALIGN_RULES | undefined
const ALIGN_NAMES = Object.keys(ALIGN_RULES) as Array<keyof typeof ALIGN_RULES>
const alignRule = (a: Align): AlignRule => (a ? ALIGN_RULES[a] : NO_ALIGN)
/** A separator cell's alignment. */
const alignOf = (cell: string): Align => ALIGN_NAMES.find((a) => ALIGN_RULES[a].mark.test(cell))
export interface TableModel {
  head: string[]
  rows: string[][]
  align: Align[]
  /** Column widths, px (0 — by the content); none — all by the content. */
  widths?: number[]
  /** The columns with a sum under them. */
  sums?: number[]
  /** Merged cells of the body: from row r, column c — rs rows, cs columns (the text is the first cell's). */
  merges?: Merge[]
  /** «Из переменной»: the value it is filled from (a path into the note's context — rows, resp.body.data). */
  from?: string
  /** What was filled last (its hash): the table not edited since — filled again when the value changes. */
  filled?: string
  /** The cells' text wrapped (by default — one line each, cut with «…»; copied whole). */
  wrap?: boolean
  /** The value it was filled from (its hash): changed while the table was not on screen — seen when it is. */
  srcHash?: string
}
export interface Merge {
  r: number
  c: number
  rs: number
  cs: number
}
/** A table row's cells (`\|` — a pipe inside a cell, <br> — a line break). */
function splitRow(l: string): string[] {
  let s = l.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur)
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur)
  return cells.map((c) => c.trim().replace(/<br\s*\/?>/gi, '\n'))
}
/** A table's text (its settings comment included) → its model. */
export function parseTable(src: string): TableModel {
  let lines = src.split('\n')
  const wm = TABLE_META.exec(lines[0])
  if (wm) lines = lines.slice(1)
  const head = splitRow(lines[0])
  const align = splitRow(lines[1] ?? '').map(alignOf)
  const n = head.length
  const rows = lines.slice(2).map((l) => {
    const r = splitRow(l)
    return [...r, ...Array(Math.max(0, n - r.length)).fill('')].slice(0, n)
  })
  const t: TableModel = { head, rows, align: [...align, ...Array(Math.max(0, n - align.length)).fill(undefined)].slice(0, n) }
  if (wm) {
    const kv = Object.fromEntries([...wm[1].matchAll(/(\w+)=([^\s]*)/g)].map((m) => [m[1], m[2]]))
    if (kv.widths) {
      const ws = kv.widths.split(',').map((x) => Math.max(0, Math.round(Number(x.trim()) || 0)))
      if (ws.some((x) => x > 0)) t.widths = [...ws, ...Array(Math.max(0, n - ws.length)).fill(0)].slice(0, n)
    }
    if (kv.sums) {
      const ss = [...new Set(kv.sums.split(',').map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x < n))]
      if (ss.length) t.sums = ss.sort((a, b) => a - b)
    }
    if (kv.var && /^[A-Za-z_$][\w$.[\]"'-]*$/.test(kv.var)) t.from = kv.var
    if (kv.fill) t.filled = kv.fill
    if (kv.src) t.srcHash = kv.src
    if (kv.wrap === '1') t.wrap = true
    if (kv.merge) {
      const ms = kv.merge
        .split(';')
        .map((x) => x.split('.').map(Number))
        .filter((m) => m.length === 4 && m.every((v) => Number.isInteger(v) && v >= 0))
        .map(([r, c, rs, cs]) => ({ r, c, rs: Math.max(1, rs), cs: Math.max(1, cs) }))
        .filter((m) => m.r + m.rs <= rows.length && m.c + m.cs <= n && m.rs * m.cs > 1)
      // overlapping ones (an edited file): the first one wins
      const ok: Merge[] = []
      for (const m of ms) if (!ok.some((o) => overlaps(o, m))) ok.push(m)
      if (ok.length) t.merges = ok
    }
  }
  return t
}
const overlaps = (a: Merge, b: Merge) => a.r < b.r + b.rs && b.r < a.r + a.rs && a.c < b.c + b.cs && b.c < a.c + a.cs

// ---------- a table's numbers ----------
/**
 * A cell as a number, or undefined when it is not one (letters, two numbers…) — such a cell is skipped, never
 * an error. «1 234,5», «1234.5», «-12», «1,234.50» (both marks: the last one is the fraction's).
 */
export function cellNumber(s: string): number | undefined {
  const tr = s.trim()
  // spaces inside — only between thousands («1 234 567,5»); «10 5» is two numbers, not 105
  if (/\d[\s  ]+\d/.test(tr) && !/^[+-]?\d{1,3}([\s  ]\d{3})+([.,]\d+)?$/.test(tr)) return undefined
  let x = tr.replace(/[\s  ]/g, '')
  if (!x) return undefined
  const dot = x.lastIndexOf('.')
  const comma = x.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) x = dot > comma ? x.replace(/,/g, '') : x.replace(/\./g, '').replace(',', '.')
  else if (comma >= 0) x = (x.match(/,/g)!.length > 1 ? x.replace(/,/g, '') : x.replace(',', '.'))
  else if ((x.match(/\./g)?.length ?? 0) > 1) x = x.replace(/\./g, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(x)) return undefined
  const v = Number(x)
  return Number.isFinite(v) ? v : undefined
}
/** The cell at (r, c) is hidden under another one's merge. */
export function coveredBy(t: TableModel, r: number, c: number): Merge | undefined {
  return t.merges?.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs && !(r === m.r && c === m.c))
}
/** The merge whose first cell is (r, c). */
export const mergeAt = (t: TableModel, r: number, c: number) => t.merges?.find((m) => m.r === r && m.c === c)
/**
 * A column's sum: the numbers of its cells — a merged cell counts in every column it spans, once in each (not
 * once per row it spans). `skipped` — the cells with something else than a number.
 */
export function columnSum(t: TableModel, c: number): { sum: number; count: number; skipped: number } {
  let sum = 0
  let count = 0
  let skipped = 0
  let digits = 0
  t.rows.forEach((row, r) => {
    const m = coveredBy(t, r, c)
    // under a merge: its value, at its first row only
    if (m && r !== m.r) return
    const s = (m ? t.rows[m.r][m.c] : row[c]) ?? ''
    if (!s.trim()) return
    const v = cellNumber(s)
    if (v === undefined) return void skipped++
    sum += v
    count++
    digits = Math.max(digits, (String(v).split('.')[1] ?? '').length)
  })
  // 0.1 + 0.2 — not 0.30000000000000004
  return { sum: Number(sum.toFixed(Math.min(10, digits))), count, skipped }
}
/** A sum as people write it: «1 234,5». */
export const fmtSum = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 10 })

// ---------- merging ----------
/** Merges the rectangle (the cells inside other merges join it); as in Excel, only the first value stays (the first non-empty one, row by row). */
export function mergeCells(t: TableModel, r0: number, c0: number, r1: number, c1: number): void {
  let m: Merge = { r: Math.min(r0, r1), c: Math.min(c0, c1), rs: Math.abs(r1 - r0) + 1, cs: Math.abs(c1 - c0) + 1 }
  // grow over the merges it touches (a rectangle never cuts one)
  for (let grown = true; grown; ) {
    grown = false
    for (const o of t.merges ?? [])
      if (overlaps(o, m)) {
        const r = Math.min(m.r, o.r)
        const c = Math.min(m.c, o.c)
        const n: Merge = { r, c, rs: Math.max(m.r + m.rs, o.r + o.rs) - r, cs: Math.max(m.c + m.cs, o.c + o.cs) - c }
        if (n.r !== m.r || n.c !== m.c || n.rs !== m.rs || n.cs !== m.cs) ((m = n), (grown = true))
      }
  }
  if (m.rs * m.cs < 2) return
  const texts: string[] = []
  for (let r = m.r; r < m.r + m.rs; r++)
    for (let c = m.c; c < m.c + m.cs; c++) {
      const v = t.rows[r][c]?.trim()
      if (v) texts.push(v)
      t.rows[r][c] = ''
    }
  t.rows[m.r][m.c] = texts[0] ?? ''
  t.merges = [...(t.merges ?? []).filter((o) => !overlaps(o, m)), m]
}
/** The merge starting at (r, c) undone (its cells keep their text). */
export function unmergeCell(t: TableModel, r: number, c: number): void {
  t.merges = t.merges?.filter((m) => !(m.r === r && m.c === c))
  if (!t.merges?.length) t.merges = undefined
}
/** A row put at `at` (0 — the first of the body): the merges below move, the ones across grow. */
export function insertRowAt(t: TableModel, at: number): void {
  t.rows.splice(at, 0, Array(t.head.length).fill(''))
  t.merges = t.merges?.map((m) => (m.r >= at ? { ...m, r: m.r + 1 } : m.r + m.rs > at ? { ...m, rs: m.rs + 1 } : m))
}
/** The row `at` deleted: the merges across shrink (a merge's first row deleted — its text goes to the next one). */
export function deleteRowAt(t: TableModel, at: number): void {
  const out: Merge[] = []
  for (const m of t.merges ?? []) {
    if (m.r > at) out.push({ ...m, r: m.r - 1 })
    else if (m.r + m.rs <= at) out.push(m)
    else {
      if (m.r === at && m.rs > 1) t.rows[at + 1][m.c] = t.rows[at][m.c]
      const n = { ...m, rs: m.rs - 1 }
      if (n.rs * n.cs > 1) out.push(n)
    }
  }
  t.rows.splice(at, 1)
  t.merges = out.length ? out : undefined
}
/** A column put at `at`: the merges right of it move, the ones across grow, the sums follow their columns. */
export function insertColAt(t: TableModel, at: number): void {
  for (const r of t.rows) r.splice(at, 0, '')
  t.merges = t.merges?.map((m) => (m.c >= at ? { ...m, c: m.c + 1 } : m.c + m.cs > at ? { ...m, cs: m.cs + 1 } : m))
  t.sums = t.sums?.map((s) => (s >= at ? s + 1 : s))
}
/** The column `at` deleted: the merges across shrink, its sum goes. */
export function deleteColAt(t: TableModel, at: number): void {
  const out: Merge[] = []
  for (const m of t.merges ?? []) {
    if (m.c > at) out.push({ ...m, c: m.c - 1 })
    else if (m.c + m.cs <= at) out.push(m)
    else {
      if (m.c === at && m.cs > 1) t.rows[m.r][at + 1] = t.rows[m.r][at]
      const n = { ...m, cs: m.cs - 1 }
      if (n.rs * n.cs > 1) out.push(n)
    }
  }
  for (const r of t.rows) r.splice(at, 1)
  t.merges = out.length ? out : undefined
  t.sums = t.sums?.filter((s) => s !== at).map((s) => (s > at ? s - 1 : s))
  if (!t.sums?.length) t.sums = undefined
}
const cellText = (c: string) => c.replace(/\r\n?/g, '\n').replace(/\|/g, '\\|').replace(/\n/g, '<br>').trim()
/** A cell as it comes back from the file (its edges trimmed, its line breaks — \n): what a filled table's hash is of. */
export const normCell = (c: string) => c.replace(/\r\n?/g, '\n').replace(/<br\s*\/?>/gi, '\n').trim()
/** A table as Markdown, its columns lined up (it reads as a table in any editor). */
export function tableMd(t: TableModel): string {
  const n = t.head.length
  const all = [t.head, ...t.rows].map((r) => r.map(cellText))
  const w = Array.from({ length: n }, (_, i) => Math.max(3, ...all.map((r) => [...(r[i] ?? '')].length)))
  const pad = (s: string, i: number) => alignRule(t.align[i]).pad(s, w[i] - [...s].length)
  const row = (r: string[]) => `| ${r.map((c, i) => pad(c ?? '', i)).join(' | ')} |`
  const sep = `| ${w.map((x, i) => alignRule(t.align[i]).rule(x)).join(' | ')} |`
  const meta = [
    ...(t.widths?.some((x) => x > 0) ? [`widths=${t.widths.slice(0, n).map((x) => Math.round(x)).join(',')}`] : []),
    ...(t.sums?.length ? [`sums=${t.sums.filter((s) => s < n).join(',')}`] : []),
    ...(t.merges?.length ? [`merge=${t.merges.map((m) => `${m.r}.${m.c}.${m.rs}.${m.cs}`).join(';')}`] : []),
    ...(t.wrap ? ['wrap=1'] : []),
    ...(t.from ? [`var=${t.from}`, ...(t.filled ? [`fill=${t.filled}`] : []), ...(t.srcHash ? [`src=${t.srcHash}`] : [])] : []),
  ]
  const head = meta.length ? [`<!-- qa:table ${meta.join(' ')} -->`] : []
  return [...head, row(all[0]), sep, ...all.slice(1).map(row)].join('\n')
}
/**
 * A value as a table's head and rows (its cells — text): a list of objects — a row each, every key met a column (in
 * the order met; a key a row lacks — an empty cell); a list of plain values — one column; one object — its keys the
 * columns, one row; a list of lists — as they are; a plain value — one cell. Objects inside cells — as JSON.
 */
export function valueTable(v: unknown): { head: string[]; rows: string[][] } {
  const cell = (x: unknown) => normCell(x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x))
  const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
  const objects = (xs: Array<Record<string, unknown>>) => {
    const head: string[] = []
    const seen = new Set<string>()
    for (const x of xs) for (const k of Object.keys(x)) if (!seen.has(k)) (seen.add(k), head.push(k))
    return { head: head.length ? head : ['значение'], rows: xs.map((x) => (head.length ? head.map((k) => cell(x[k])) : [''])) }
  }
  if (Array.isArray(v)) {
    if (v.length && v.every(isObj)) return objects(v)
    if (v.length && v.every((x) => Array.isArray(x))) {
      const n = Math.max(1, ...v.map((x) => (x as unknown[]).length))
      return { head: Array.from({ length: n }, (_, i) => `Столбец ${i + 1}`), rows: v.map((x) => Array.from({ length: n }, (_, i) => cell((x as unknown[])[i]))) }
    }
    return { head: ['значение'], rows: v.map((x) => [cell(x)]) }
  }
  if (isObj(v)) return objects([v])
  return { head: ['значение'], rows: [[cell(v)]] }
}
/** A table's content in a few letters (was it edited since it was filled?). */
export function tableHash(t: { head: string[]; rows: string[][] }): string {
  return textHash(JSON.stringify([t.head, t.rows]))
}
/** A text's hash in a few letters (djb2, base 36). */
export function textHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
/** An empty table: `cols` columns, `rows` rows the head included. */
export const newTable = (cols: number, rows: number): TableModel => ({
  head: Array.from({ length: cols }, (_, i) => `Столбец ${i + 1}`),
  rows: Array.from({ length: Math.max(1, rows - 1) }, () => Array(cols).fill('')),
  align: Array(cols).fill(undefined),
})

// ---------- what the table block does to it: columns, sums, order, chosen cells, filling from a value ----------

/** A column put at `at` (its name «Столбец N»), the widths / sums / merges following. */
export function addColumn(t: TableModel, at: number): void {
  t.head.splice(at, 0, `Столбец ${t.head.length + 1}`)
  t.align.splice(at, 0, undefined)
  t.widths?.splice(at, 0, 0)
  insertColAt(t, at)
}
/** The column `at` deleted (the last one stays); false — nothing done. */
export function removeColumn(t: TableModel, at: number): boolean {
  if (t.head.length <= 1) return false
  t.head.splice(at, 1)
  t.align.splice(at, 1)
  t.widths?.splice(at, 1)
  deleteColAt(t, at)
  return true
}
/** A column's sum under it shown / taken away. */
export function toggleColumnSum(t: TableModel, c: number): void {
  const s = new Set(t.sums ?? [])
  if (s.has(c)) s.delete(c)
  else s.add(c)
  t.sums = s.size ? [...s].sort((a, b) => a - b) : undefined
}
/** The rows sorted by a column: numbers as numbers, the rest as text; merged cells hold rows together — false, not sorted. */
export function sortRowsBy(t: TableModel, c: number, dir: 1 | -1): boolean {
  if (t.merges?.length) return false
  const n = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'))
  t.rows.sort((a, b) => {
    const x = n(a[c])
    const y = n(b[c])
    return dir * (Number.isFinite(x) && Number.isFinite(y) && a[c].trim() && b[c].trim() ? x - y : a[c].localeCompare(b[c], 'ru', { numeric: true }))
  })
  return true
}

/** A cell's text: row -1 — the head. */
const cellAt = (t: TableModel, r: number, c: number) => (r < 0 ? t.head[c] : (t.rows[r]?.[c] ?? ''))
/** The chosen cells as Excel takes them. */
export function rangeText(t: TableModel, x: CellRange): string {
  const b = rangeBounds(x)
  const rows: string[][] = []
  for (let r = b.top; r <= b.bottom; r++) {
    const cells: string[] = []
    for (let c = b.left; c <= b.right; c++) cells.push(cellAt(t, r, c))
    rows.push(cells)
  }
  return tsvRows(rows)
}
/** The whole table (its head first) as Excel takes it. */
export const tableText = (t: TableModel) => tsvRows([t.head, ...t.rows])
/** The chosen cells emptied (merged ones keep their merge). */
export function clearRange(t: TableModel, x: CellRange): void {
  const b = rangeBounds(x)
  for (let r = b.top; r <= b.bottom; r++)
    for (let c = b.left; c <= b.right; c++) {
      if (r < 0) t.head[c] = ''
      else if (t.rows[r]) t.rows[r][c] = ''
    }
}
/** The rows as objects (the head — their keys; an empty name — «Столбец N»): the table seen as JSON. */
export const tableObjects = (t: TableModel) => t.rows.map((r) => Object.fromEntries(t.head.map((h, i) => [h || `Столбец ${i + 1}`, r[i] ?? ''])))

/**
 * Filled from a value («Из переменной»): its columns and rows; the alignment and widths kept while the columns are
 * as many; sums beyond the columns, merges dropped; what was filled (and the value's key) remembered.
 */
export function fillFromValue(t: TableModel, value: unknown, sourceKey: string | undefined): void {
  const vt = valueTable(value)
  const same = vt.head.length === t.head.length
  t.head = vt.head
  t.rows = vt.rows.length ? vt.rows : [vt.head.map(() => '')]
  t.align = same ? t.align : vt.head.map(() => undefined)
  if (!same) t.widths = undefined
  t.sums = t.sums?.filter((c) => c < vt.head.length)
  if (!t.sums?.length) t.sums = undefined
  t.merges = undefined
  t.filled = tableHash(t)
  t.srcHash = sourceKey === undefined ? undefined : textHash(sourceKey)
}
