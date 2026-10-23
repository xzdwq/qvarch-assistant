import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { readXlsx } from '../../src/main/tableFiles/xlsx'
import { decodeText, readDelimited } from '../../src/main/tableFiles/delimitedFile'

/** A workbook as a person makes it: a merged head, a date, a formula, a hidden sheet. */
async function workbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Заказы')
  ws.addRow(['Заказ', null, 'Сумма'])
  ws.addRow([1, 'Иванов', 10])
  ws.addRow([2, 'Петров', { formula: 'C2*2', result: 20 }])
  ws.addRow([new Date(Date.UTC(2026, 0, 31)), 'дата', null])
  ws.mergeCells('A1:B1')
  ws.mergeCells('C1:C1')
  wb.addWorksheet('Скрытый', { state: 'hidden' }).addRow(['x'])
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('an Excel file read', () => {
  it('its shown sheets, merged cells, formulas by result, dates as read', async () => {
    const sheets = await readXlsx(await workbook())
    expect(sheets.map((s) => s.name)).toEqual(['Заказы'])
    const g = sheets[0].grid
    expect(g.rows).toEqual([
      ['Заказ', '', 'Сумма'],
      ['1', 'Иванов', '10'],
      ['2', 'Петров', '20'],
      ['31.01.2026', 'дата', ''],
    ])
    expect(g.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 2 }])
  })
})

describe('a text file read', () => {
  it('UTF-8 (with or without a BOM), else Windows-1251', () => {
    expect(decodeText(new TextEncoder().encode('﻿имя'))).toBe('имя')
    expect(decodeText(new TextEncoder().encode('имя'))).toBe('имя')
    expect(decodeText(Uint8Array.from([0xe8, 0xec, 0xff]))).toBe('имя')
  })
  it('a CSV as one sheet named by the file', () => {
    const [s] = readDelimited(new TextEncoder().encode('a;b\n1;2'), 'данные')
    expect(s.name).toBe('данные')
    expect(s.grid.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})
