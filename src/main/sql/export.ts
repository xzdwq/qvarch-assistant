import type { SqlColumn } from '../../shared/sql'

/**
 * A query's rows as an Excel workbook: a header row (bold, frozen, a filter on it), the columns as wide as their
 * contents (within reason); numbers stay numbers, an object goes as its JSON.
 */
export async function rowsXlsx(columns: SqlColumn[], rows: unknown[][]): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Результат', { views: [{ state: 'frozen', ySplit: 1 }] })
  const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  ws.columns = columns.map((c, i) => ({ header: c.name, key: `c${i}`, width: Math.min(60, Math.max(10, c.name.length + 2, ...rows.slice(0, 200).map((r) => text(r[i]).length + 2))) }))
  ws.getRow(1).font = { bold: true }
  for (const r of rows) ws.addRow(r.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)))
  if (columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  return Buffer.from(await wb.xlsx.writeBuffer())
}
