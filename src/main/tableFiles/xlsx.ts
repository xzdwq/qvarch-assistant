import type { Cell, Worksheet } from 'exceljs'
import { gridFromRanges, IMPORT_LIMITS, trimGrid, type ImportedSheet, type RowsColumn } from '../../shared/tableData'

/** exceljs, loaded when a file is first written / read (it is big). */
const excel = async () => (await import('exceljs')).default

/**
 * Rows as an Excel workbook: a header row (bold, frozen, a filter on it), the columns as wide as their contents
 * (within reason); numbers stay numbers, an object goes as its JSON.
 */
export async function rowsXlsx(columns: RowsColumn[], rows: unknown[][]): Promise<Buffer> {
  const ExcelJS = await excel()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Результат', { views: [{ state: 'frozen', ySplit: 1 }] })
  const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  ws.columns = columns.map((c, i) => ({ header: c.name, key: `c${i}`, width: Math.min(60, Math.max(10, c.name.length + 2, ...rows.slice(0, 200).map((r) => text(r[i]).length + 2))) }))
  ws.getRow(1).font = { bold: true }
  for (const r of rows) ws.addRow(r.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)))
  if (columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** A date as a person reads it in a sheet: ДД.ММ.ГГГГ, with the time when the cell has one (Excel's dates are UTC). */
function dateText(d: Date, numFmt: string | undefined): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const day = `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
  const hasTime = /[hH]/.test(numFmt ?? '') || d.getUTCHours() || d.getUTCMinutes()
  return hasTime ? `${day} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : day
}
/** A cell's text as the sheet shows it (a formula — its result, rich text — its letters, a date — formatted). */
function cellText(cell: Cell): string {
  const v = cell.value
  if (v instanceof Date) return dateText(v, cell.numFmt)
  const result = v && typeof v === 'object' && 'result' in v ? v.result : undefined
  if (result instanceof Date) return dateText(result, cell.numFmt)
  return cell.text ?? ''
}

/** "A1" → its 0-based row and column. */
function refAt(ref: string): { r: number; c: number } | undefined {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref.trim())
  if (!m) return undefined
  const c = [...m[1].toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
  return { r: Number(m[2]) - 1, c }
}
/** A sheet's merged ranges ("A1:C2") as 0-based bounds. */
function mergeRanges(ws: Worksheet): Array<{ top: number; left: number; bottom: number; right: number }> {
  const list = ((ws.model as { merges?: string[] }).merges ?? []).map((s) => s.split(':').map(refAt))
  return list.filter(([a, b]) => a && b).map(([a, b]) => ({ top: a!.r, left: a!.c, bottom: b!.r, right: b!.c }))
}

/** A sheet as a grid (its used range, cut at the limits), its merged cells kept. */
function sheetOf(ws: Worksheet): ImportedSheet {
  const height = Math.min(ws.rowCount, IMPORT_LIMITS.rows)
  const width = Math.min(ws.columnCount, IMPORT_LIMITS.cols)
  const values = Array.from({ length: height }, (_, r) => {
    const row = ws.getRow(r + 1)
    return Array.from({ length: width }, (_, c) => cellText(row.getCell(c + 1)))
  })
  const ranges = mergeRanges(ws).filter((g) => g.top < height && g.left < width).map((g) => ({ ...g, bottom: Math.min(g.bottom, height - 1), right: Math.min(g.right, width - 1) }))
  return { name: ws.name, grid: trimGrid(gridFromRanges(values, ranges)), truncated: ws.rowCount > height || ws.columnCount > width || undefined }
}

/** An Excel workbook's sheets (the hidden ones left out — unless all are). */
export async function readXlsx(data: Buffer): Promise<ImportedSheet[]> {
  const ExcelJS = await excel()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data as unknown as ArrayBuffer)
  const shown = wb.worksheets.filter((ws) => ws.state === 'visible' || !ws.state)
  return (shown.length ? shown : wb.worksheets).map(sheetOf)
}
