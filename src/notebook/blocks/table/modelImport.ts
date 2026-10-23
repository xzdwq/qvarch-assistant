/**
 * Cells from outside into a table — a sheet imported, a block copied from a spreadsheet pasted. Both go one way: the
 * table as a grid (its head — row 0), the cells laid over it, the grid back as a table. Merged cells come along.
 */
import { rectangular, type CellGrid, type GridMerge } from '../../../shared/tableData'
import { type Merge, type TableModel } from './model'
import { totalsFitted } from './modelTotals'

/** A generated column name (as a new table and a new column have). */
const columnName = (i: number) => `Столбец ${i + 1}`

/** The table as a grid: the head — its first row, the merges by rows of the grid. */
export function tableGrid(t: TableModel): CellGrid {
  return { rows: [t.head, ...t.rows].map((r) => [...r]), merges: (t.merges ?? []).map((m) => ({ ...m, r: m.r + 1 })) }
}

/**
 * A grid laid over another from cell (r, c): the cells it covers take its text, the merges it touches go (theirs
 * now), its merges come; the grid grows to hold it.
 */
export function overlayGrid(base: CellGrid, top: CellGrid, at: { r: number; c: number }): CellGrid {
  const height = top.rows.length
  const width = top.rows[0]?.length ?? 0
  const rows = base.rows.map((r) => [...r])
  for (let y = 0; y < height; y++) {
    const row = (rows[at.r + y] ??= [])
    for (let x = 0; x < width; x++) row[at.c + x] = top.rows[y][x] ?? ''
  }
  const area: GridMerge = { r: at.r, c: at.c, rs: height, cs: width }
  const touches = (m: GridMerge) => m.r < area.r + area.rs && area.r < m.r + m.rs && m.c < area.c + area.cs && area.c < m.c + m.cs
  const merges = [...base.merges.filter((m) => !touches(m)), ...top.merges.map((m) => ({ ...m, r: m.r + at.r, c: m.c + at.c }))]
  return rectangular({ rows, merges })
}

/**
 * A grid as a table's head and body. With a head row — row 0 is the head: a merge of it across columns stays the
 * head's; one down into the body is cut at the head's edge (the head keeps the text, the rest of it — a merge of
 * the body, when still more than one cell). Without one — the head is made («Столбец N»), every row is the body's.
 */
export function tableShape(grid: CellGrid, headRow: boolean): Pick<TableModel, 'head' | 'rows' | 'merges'> {
  const width = Math.max(1, grid.rows[0]?.length ?? 0)
  if (!headRow) {
    const merges = grid.merges.map((m) => ({ ...m }))
    return { head: Array.from({ length: width }, (_, i) => columnName(i)), rows: grid.rows.map((r) => [...r]), merges: merges.length ? merges : undefined }
  }
  const head = Array.from({ length: width }, (_, i) => grid.rows[0]?.[i] ?? '')
  const rows = grid.rows.slice(1).map((r) => [...r])
  const merges: Merge[] = []
  for (const m of grid.merges) {
    if (m.r > 0) {
      merges.push({ ...m, r: m.r - 1 })
      continue
    }
    if (m.cs > 1) merges.push({ r: -1, c: m.c, rs: 1, cs: m.cs })
    const rest = { r: 0, c: m.c, rs: m.rs - 1, cs: m.cs }
    if (rest.rs * rest.cs > 1) merges.push(rest)
  }
  return { head, rows: rows.length ? rows : [head.map(() => '')], merges: merges.length ? merges : undefined }
}

/** The columns' own settings fitted to `n` columns (alignment and widths kept for the ones still there, totals inside). */
function fitColumns(t: TableModel, n: number): void {
  t.align = Array.from({ length: n }, (_, i) => t.align[i])
  if (t.widths) t.widths = Array.from({ length: n }, (_, i) => t.widths?.[i] ?? 0)
  totalsFitted(t, n)
}

/**
 * The table replaced by a grid (a sheet imported): its rows, head and merges; alignment, widths and sums kept for
 * the columns still there. A table filled from a variable is its own after this (the variable let go).
 */
export function importGrid(t: TableModel, grid: CellGrid, headRow: boolean): void {
  Object.assign(t, tableShape(grid, headRow))
  fitColumns(t, t.head.length)
  t.from = undefined
  t.filled = undefined
  t.srcHash = undefined
}

/**
 * A grid pasted from a cell of the table (row -1 — the head) as Excel pastes: the cells it covers take its text,
 * merges come with it, the table grows to hold it — a column made for it gets a name.
 */
export function pasteGrid(t: TableModel, grid: CellGrid, at: { r: number; c: number }): void {
  const before = t.head.length
  const shaped = tableShape(overlayGrid(tableGrid(t), grid, { r: at.r + 1, c: at.c }), true)
  t.head = shaped.head.map((h, i) => (i >= before && !h ? columnName(i) : h))
  t.rows = shaped.rows
  t.merges = shaped.merges
  fitColumns(t, t.head.length)
}

/** A table nobody has filled yet (its head the made names or empty, its cells empty) — a paste into it asks how. */
export function isBlankTable(t: TableModel): boolean {
  return t.head.every((h, i) => !h.trim() || h === columnName(i)) && t.rows.every((r) => r.every((c) => !c.trim()))
}
