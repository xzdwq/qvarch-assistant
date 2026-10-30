import { existsSync, readdirSync, readFileSync, utimesSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { filePart, filesKeptOf, formatFor, isEmptyValue, valueFileName } from '../../src/shared/valueFiles'
import { testDir } from '../testTemp'

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\Users\\x\\Documents' }, BrowserWindow: {}, dialog: {}, shell: {} }))
const { ValueFiles } = await import('../../src/main/valueFiles')

describe('a value as a file: the rules', () => {
  it('the format by the value: rows — Excel, a text — .txt, the rest — JSON; asked — as asked', () => {
    expect(formatFor([{ a: 1 }, { a: 2 }], 'auto')).toBe('xlsx')
    expect(formatFor([[1, 2]], 'auto')).toBe('xlsx')
    expect(formatFor('лог', 'auto')).toBe('txt')
    expect(formatFor({ a: 1 }, 'auto')).toBe('json')
    expect(formatFor([1, 2, 3], 'auto')).toBe('json')
    expect(formatFor([{ a: 1 }], 'csv')).toBe('csv')
  })
  it('the name: «документ - переменная - дд.мм.гг чч-мм-сс», no colon, a partial one marked', () => {
    const at = new Date(2026, 9, 30, 17, 5, 3)
    expect(valueFileName('Отчёт', 'rows', at, 'xlsx')).toBe('Отчёт - rows - 30.10.26 17-05-03.xlsx')
    expect(valueFileName('Отчёт', 'rows', at, 'json', true)).toBe('Отчёт - rows - 30.10.26 17-05-03 (частично).json')
    expect(filePart('a:b/c*?"<>|d')).toBe('a_b_c_d')
    expect(filePart('   ')).toBe('_')
  })
  it('empty — nothing to keep; files=N read', () => {
    for (const v of [undefined, null, '', '  ', [], {}]) expect(isEmptyValue(v)).toBe(true)
    for (const v of [0, false, 'x', [0], { a: undefined }]) expect(isEmptyValue(v)).toBe(false)
    expect(filesKeptOf('30')).toBe(30)
    expect(filesKeptOf('0')).toBeUndefined()
    expect(filesKeptOf('все')).toBeUndefined()
  })
})

describe('a value as a file: written', () => {
  const files = new ValueFiles()
  const job = (dir: string, over: Record<string, unknown> = {}) => ({ note: 'Отчёт', name: 'rows', value: [{ id: 1, name: 'А', tags: ['x'] }, { id: 2, name: 'Б' }], format: 'xlsx' as const, dir, partial: false, ...over })

  it('Excel: rows and columns, numbers stay numbers, nested — JSON; JSON, text, CSV too', async () => {
    const dir = testDir('vf-')
    const x = await files.save(job(dir))
    expect(x.file && existsSync(x.file)).toBe(true)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(readFileSync(x.file!) as unknown as ArrayBuffer)
    const ws = wb.worksheets[0]
    expect(ws.getRow(1).values).toEqual([undefined, 'id', 'name', 'tags'])
    expect(ws.getRow(2).values).toEqual([undefined, 1, 'А', '["x"]'])
    expect(typeof ws.getRow(2).getCell(1).value).toBe('number')
    const j = await files.save(job(dir, { format: 'json' }))
    expect(JSON.parse(readFileSync(j.file!, 'utf8'))).toEqual(job(dir).value)
    const t = await files.save(job(dir, { format: 'txt', value: 'строка лога' }))
    expect(readFileSync(t.file!, 'utf8')).toBe('строка лога')
    const c = await files.save(job(dir, { format: 'csv' }))
    expect(readFileSync(c.file!, 'utf8')).toContain('id')
    // (nothing half-written left behind)
    expect(readdirSync(dir).some((n) => n.endsWith('.part'))).toBe(false)
  }, 30_000)
  it('the same value again — not written; changed, partial, another format — a new file', async () => {
    const dir = testDir('vf-')
    const a = await files.save(job(dir))
    const same = await files.save(job(dir, { lastHash: a.hash }))
    expect(same).toEqual({ hash: a.hash, unchanged: true })
    const changed = await files.save(job(dir, { lastHash: a.hash, value: [{ id: 3 }] }))
    expect(changed.unchanged).toBeUndefined()
    const partial = await files.save(job(dir, { lastHash: changed.hash, value: [{ id: 3 }], partial: true }))
    expect(partial.file).toMatch(/\(частично\)\.xlsx$/)
    const csv = await files.save(job(dir, { lastHash: partial.hash, value: [{ id: 3 }], format: 'csv' }))
    expect(csv.file).toMatch(/\.csv$/)
  })
  it('two in one second — « (2)»; files=N — only the newest N of this variable kept, others untouched', async () => {
    const dir = testDir('vf-')
    const made: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = await files.save(job(dir, { value: [{ i }] }))
      made.push(r.file!)
      const t = new Date(Date.now() - (10 - i) * 1000)
      utimesSync(r.file!, t, t)
    }
    expect(new Set(made).size).toBe(4)
    expect(made.some((f) => / \(2\)\.xlsx$/.test(f))).toBe(true)
    const other = await files.save(job(dir, { name: 'other', value: [{ z: 1 }] }))
    const r = await files.save(job(dir, { value: [{ i: 99 }], files: 2 }))
    expect(r.removed).toBe(3)
    const left = readdirSync(dir)
    expect(left.filter((n) => n.startsWith('Отчёт - rows - '))).toHaveLength(2)
    expect(left).toContain(other.file!.split(/[\\/]/).pop())
  })
  it('a folder not a full path — said so', async () => {
    await expect(files.save(job('exports'))).rejects.toThrow('нужен полный путь')
  })
})
