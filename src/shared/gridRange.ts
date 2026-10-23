/**
 * The table core's cell ranges and copying, shared by every table of the notebook (a note's table, a query's
 * rows, a loop's rows): a chosen rectangle of cells, and cells as Excel takes them from the clipboard.
 */

/** A rectangle of cells from one corner (r0, c0) to the other (r1, c1), in any direction. */
export interface CellRange {
  r0: number
  c0: number
  r1: number
  c1: number
}
/** The rectangle's edges, top-left to bottom-right. */
export function rangeBounds(x: CellRange): { top: number; bottom: number; left: number; right: number } {
  return { top: Math.min(x.r0, x.r1), bottom: Math.max(x.r0, x.r1), left: Math.min(x.c0, x.c1), right: Math.max(x.c0, x.c1) }
}
/** Is the cell inside the rectangle (none — no). */
export function rangeHas(x: CellRange | undefined, r: number, c: number): boolean {
  if (!x) return false
  const b = rangeBounds(x)
  return r >= b.top && r <= b.bottom && c >= b.left && c <= b.right
}
/** How many cells the rectangle holds (none — 0). */
export const rangeSize = (x: CellRange | undefined) => (x ? (Math.abs(x.r1 - x.r0) + 1) * (Math.abs(x.c1 - x.c0) + 1) : 0)

/** A cell for the clipboard: its own tabs / line breaks / quotes would cut it apart — quoted as Excel quotes them. */
export const tsvCell = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
/** Rows as Excel takes them: tab between the columns, a new line between the rows. */
export const tsvRows = (rows: string[][]) => rows.map((r) => r.map(tsvCell).join('\t')).join('\n')
