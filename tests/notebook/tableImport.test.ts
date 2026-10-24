import { describe, expect, it } from 'vitest'
import { newTable, parseTable, removeColumn, sortRowsBy, tableMd, type TableModel } from '../../src/notebook/blocks/table/model'
import { importGrid, isBlankTable, pasteGrid, tableShape } from '../../src/notebook/blocks/table/modelImport'
import type { CellGrid } from '../../src/shared/tableData'

/** «Заказ №» over two columns, «Сумма» down two rows, then data. */
const GRID: CellGrid = {
  rows: [
    ['Заказ №', '', 'Сумма'],
    ['1', 'Альфа', ''],
    ['2', 'Бета', '1500'],
  ],
  merges: [
    { r: 0, c: 0, rs: 1, cs: 2 },
    { r: 0, c: 2, rs: 2, cs: 1 },
  ],
}

describe('a grid as a table', () => {
  it('with a head row: a merge across the head stays the head\'s; one down into the body is cut at its edge', () => {
    const s = tableShape(GRID, true)
    expect(s.head).toEqual(['Заказ №', '', 'Сумма'])
    expect(s.rows).toEqual([
      ['1', 'Альфа', ''],
      ['2', 'Бета', '1500'],
    ])
    // the head's colspan; «Сумма» down one more row — a single body cell, not a merge
    expect(s.merges).toEqual([{ r: -1, c: 0, rs: 1, cs: 2 }])
  })
  it('without a head row: the head made, every row the body\'s, the merges as they are', () => {
    const s = tableShape(GRID, false)
    expect(s.head).toEqual(['Столбец 1', 'Столбец 2', 'Столбец 3'])
    expect(s.rows).toHaveLength(3)
    expect(s.merges).toEqual(GRID.merges)
  })
  it('import: the table replaced, alignment kept for the columns still there, a variable let go', () => {
    const t: TableModel = { ...newTable(2, 2), align: ['right', 'center'], from: 'rows', filled: 'x' }
    importGrid(t, GRID, true)
    expect(t.align).toEqual(['right', 'center', undefined])
    expect(t.from).toBeUndefined()
    expect(t.filled).toBeUndefined()
  })
})

describe('a paste into a table', () => {
  const table = (): TableModel => parseTable(['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n'))
  it('fills from the cell, the table growing (new columns named)', () => {
    const t = table()
    pasteGrid(t, { rows: [['x', 'y', 'z'], ['p', 'q', 'r']], merges: [] }, { r: 1, c: 1 })
    expect(t.head).toEqual(['a', 'b', 'Столбец 3', 'Столбец 4'])
    expect(t.rows).toEqual([
      ['1', '2', '', ''],
      ['3', 'x', 'y', 'z'],
      ['', 'p', 'q', 'r'],
    ])
    expect(t.align).toHaveLength(4)
  })
  it('a merge it covers goes, its own merges come', () => {
    const t = parseTable(['<!-- qa:table merge=0.0.2.1 -->', '| a | b |', '| --- | --- |', '| 1 | 2 |', '|  | 4 |'].join('\n'))
    pasteGrid(t, { rows: [['m', '']], merges: [{ r: 0, c: 0, rs: 1, cs: 2 }] }, { r: 1, c: 0 })
    expect(t.merges).toEqual([{ r: 1, c: 0, rs: 1, cs: 2 }])
    expect(t.rows[1]).toEqual(['m', ''])
  })
  it('into the head (row -1): the first row of the paste becomes the head', () => {
    const t = table()
    pasteGrid(t, { rows: [['Имя', 'Сумма'], ['Болт', '12']], merges: [] }, { r: -1, c: 0 })
    expect(t.head).toEqual(['Имя', 'Сумма'])
    expect(t.rows[0]).toEqual(['Болт', '12'])
  })
  it('a blank table is told apart (a paste into it asks about the head)', () => {
    expect(isBlankTable(newTable(3, 3))).toBe(true)
    expect(isBlankTable(table())).toBe(false)
  })
})

describe('merged cells of the head', () => {
  const md = ['<!-- qa:table merge=-1.0.1.2 -->', '| Заказ |  | Сумма |', '| --- | --- | --- |', '| 1 | Альфа | 10 |'].join('\n')
  it('kept in the file and read back', () => {
    const t = parseTable(md)
    expect(t.merges).toEqual([{ r: -1, c: 0, rs: 1, cs: 2 }])
    expect(parseTable(tableMd(t)).merges).toEqual(t.merges)
  })
  it('a head merge down into the body is not read (the head spans columns only)', () => {
    expect(parseTable(md.replace('-1.0.1.2', '-1.0.2.1')).merges).toBeUndefined()
  })
  it('the column it starts at deleted — its text goes to the next column', () => {
    const t = parseTable(md.replace('-1.0.1.2', '-1.0.1.3'))
    removeColumn(t, 0)
    expect(t.head[0]).toBe('Заказ')
    expect(t.merges).toEqual([{ r: -1, c: 0, rs: 1, cs: 2 }])
  })
  it('do not keep the rows from being sorted', () => {
    const t = parseTable([...md.split('\n'), '| 2 | Бета | 5 |'].join('\n'))
    expect(sortRowsBy(t, 2, 1)).toBe(true)
    expect(t.rows.map((r) => r[1])).toEqual(['Бета', 'Альфа'])
  })
})
