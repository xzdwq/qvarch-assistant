import { describe, expect, it } from 'vitest'
import { cellNumber, columnSum, columnTotal, deleteColAt, deleteRowAt, insertRowAt, mergeCells, parseTable, tableMd, type TableModel, type TotalKind } from '../src/notebook/blocks/table/model'

const table = (rows: string[][]): TableModel => ({ head: rows[0].map((_, i) => `C${i}`), rows, align: rows[0].map(() => undefined) })

describe('a cell as a number', () => {
  it('both fraction marks, spaces between thousands, a sign', () => {
    expect(cellNumber('1 234,5')).toBe(1234.5)
    expect(cellNumber('1234.5')).toBe(1234.5)
    expect(cellNumber('-12')).toBe(-12)
    expect(cellNumber('1,234.50')).toBe(1234.5)
    expect(cellNumber('1.234,50')).toBe(1234.5)
    expect(cellNumber('1 000')).toBe(1000)
    expect(cellNumber(',5')).toBe(0.5)
  })
  it('anything else is not a number (skipped, never an error)', () => {
    for (const s of ['', 'abc', '12 шт', '1-2', '1e5x', '—', '1,2,3a', '$5']) expect(cellNumber(s)).toBeUndefined()
  })
})

describe('a column sum', () => {
  it('the numbers only; the rest counted as skipped; no float noise', () => {
    const t = table([['0,1', 'x'], ['0.2', ''], ['текст', ''], ['', '']])
    expect(columnSum(t, 0)).toEqual({ sum: 0.3, count: 2, skipped: 1 })
  })
  it('a merged cell counts in every column it spans — once, not once per row', () => {
    // as in the picture: «33» over columns 2 and 3
    const t = table([['1', '33', '', '234'], ['2', '2', '2.3', ''], ['1', '2', '3', '1']])
    mergeCells(t, 0, 1, 0, 2)
    expect(columnSum(t, 1).sum).toBe(37)
    expect(columnSum(t, 2).sum).toBe(38.3)
    // a merge down two rows counts once in its column
    mergeCells(t, 0, 3, 1, 3)
    expect(columnSum(t, 3).sum).toBe(235)
  })
  it('merging keeps the first value only (as Excel)', () => {
    const t = table([['', '5'], ['7', '9']])
    mergeCells(t, 0, 0, 1, 1)
    expect(t.rows[0][0]).toBe('5')
    expect(t.rows.flat().filter(Boolean)).toEqual(['5'])
  })
})

describe('a column\'s totals', () => {
  const t = () => table([['1,5'], ['текст'], [''], ['3'], ['-2']])
  const text = (x: TableModel, kind: TotalKind) => columnTotal(x, { c: 0, kind })?.text
  it('average, least, greatest — of the numbers; filled cells and their part — of all', () => {
    expect(text(t(), 'avg')).toBe('x̄ 0,833')
    expect(text(t(), 'min')).toBe('min -2')
    expect(text(t(), 'max')).toBe('max 3')
    expect(text(t(), 'count')).toBe('N 4')
    expect(text(t(), 'filled')).toBe('80 %')
  })
  it('no numbers — no average (nothing shown); no rows — no part', () => {
    expect(columnTotal(table([['a'], ['']]), { c: 0, kind: 'avg' })).toBeUndefined()
    expect(columnTotal({ head: ['A'], rows: [], align: [undefined] }, { c: 0, kind: 'filled' })).toBeUndefined()
  })
  it('kept in the comment: a sum — its column alone (as before), the rest named; unknown ones left out', () => {
    const x = parseTable('<!-- qa:table sums=0,1:avg,2:nope,1:max -->\n| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |')
    expect(x.totals).toEqual([
      { c: 0, kind: 'sum' },
      { c: 1, kind: 'avg' },
    ])
    expect(tableMd(x).split('\n')[0]).toBe('<!-- qa:table sums=0,1:avg -->')
  })
})

describe('merged cells', () => {
  it('kept in the comment over the table and read back', () => {
    const t = table([['a', 'b'], ['c', 'd']])
    mergeCells(t, 0, 0, 1, 0)
    t.totals = [{ c: 1, kind: 'sum' }]
    const md = tableMd(t)
    expect(md.split('\n')[0]).toBe('<!-- qa:table sums=1 merge=0.0.2.1 -->')
    const back = parseTable(md)
    expect(back.merges).toEqual([{ r: 0, c: 0, rs: 2, cs: 1 }])
    expect(back.totals).toEqual([{ c: 1, kind: 'sum' }])
    expect(back.rows[0][0]).toBe('a')
  })
  it('the old comment with widths only still reads', () => {
    expect(parseTable('<!-- qa:table widths=120,0 -->\n| a | b |\n| - | - |\n| 1 | 2 |').widths).toEqual([120, 0])
  })
  it('a selection touching a merge takes all of it', () => {
    const t = table([['a', 'b', 'c'], ['d', 'e', 'f']])
    mergeCells(t, 0, 1, 1, 1)
    mergeCells(t, 0, 0, 0, 1)
    expect(t.merges).toEqual([{ r: 0, c: 0, rs: 2, cs: 2 }])
  })
  it('rows put in / deleted: the merges move, grow, shrink', () => {
    const t = table([['a', ''], ['', ''], ['x', 'y']])
    mergeCells(t, 0, 0, 1, 1)
    insertRowAt(t, 1)
    expect(t.merges).toEqual([{ r: 0, c: 0, rs: 3, cs: 2 }])
    insertRowAt(t, 0)
    expect(t.merges).toEqual([{ r: 1, c: 0, rs: 3, cs: 2 }])
    deleteRowAt(t, 1) // the merge's first row: its text goes down
    expect(t.merges).toEqual([{ r: 1, c: 0, rs: 2, cs: 2 }])
    expect(t.rows[1][0]).toBe('a')
    deleteColAt(t, 1)
    expect(t.merges).toEqual([{ r: 1, c: 0, rs: 2, cs: 1 }])
    deleteRowAt(t, 2)
    expect(t.merges).toBeUndefined()
  })
})
