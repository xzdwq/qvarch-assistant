import { describe, expect, it } from 'vitest'
import { asGrid } from '../src/shared/gridData'
import { parseTable, tableHash, tableMd, valueTable } from '../src/notebook/blocks/table/model'

describe('a value as a table', () => {
  it('a list of plain values — one column', () => {
    expect(asGrid(['a', 'b', 2])).toEqual({ columns: [{ name: 'значение' }], rows: [['a'], ['b'], [2]] })
  })
  it('objects with different keys — every key a column (in the order met), a missing one empty', () => {
    expect(asGrid([{ id: 1, name: 'a' }, { id: 2, email: 'x@y' }, { name: 'c', tags: ['t'], meta: { k: 1 } }])).toEqual({
      columns: [{ name: 'id' }, { name: 'name' }, { name: 'email' }, { name: 'tags' }, { name: 'meta' }],
      rows: [
        [1, 'a', null, null, null],
        [2, null, 'x@y', null, null],
        [null, 'c', null, ['t'], { k: 1 }],
      ],
    })
  })
  it('an object — its keys the columns, one row; a plain value — one cell; lists of lists — as they are', () => {
    expect(asGrid({ status: 200, ok: true })).toEqual({ columns: [{ name: 'status' }, { name: 'ok' }], rows: [[200, true]] })
    expect(asGrid('text')).toEqual({ columns: [{ name: 'значение' }], rows: [['text']] })
    expect(asGrid([[1, 2], [3]])).toEqual({ columns: [{ name: '0' }, { name: '1' }], rows: [[1, 2], [3, null]] })
  })
})

describe('the notebook table «Из переменной»', () => {
  it('a value as head and rows: object keys are the columns (different keys too), plain lists — one column', () => {
    expect(valueTable([{ id: 1, name: 'a' }, { id: 2, tags: ['x'] }])).toEqual({ head: ['id', 'name', 'tags'], rows: [['1', 'a', ''], ['2', '', '["x"]']] })
    expect(valueTable(['a', 'b', 2])).toEqual({ head: ['значение'], rows: [['a'], ['b'], ['2']] })
    expect(valueTable({ status: 200, ok: true })).toEqual({ head: ['status', 'ok'], rows: [['200', 'true']] })
  })
  it('its link and what was filled kept in the comment over it; an edit changes the hash', () => {
    const vt = valueTable([{ id: 1 }])
    const md = tableMd({ ...vt, align: [undefined], from: 'resp.body.data', filled: tableHash(vt) })
    expect(md.split('\n')[0]).toBe(`<!-- qa:table var=resp.body.data fill=${tableHash(vt)} -->`)
    const back = parseTable(md)
    expect(back).toMatchObject({ from: 'resp.body.data', filled: tableHash(vt), head: ['id'], rows: [['1']] })
    expect(tableHash({ head: ['id'], rows: [['2']] })).not.toBe(back.filled)
  })
})

describe('a filled table read back', () => {
  it('its hash the same after the file round-trip (edges, line breaks, \r, a literal <br>)', () => {
    const vt = valueTable([{ a: '  padded  ', b: 'x\r\ny', c: 'p<br>q', d: 'pipe|in' }])
    const back = parseTable(tableMd({ ...vt, align: vt.head.map(() => undefined) }))
    expect(tableHash(back)).toBe(tableHash(vt))
    expect(tableMd({ ...vt, align: vt.head.map(() => undefined) }).split('\n')).toHaveLength(3)
  })
})
