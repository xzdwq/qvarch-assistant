import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { makeFiles, type XSpec } from '../src/shared/excelGen'
import { fileBytes, makeValue, readTemplate } from '../src/main/excelGen'

const spec: XSpec = {
  name: 'товары',
  rows: 3,
  format: 'xlsx',
  sheet: 'Товары',
  columns: [
    { title: 'Наименование', expr: 'gen.words(2)', type: 'auto', required: true, unique: true },
    { title: 'Количество', expr: 'gen.int(1, 9)', type: 'auto', required: true, unique: false },
    { title: 'Дата', expr: "gen.date(0, 'dd.MM.yyyy')", type: 'auto', required: false, unique: false },
  ],
}
const dir = mkdtempSync(join(tmpdir(), 'qa-xlsx-'))
// (nothing left in the temp folder)
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const save = async (i: number, format: 'xlsx' | 'csv' = 'xlsx') => {
  const files = makeFiles({ ...spec, format }, ['sheet2', 'textnum'], makeValue)
  const p = join(dir, `${i}.${format}`)
  writeFileSync(p, await fileBytes(files[i], format))
  return p
}

describe('Excel: the files written and read back', () => {
  it('xlsx: the header, numbers as numbers, dates as dates', async () => {
    const p = await save(0)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(p)
    const ws = wb.getWorksheet('Товары')!
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(['Наименование', 'Количество', 'Дата'])
    expect(typeof ws.getRow(2).getCell(2).value).toBe('number')
    expect(ws.getRow(2).getCell(3).value).toBeInstanceOf(Date)
    expect(ws.rowCount).toBe(4)
    const t = await readTemplate(p)
    expect(t.headers).toEqual(['Наименование', 'Количество', 'Дата'])
    expect(t.samples).toHaveLength(3)
    expect(t.samples[0][2]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/)
  })
  it('the data on the second sheet — found there; numbers as text — text cells', async () => {
    // (the files go in the faults' order: numbers as text, then the second sheet)
    const t = await readTemplate(await save(2))
    expect(t.sheet).toBe('Товары')
    expect(t.headers).toEqual(['Наименование', 'Количество', 'Дата'])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(await save(1))
    expect(typeof wb.worksheets[0].getRow(2).getCell(2).value).toBe('string')
  })
  it('csv: «;», the BOM, read back', async () => {
    const t = await readTemplate(await save(0, 'csv'))
    expect(t.headers).toEqual(['Наименование', 'Количество', 'Дата'])
    expect(t.samples).toHaveLength(3)
  })
})
