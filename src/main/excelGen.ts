import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import vm from 'node:vm'
import ExcelJS from 'exceljs'
import { exprToGen, gen } from '../shared/gen'
import type { Cell, XFile } from '../shared/excelGen'

// one sandbox for every value, each expression compiled once (a big file — tens of thousands of cells)
const sandbox = vm.createContext({ gen })
const compiled = new Map<string, vm.Script>()
/** A value made by its expression (a literal, gen.…, one's own JS over gen) — as text. */
export function makeValue(expr: string): string {
  const code = `(${expr || "''"})`
  let s = compiled.get(code)
  if (!s) {
    s = new vm.Script(code)
    if (compiled.size > 500) compiled.clear()
    compiled.set(code, s)
  }
  // (a timeout costs a watchdog per call: only one's own JS gets it — a generator always ends)
  const v = (exprToGen(expr).id === 'code' ? s.runInContext(sandbox, { timeout: 200 }) : s.runInContext(sandbox)) as unknown
  return v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
}
const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
const asText = (c: Cell) => (c.v === null ? '' : c.v instanceof Date ? dmy(c.v) : String(c.v))

/** A file's bytes: CSV (; — as Excel in Russian opens it, UTF-8 with its mark) or XLSX (cells by their types). */
export async function fileBytes(f: XFile, format: 'xlsx' | 'csv'): Promise<Uint8Array> {
  if (format === 'csv') {
    const s = f.sheets[f.sheets.length - 1]
    const cell = (t: string) => (/[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t)
    const text = [s.header, ...s.rows.map((r) => r.map(asText))].map((r) => r.map(cell).join(';')).join('\r\n')
    return new Uint8Array(Buffer.from(`﻿${text}\r\n`, 'utf8'))
  }
  const wb = new ExcelJS.Workbook()
  for (const s of f.sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31) || 'Лист1')
    if (s.header.length) {
      const h = ws.addRow(s.header)
      h.font = { bold: true }
    }
    for (const r of s.rows) {
      const row = ws.addRow(r.map((c) => (c.v === null ? null : s.asText ? asText(c) : c.v)))
      r.forEach((c, i) => {
        if (!s.asText && c.v instanceof Date) row.getCell(i + 1).numFmt = 'dd.mm.yyyy'
      })
    }
    // the columns as wide as their texts (at most 50)
    s.header.forEach((h, i) => {
      const w = Math.max(h.length, ...s.rows.slice(0, 200).map((r) => asText(r[i] ?? { v: null, t: 'text' }).length))
      ws.getColumn(i + 1).width = Math.min(50, Math.max(8, w + 2))
    })
  }
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** A template's header and first rows (xlsx — its first sheet with data; csv — its separator found). */
export async function readTemplate(path: string): Promise<{ sheet: string; headers: string[]; samples: string[][] }> {
  if (/^\.(csv|txt)$/i.test(extname(path))) {
    const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    const sep = [';', '\t', ','].sort((a, b) => (lines[0]?.split(b).length ?? 0) - (lines[0]?.split(a).length ?? 0))[0]
    const split = (l: string) => l.split(sep).map((x) => x.replace(/^"|"$/g, '').replace(/""/g, '"'))
    return { sheet: 'Лист1', headers: split(lines[0] ?? ''), samples: lines.slice(1, 6).map(split) }
  }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0]
  if (!ws) throw new Error('В файле нет листов')
  const text = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return ''
    if (v instanceof Date) return dmy(v)
    if (typeof v === 'object') {
      const o = v as { text?: string; result?: unknown; richText?: Array<{ text: string }> }
      if (o.richText) return o.richText.map((t) => t.text).join('')
      if (o.text !== undefined) return String(o.text)
      if (o.result !== undefined) return String(o.result)
      return ''
    }
    return String(v)
  }
  const rows: string[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length >= 6) return
    const vals = (row.values as ExcelJS.CellValue[]).slice(1)
    rows.push(vals.map(text))
  })
  const headers = rows[0] ?? []
  return { sheet: ws.name, headers, samples: rows.slice(1).map((r) => headers.map((_, i) => r[i] ?? '')) }
}
