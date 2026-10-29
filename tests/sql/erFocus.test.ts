import { describe, expect, it } from 'vitest'
import { colId, erLit, erTypeKind, hasLines, type ErLine } from '../../src/shared/sql'
import { infoMd, parseInfo } from '../../src/notebook/domain/blockInfo'

const line = (fromTable: string, fromColumn: string, toTable: string, toColumn: string): ErLine => ({ id: `${fromTable}|${fromColumn}>${toTable}|${toColumn}`, fromTable, fromColumn, toTable, toColumn })
const lines = [line('orders', 'customer_id', 'customers', 'id'), line('order_lines', 'order_id', 'orders', 'id'), line('payments', 'order_id', 'orders', 'id')]
const sorted = (s: Set<string>) => [...s].sort()

describe('what an ER diagram lights', () => {
  it('a line: it and the two columns it joins', () => {
    const l = erLit(lines, undefined, { kind: 'line', id: lines[0].id })
    expect(sorted(l.lines)).toEqual([lines[0].id])
    expect(sorted(l.columns)).toEqual([colId('customers', 'id'), colId('orders', 'customer_id')])
    expect(l.moving).toBe(false)
  })
  it('a column: its own references (either way) and the columns at their other ends', () => {
    const l = erLit(lines, undefined, { kind: 'column', table: 'orders', column: 'id' })
    expect(sorted(l.lines)).toEqual([lines[1].id, lines[2].id].sort())
    expect(sorted(l.columns)).toEqual([colId('order_lines', 'order_id'), colId('orders', 'id'), colId('payments', 'order_id')])
  })
  it('a table: all its references, moving', () => {
    const l = erLit(lines, undefined, { kind: 'table', table: 'orders' })
    expect(l.lines.size).toBe(3)
    expect(l.moving).toBe(true)
  })
  it('the pick stays beside what is pointed at; a column with no references — nothing to light', () => {
    const l = erLit(lines, { kind: 'line', id: lines[0].id }, { kind: 'column', table: 'payments', column: 'order_id' })
    expect(sorted(l.lines)).toEqual([lines[0].id, lines[2].id].sort())
    expect(hasLines(lines, 'payments', 'amount')).toBe(false)
    expect(erLit(lines).lines.size).toBe(0)
  })
  it('a column’s kind of type, each its own colour', () => {
    expect(['integer', 'numeric(10,2)', 'varchar(80)', 'timestamp with time zone', 'boolean', 'jsonb', 'uuid', 'bytea', 'geometry', undefined].map(erTypeKind)).toEqual([
      'number',
      'number',
      'text',
      'time',
      'bool',
      'json',
      'uuid',
      'binary',
      'other',
      'other',
    ])
  })
})

describe('the height of what a block shows (h=)', () => {
  it('read within its bounds, written back', () => {
    expect(parseInfo('sql db=main h=640').h).toBe(640)
    expect(parseInfo('sql h=10').h).toBe(200)
    expect(parseInfo('sql h=99999').h).toBe(2400)
    expect(parseInfo('sql h=abc').h).toBeUndefined()
    expect(infoMd(parseInfo('sql db=main name=rows h=640'))).toBe('sql db=main name=rows h=640')
  })
})
