/**
 * A grid of cells as any table source gives it (an Excel sheet, a CSV file, what was copied from a spreadsheet): rows
 * of texts, and its merged regions — one text over several cells, kept in the region's first cell (the other cells
 * of the region are empty). Every source is turned into this; a table takes only this.
 */

/** A merged region: from row `r`, column `c` — `rs` rows, `cs` columns. */
export interface GridMerge {
  r: number
  c: number
  rs: number
  cs: number
}
export interface CellGrid {
  /** Rows of the same length (a missing cell — ''). */
  rows: string[][]
  merges: GridMerge[]
}
/** A cell of a source that knows spans (an HTML table: rowspan / colspan). */
export interface SpanCell {
  text: string
  rowSpan?: number
  colSpan?: number
}

/** A positive whole span, 1 at least (a broken attribute — 1). */
const spanOf = (n: number | undefined) => (Number.isInteger(n) && n! > 1 ? n! : 1)

/**
 * The cells of rows that know spans laid out as an HTML table lays them: each cell takes the first column not held by a
 * span from above; a span past the last row ends at it.
 */
export function layoutSpans(rows: readonly (readonly SpanCell[])[]): CellGrid {
  const out: string[][] = rows.map(() => [])
  /** taken[r][c] — the cell is held (by a cell or a span over it) */
  const taken: boolean[][] = rows.map(() => [])
  const merges: GridMerge[] = []
  rows.forEach((cells, r) => {
    let c = 0
    for (const cell of cells) {
      while (taken[r][c]) c++
      const rs = Math.min(spanOf(cell.rowSpan), rows.length - r)
      const cs = spanOf(cell.colSpan)
      for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) taken[y][x] = true
      out[r][c] = cell.text
      if (rs * cs > 1) merges.push({ r, c, rs, cs })
      c += cs
    }
  })
  return rectangular({ rows: out, merges })
}

/** A sheet's values and its merged ranges (0-based, inclusive) as a grid: the text of a range — its first cell's. */
export function gridFromRanges(values: readonly (readonly string[])[], ranges: ReadonlyArray<{ top: number; left: number; bottom: number; right: number }>): CellGrid {
  const rows = values.map((r) => [...r])
  const merges: GridMerge[] = []
  for (const g of ranges) {
    const m = { r: g.top, c: g.left, rs: g.bottom - g.top + 1, cs: g.right - g.left + 1 }
    if (m.rs * m.cs < 2 || m.r < 0 || m.c < 0) continue
    // (the region's other cells — empty, as Excel shows them)
    for (let y = m.r; y < m.r + m.rs; y++) for (let x = m.c; x < m.c + m.cs; x++) if ((y !== m.r || x !== m.c) && rows[y]) rows[y][x] = ''
    merges.push(m)
  }
  return rectangular({ rows, merges })
}

/** Every row as long as the longest (holes and missing cells — ''), every merge inside the grid. */
export function rectangular(g: CellGrid): CellGrid {
  const width = Math.max(0, ...g.rows.map((r) => r.length), ...g.merges.map((m) => m.c + m.cs))
  const rows = g.rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
  const merges = g.merges.filter((m) => m.r < rows.length).map((m) => ({ ...m, rs: Math.min(m.rs, rows.length - m.r) }))
  return { rows, merges: merges.filter((m) => m.rs * m.cs > 1) }
}

/**
 * Empty rows and columns at the end cut off (a sheet's used range often reaches past its data; a copied block ends
 * with a line break); a merge holds what it covers.
 */
export function trimGrid(g: CellGrid): CellGrid {
  const holds = (r: number, c: number) => g.rows[r]?.[c]?.trim() || g.merges.some((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs)
  let height = g.rows.length
  let width = g.rows[0]?.length ?? 0
  const rowUsed = (r: number) => Array.from({ length: width }, (_, c) => c).some((c) => holds(r, c))
  const colUsed = (c: number) => Array.from({ length: height }, (_, r) => r).some((r) => holds(r, c))
  while (height > 0 && !rowUsed(height - 1)) height--
  while (width > 0 && !colUsed(width - 1)) width--
  return { rows: g.rows.slice(0, height).map((r) => r.slice(0, width)), merges: g.merges.filter((m) => m.r < height && m.c < width) }
}

/** The grid has no text at all (an empty paste, an empty sheet). */
export const isEmptyGrid = (g: CellGrid) => !g.rows.some((r) => r.some((c) => c.trim()))
