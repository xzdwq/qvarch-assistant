import type { CellGrid } from './cellGrid'
import type { ClipboardTable } from './clipboardGrid'

/** A column of rows saved as a file (its name; the rows are values: numbers stay numbers in Excel). */
export interface RowsColumn {
  name: string
}
/** Rows saved as a file: in what format, under what name (without its extension). */
export interface RowsExport {
  format: TableFileFormat
  name: string
  columns: RowsColumn[]
  rows: unknown[][]
}
/** The formats table files are written and read in. */
export const TABLE_FILE_FORMATS = ['xlsx', 'csv'] as const
export type TableFileFormat = (typeof TABLE_FILE_FORMATS)[number]

/** A sheet of a file read: its name, its grid, whether it was cut at the limit. */
export interface ImportedSheet {
  name: string
  grid: CellGrid
  /** Rows / columns past the limit were left out. */
  truncated?: boolean
}
/** A table file read: its name and its sheets (a CSV — one); or why it could not be. */
export type ImportedBook = { ok: true; name: string; sheets: ImportedSheet[] } | { ok: false; error: string }

/** How much of a sheet is read at most (a table of a note, not a database). */
export const IMPORT_LIMITS = { rows: 5000, cols: 200 } as const

/** Table files as the page calls them (window.qa.tableFile(method, …)). */
export interface TableFileApi {
  /** Rows saved as a file (the system's «save as»); the file's path, or nothing when cancelled. */
  exportRows(x: RowsExport): Promise<string | undefined>
  /** A table file chosen (the system's «open») and read: Excel (.xlsx), CSV / TSV; cancelled — undefined. */
  importFile(): Promise<ImportedBook | undefined>
  /** What the clipboard holds (its HTML and its plain text) — for a paste asked from a menu, not by Ctrl+V. */
  readClipboard(): Promise<ClipboardTable>
}
export const TABLE_FILE_METHODS = ['exportRows', 'importFile', 'readClipboard'] as const
