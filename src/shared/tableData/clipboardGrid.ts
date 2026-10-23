import { layoutSpans, trimGrid, type CellGrid } from './cellGrid'
import { parseDelimited } from './delimited'
import { htmlTableCells } from './htmlTable'

/** What the clipboard holds of a copied table: its HTML (spans — merged cells) and its plain text (TSV). */
export interface ClipboardTable {
  html?: string
  text?: string
}

/**
 * What was copied as a grid: the HTML's table first (it knows merged cells), else the plain text as a spreadsheet
 * copies it — cells by tabs, rows by lines (a comma or a semicolon in copied text is text, not a column); nothing —
 * undefined. Trailing empty rows / columns cut off.
 */
export function gridFromClipboard(clip: ClipboardTable): CellGrid | undefined {
  const cells = clip.html ? htmlTableCells(clip.html) : undefined
  if (cells) return trimGrid(layoutSpans(cells))
  if (!clip.text?.trim()) return undefined
  return trimGrid(parseDelimited(clip.text, '\t'))
}

/**
 * The clipboard holds a table — cells copied from a spreadsheet (a table in its HTML, or tabs in its text), more
 * than one: a paste of it fills cells. Anything else (a line, a paragraph) is typed into the cell as it is.
 */
export function isTableClipboard(clip: ClipboardTable): boolean {
  const hasTable = (clip.html && htmlTableCells(clip.html)) || clip.text?.includes('\t')
  if (!hasTable) return false
  const g = gridFromClipboard(clip)
  return !!g && (g.rows.length > 1 || (g.rows[0]?.length ?? 0) > 1)
}
