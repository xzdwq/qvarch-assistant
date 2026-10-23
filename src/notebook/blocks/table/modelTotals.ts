/**
 * A column's total under it: the sum, the average, the least / the greatest number, how many cells are filled, what
 * part of them is. Kept in the settings comment (`sums=1,3:avg,4:filled` — a bare column is a sum, as before).
 * A merged cell counts once in every column it spans (not once per row it spans).
 */
import type { TableModel } from './model'
import { coveredBy } from './modelMerges'

/** The totals a column may have, in the menu's order. */
export const TOTAL_KINDS = ['sum', 'avg', 'min', 'max', 'count', 'filled'] as const
export type TotalKind = (typeof TOTAL_KINDS)[number]
export interface ColumnTotal {
  c: number
  kind: TotalKind
}

// ---------- a column's cells ----------
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
/** What a column's totals are of: its numbers, how many cells it has (a merge — one), filled, not numbers. */
export interface ColumnCells {
  numbers: number[]
  /** The most digits after the point among them (a sum shown without float noise). */
  digits: number
  cells: number
  filled: number
  skipped: number
}
export function columnCells(t: TableModel, c: number): ColumnCells {
  const out: ColumnCells = { numbers: [], digits: 0, cells: 0, filled: 0, skipped: 0 }
  t.rows.forEach((row, r) => {
    const m = coveredBy(t, r, c)
    // under a merge: its value, at its first row only
    if (m && r !== m.r) return
    out.cells++
    const s = (m ? t.rows[m.r][m.c] : row[c]) ?? ''
    if (!s.trim()) return
    out.filled++
    const v = cellNumber(s)
    if (v === undefined) return void out.skipped++
    out.numbers.push(v)
    out.digits = Math.max(out.digits, (String(v).split('.')[1] ?? '').length)
  })
  return out
}

// ---------- the totals ----------
/** A number as people write it: «1 234,5» (`digits` — after the point at most). */
export const fmtNumber = (v: number, digits = 10) => v.toLocaleString('ru-RU', { maximumFractionDigits: Math.min(10, digits) })
/** 0.1 + 0.2 — not 0.30000000000000004. */
const exact = (v: number, digits: number) => Number(v.toFixed(Math.min(10, digits)))

interface TotalDef {
  /** In the menu: its sign and what it is. */
  sign: string
  label: string
  /** Its value (undefined — nothing to show: no numbers, no cells). */
  value(x: ColumnCells): number | undefined
  /** Its value as shown under the column. */
  text(v: number, x: ColumnCells): string
}
const numbersNote = (x: ColumnCells) => `чисел: ${x.numbers.length}${x.skipped ? ` · пропущено нечисловых: ${x.skipped}` : ''}`
const sumOf = (x: ColumnCells) => x.numbers.reduce((a, b) => a + b, 0)
export const TOTAL_DEFS: Record<TotalKind, TotalDef> = {
  sum: { sign: 'Σ', label: 'Сумма', value: (x) => (x.numbers.length ? exact(sumOf(x), x.digits) : undefined), text: (v) => `Σ ${fmtNumber(v)}` },
  avg: { sign: 'x̄', label: 'Среднее', value: (x) => (x.numbers.length ? sumOf(x) / x.numbers.length : undefined), text: (v, x) => `x̄ ${fmtNumber(v, x.digits + 2)}` },
  min: { sign: 'min', label: 'Наименьшее', value: (x) => (x.numbers.length ? Math.min(...x.numbers) : undefined), text: (v) => `min ${fmtNumber(v)}` },
  max: { sign: 'max', label: 'Наибольшее', value: (x) => (x.numbers.length ? Math.max(...x.numbers) : undefined), text: (v) => `max ${fmtNumber(v)}` },
  count: { sign: 'N', label: 'Заполнено ячеек', value: (x) => x.filled, text: (v) => `N ${v}` },
  filled: { sign: '%', label: 'Доля заполненных', value: (x) => (x.cells ? (x.filled / x.cells) * 100 : undefined), text: (v) => `${Math.round(v)} %` },
}
/** A column's total as shown under it and its title (what it is, of what); undefined — nothing to show. */
export function columnTotal(t: TableModel, x: ColumnTotal): { value: number; text: string; title: string } | undefined {
  const cells = columnCells(t, x.c)
  const def = TOTAL_DEFS[x.kind]
  const value = def.value(cells)
  if (value === undefined) return undefined
  const of = x.kind === 'count' || x.kind === 'filled' ? `заполнено ${cells.filled} из ${cells.cells}` : numbersNote(cells)
  return { value, text: def.text(value, cells), title: `${def.label}: ${of}` }
}
/** A column's sum (its numbers; `skipped` — the cells with something else than a number). */
export function columnSum(t: TableModel, c: number): { sum: number; count: number; skipped: number } {
  const x = columnCells(t, c)
  return { sum: TOTAL_DEFS.sum.value(x) ?? 0, count: x.numbers.length, skipped: x.skipped }
}

// ---------- a column's total set; the totals following the columns ----------
/** The total under a column set (the same one again, or none — taken away). */
export function setColumnTotal(t: TableModel, c: number, kind: TotalKind | undefined): void {
  const rest = (t.totals ?? []).filter((x) => x.c !== c)
  const same = t.totals?.some((x) => x.c === c && x.kind === kind)
  t.totals = sortTotals([...rest, ...(kind && !same ? [{ c, kind }] : [])])
}
/** The column a total stands under → the total, or undefined. */
export const totalAt = (t: TableModel, c: number) => t.totals?.find((x) => x.c === c)
/** A column put at `at`: the totals right of it move. */
export function totalsColumnPut(t: TableModel, at: number): void {
  t.totals = t.totals?.map((x) => (x.c >= at ? { ...x, c: x.c + 1 } : x))
}
/** The column `at` deleted: its total goes, the ones right of it move. */
export function totalsColumnDeleted(t: TableModel, at: number): void {
  t.totals = sortTotals((t.totals ?? []).filter((x) => x.c !== at).map((x) => (x.c > at ? { ...x, c: x.c - 1 } : x)))
}
/** Only the totals of the first `n` columns kept. */
export function totalsFitted(t: TableModel, n: number): void {
  t.totals = sortTotals((t.totals ?? []).filter((x) => x.c < n))
}
const sortTotals = (xs: ColumnTotal[]) => (xs.length ? [...xs].sort((a, b) => a.c - b.c) : undefined)

// ---------- in the settings comment ----------
const isKind = (s: string): s is TotalKind => (TOTAL_KINDS as readonly string[]).includes(s)
/** `1,3:avg` → the totals of a table `n` columns wide (a bare column — a sum; one total a column, the first). */
export function parseTotals(s: string, n: number): ColumnTotal[] | undefined {
  const out: ColumnTotal[] = []
  for (const part of s.split(',')) {
    const [col, kind = 'sum'] = part.trim().split(':')
    const c = Number(col)
    if (Number.isInteger(c) && c >= 0 && c < n && isKind(kind) && !out.some((x) => x.c === c)) out.push({ c, kind })
  }
  return sortTotals(out)
}
/** The totals as the comment keeps them (a sum — its column alone, as before). */
export const totalsMd = (xs: ColumnTotal[], n: number) =>
  xs
    .filter((x) => x.c < n)
    .map((x) => (x.kind === 'sum' ? `${x.c}` : `${x.c}:${x.kind}`))
    .join(',')
