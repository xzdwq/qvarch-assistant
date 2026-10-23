/**
 * A table's merged cells: one text over several cells, kept in the region's first cell. The body's merges span rows
 * and columns; the head's (row -1) — columns only. What changes the table's shape (a row / column put or deleted)
 * moves, grows or shrinks them here.
 */
import type { Merge, TableModel } from './model'
import { totalsColumnDeleted, totalsColumnPut } from './modelTotals'

/** A cell's text: row -1 — the head. */
export const cellAt = (t: TableModel, r: number, c: number) => (r < 0 ? t.head[c] : (t.rows[r]?.[c] ?? ''))
/** A cell's text set: row -1 — the head. */
export function setCellAt(t: TableModel, r: number, c: number, v: string): void {
  if (r < 0) t.head[c] = v
  else if (t.rows[r]) t.rows[r][c] = v
}
export const overlaps = (a: Merge, b: Merge) => a.r < b.r + b.rs && b.r < a.r + a.rs && a.c < b.c + b.cs && b.c < a.c + a.cs
/** The cell at (r, c) is hidden under another one's merge (row -1 — the head). */
export function coveredBy(t: TableModel, r: number, c: number): Merge | undefined {
  return t.merges?.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs && !(r === m.r && c === m.c))
}
/** The merge whose first cell is (r, c). */
export const mergeAt = (t: TableModel, r: number, c: number) => t.merges?.find((m) => m.r === r && m.c === c)
/** The table has merged cells in its body (rows held together — they are not sorted). */
export const hasBodyMerges = (t: TableModel) => !!t.merges?.some((m) => m.r >= 0)

/** Merges the rectangle of the body (the cells inside other merges join it); as in Excel, only the first value stays (the first non-empty one, row by row). */
export function mergeCells(t: TableModel, r0: number, c0: number, r1: number, c1: number): void {
  // (the head merges by columns only — a rectangle reaching into it is not merged)
  if (Math.min(r0, r1) < 0) return
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
/** A row put at `at` (0 — the first of the body): the merges below move, the ones across grow (the head's stay). */
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
/** A column put at `at`: the merges right of it move, the ones across grow, the totals follow their columns. */
export function insertColAt(t: TableModel, at: number): void {
  for (const r of t.rows) r.splice(at, 0, '')
  t.merges = t.merges?.map((m) => (m.c >= at ? { ...m, c: m.c + 1 } : m.c + m.cs > at ? { ...m, cs: m.cs + 1 } : m))
  totalsColumnPut(t, at)
}
/**
 * The column `at` deleted from the body (the head is the caller's — after this): the merges across shrink (a merge's
 * first column deleted — its text goes to the next one, the head's too), its total goes.
 */
export function deleteColAt(t: TableModel, at: number): void {
  const out: Merge[] = []
  for (const m of t.merges ?? []) {
    if (m.c > at) out.push({ ...m, c: m.c - 1 })
    else if (m.c + m.cs <= at) out.push(m)
    else {
      if (m.c === at && m.cs > 1) setCellAt(t, m.r, at + 1, cellAt(t, m.r, at))
      const n = { ...m, cs: m.cs - 1 }
      if (n.rs * n.cs > 1) out.push(n)
    }
  }
  for (const r of t.rows) r.splice(at, 1)
  t.merges = out.length ? out : undefined
  totalsColumnDeleted(t, at)
}
