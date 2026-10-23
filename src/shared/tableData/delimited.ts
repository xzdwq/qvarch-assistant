import type { RowsColumn } from './api'
import { rectangular, type CellGrid } from './cellGrid'

/** Rows as CSV (RFC 4180: «,», quoted when needed; a BOM — Excel reads it as UTF-8). */
export function rowsCsv(columns: RowsColumn[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return `﻿${[columns.map((c) => esc(c.name)).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n')}\r\n`
}

/** The separators a delimited text may have, in the order they are tried (a tab — what spreadsheets copy). */
export const SEPARATORS = ['\t', ';', ','] as const
export type Separator = (typeof SEPARATORS)[number]

/**
 * The separator of a delimited text: the one that splits its first lines (outside quotes) into the same number of
 * cells, more than one; a tab wins a tie. None fits — a tab (one column).
 */
export function detectSeparator(text: string): Separator {
  const lines = splitRecords(text, '\n').slice(0, 20)
  let best: Separator = '\t'
  let bestCols = 1
  for (const sep of SEPARATORS) {
    const counts = lines.filter((l) => l.length).map((l) => splitRecords(l, sep).length)
    if (!counts.length) continue
    const cols = counts[0]
    if (cols > bestCols && counts.every((n) => n === cols)) ((best = sep), (bestCols = cols))
  }
  return best
}

/** A text cut at a separator outside quotes (quotes kept — the cell is read later). */
function splitRecords(text: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    if (ch === sep && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/**
 * A delimited text (CSV / TSV, what a spreadsheet copies) as a grid: RFC 4180 quotes — a cell in quotes may hold the
 * separator, line breaks and `""` (a quote); \r\n and \n end a row; a BOM is dropped; the line break that ends the
 * text makes no empty last row.
 */
export function parseDelimited(text: string, sep: Separator = detectSeparator(text)): CellGrid {
  const s = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch !== '"') cell += ch
      else if (s[i + 1] === '"') ((cell += '"'), i++)
      else quoted = false
    } else if (ch === '"' && !cell) quoted = true
    else if (ch === sep) ((row.push(cell), (cell = '')))
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) (row.push(cell), rows.push(row))
  return rectangular({ rows: rows.map((r) => r.map((c) => c.replace(/\r\n?/g, '\n'))), merges: [] })
}
