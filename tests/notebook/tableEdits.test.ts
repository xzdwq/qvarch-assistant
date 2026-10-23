import { describe, expect, it } from 'vitest'
import { addColumn, clearRange, fillFromValue, mergeCells, rangeText, removeColumn, sortRowsBy, tableHash, tableText, tableValue, textHash, setColumnTotal, type TableModel } from '../../src/notebook/blocks/table/model'

const table = (): TableModel => ({ head: ['A', 'B'], rows: [['10', 'x'], ['2', 'y\tz'], ['', 'w']], align: [undefined, 'right'] })

describe('the table block: columns, sums, order', () => {
  it('a column added gets its name, the widths and sums follow', () => {
    const t = { ...table(), widths: [100, 200], totals: [{ c: 1, kind: 'sum' as const }] }
    addColumn(t, 1)
    expect(t.head).toEqual(['A', 'Столбец 3', 'B'])
    expect(t.align).toEqual([undefined, undefined, 'right'])
    expect(t.widths).toEqual([100, 0, 200])
    expect(t.totals).toEqual([{ c: 2, kind: 'sum' }])
    expect(t.rows[0]).toEqual(['10', '', 'x'])
  })
  it('the last column is never removed', () => {
    const t = table()
    expect(removeColumn(t, 0)).toBe(true)
    expect(t.head).toEqual(['B'])
    expect(removeColumn(t, 0)).toBe(false)
    expect(t.head).toEqual(['B'])
  })
  it('a total set, kept in order; the same again — taken away, another — in its place', () => {
    const t = table()
    setColumnTotal(t, 1, 'avg')
    setColumnTotal(t, 0, 'sum')
    expect(t.totals).toEqual([
      { c: 0, kind: 'sum' },
      { c: 1, kind: 'avg' },
    ])
    setColumnTotal(t, 1, 'max')
    expect(t.totals?.[1]).toEqual({ c: 1, kind: 'max' })
    setColumnTotal(t, 0, 'sum')
    setColumnTotal(t, 1, 'max')
    expect(t.totals).toBeUndefined()
  })
  it('sorts numbers as numbers; merged cells hold the rows', () => {
    const t = table()
    expect(sortRowsBy(t, 0, 1)).toBe(true)
    expect(t.rows.map((r) => r[0])).toEqual(['', '2', '10'])
    mergeCells(t, 0, 0, 1, 0)
    expect(sortRowsBy(t, 0, -1)).toBe(false)
  })
})

describe('the table block: chosen cells', () => {
  it('copied as Excel takes them (quoted when a cell has a tab)', () => {
    const t = table()
    expect(rangeText(t, { r0: 1, c0: 1, r1: -1, c1: 0 })).toBe('A\tB\n10\tx\n2\t"y\tz"')
    expect(tableText(t)).toBe('A\tB\n10\tx\n2\t"y\tz"\n\tw')
  })
  it('emptied (the head too)', () => {
    const t = table()
    clearRange(t, { r0: -1, c0: 1, r1: 0, c1: 1 })
    expect(t.head).toEqual(['A', ''])
    expect(t.rows[0]).toEqual(['10', ''])
  })
  it('the rows as objects: an empty name — «Столбец N»', () => {
    expect(tableValue({ head: ['', 'b'], rows: [['1', '2']], align: [] })).toEqual([{ 'Столбец 1': '1', b: '2' }])
  })
})

describe('the table block: filled from a value', () => {
  it('takes the columns and rows; the alignment kept when the columns are as many', () => {
    const t = { ...table(), totals: [{ c: 1, kind: 'sum' as const }], widths: [80, 90] }
    fillFromValue(t, [{ a: 1, b: 'x' }], 'key')
    expect(t.head).toEqual(['a', 'b'])
    expect(t.rows).toEqual([['1', 'x']])
    expect(t.align).toEqual([undefined, 'right'])
    expect(t.widths).toEqual([80, 90])
    expect(t.totals).toEqual([{ c: 1, kind: 'sum' }])
    expect(t.filled).toBe(tableHash(t))
    expect(t.srcHash).toBe(textHash('key'))
  })
  it('other columns: alignment and widths reset, sums beyond them dropped; an empty list — one empty row', () => {
    const t = { ...table(), totals: [{ c: 1, kind: 'sum' as const }], widths: [80, 90] }
    fillFromValue(t, [], undefined)
    expect(t.head).toEqual(['значение'])
    expect(t.rows).toEqual([['']])
    expect(t.align).toEqual([undefined])
    expect(t.widths).toBeUndefined()
    expect(t.totals).toBeUndefined()
    expect(t.srcHash).toBeUndefined()
  })
})
