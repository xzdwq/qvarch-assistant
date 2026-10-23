import { describe, expect, it } from 'vitest'
import { periodDays, periodKey, periodOfRange, shiftPeriod, type SheetPeriod } from '../../src/shared/tracker/sheetPeriod'
import { buildSheetRows, copyFromPrevious, kindTotals, nextCell } from '../../src/shared/tracker/sheetRows'
import type { RangeDay } from '../../src/shared/report'
import type { Entry } from '../../src/shared/types'

const M = 60_000
const MON = '2026-10-12' // a Monday
const t = (hm: string, day = MON) => new Date(`${day}T${hm}:00`).getTime()
const E = (id: string, s: string, e: string, extra: Partial<Entry> = {}, day = MON): Entry => ({ id, start: t(s, day), end: t(e, day), kind: 'task', label: id, source: 'manual', ...extra })
const OUTLOOK = { id: 'o', sig: 's' }
const P = (p: Partial<SheetPeriod>): SheetPeriod => ({ mode: 'day', anchor: MON, from: MON, to: MON, ...p })

describe('sheet period', () => {
  it('lists the days of a day, a week and a range', () => {
    expect(periodDays(P({ mode: 'day', anchor: '2026-10-14' }))).toEqual(['2026-10-14'])
    expect(periodDays(P({ mode: 'week', anchor: '2026-10-15' }))).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
    expect(periodDays(P({ mode: 'range', from: '2026-10-30', to: '2026-11-02' }))).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(periodDays(P({ mode: 'range', from: '2026-01-01', to: '2026-12-31' }))).toHaveLength(62)
  })
  it('keys hand-added rows per week, range and day', () => {
    expect(periodKey(P({ mode: 'week', anchor: '2026-10-15' }))).toBe(MON)
    expect(periodKey(P({ mode: 'range', from: 'a', to: 'b' }))).toBe('a_b')
    expect(periodKey(P({ mode: 'day', anchor: '2026-10-15' }))).toBe('2026-10-15')
  })
  it('reads a calendar pick as a day, a week or a range', () => {
    expect(periodOfRange(P({}), '2026-10-14', '2026-10-14')).toMatchObject({ mode: 'day', anchor: '2026-10-14' })
    expect(periodOfRange(P({}), MON, '2026-10-18')).toMatchObject({ mode: 'week', anchor: MON })
    expect(periodOfRange(P({}), '2026-10-13', '2026-10-19')).toMatchObject({ mode: 'range', from: '2026-10-13', to: '2026-10-19', anchor: MON })
  })
  it('steps by a day, a week or the range length', () => {
    expect(shiftPeriod(P({ mode: 'day' }), -1).anchor).toBe('2026-10-11')
    expect(shiftPeriod(P({ mode: 'week' }), 1).anchor).toBe('2026-10-19')
    expect(shiftPeriod(P({ mode: 'range', from: '2026-10-12', to: '2026-10-14' }), 1)).toMatchObject({ from: '2026-10-15', to: '2026-10-17' })
  })
})

describe('sheet rows', () => {
  const order = (k: string) => ['task', 'meet'].indexOf(k)
  const all = () => true
  it('groups blocks by task, or by kind + text, with cells per day and totals', () => {
    const days: RangeDay[] = [
      { day: MON, entries: [E('a', '09:00', '10:00', { task: { key: 'ABC-1', summary: 'S' } }), E('b', '09:30', '10:30', { task: { key: 'ABC-1', summary: 'S' } }), E('c', '11:00', '11:30', { kind: 'meet', label: 'Sync' })] },
      { day: '2026-10-13', entries: [E('d', '09:00', '09:30', { kind: 'meet', label: ' sync ' }, '2026-10-13')] },
    ]
    const rows = buildSheetRows(days, [], all, order)
    expect(rows.map((r) => r.key)).toEqual(['t:ABC-1', 'k:meet:sync'])
    expect(rows[0].cells.get(MON)?.ms).toBe(90 * M)
    expect(rows[1].total).toBe(60 * M)
    expect(rows[1].manual).toBe(false)
  })
  it('keeps hand-added rows, filters kinds and locks Outlook-only rows', () => {
    const days: RangeDay[] = [{ day: MON, entries: [E('o', '09:00', '10:00', { kind: 'meet', outlook: OUTLOOK }), E('x', '10:00', '11:00', { kind: 'other' })] }]
    const rows = buildSheetRows(days, [{ key: 'k:task:new', kind: 'task', label: 'New' }], (k) => k !== 'other', order)
    expect(rows.map((r) => [r.key, r.locked, r.manual])).toEqual([
      ['k:task:new', false, true],
      ['k:meet:o', true, false],
    ])
  })
  it('sums kinds per day, configured kinds first, removed ones after', () => {
    const byDay: Record<string, Entry[]> = { [MON]: [E('a', '09:00', '10:00'), E('b', '09:30', '10:30'), E('c', '11:00', '11:30', { kind: 'gone' })], '2026-10-13': [] }
    const rows = kindTotals([MON, '2026-10-13'], (d) => byDay[d], ['meet', 'task'])
    expect(rows.map((r) => [r.kind, r.total])).toEqual([
      ['task', 90 * M],
      ['gone', 30 * M],
    ])
    expect(rows[0].per.get('2026-10-13')).toBe(0)
  })
  it('moves the cell cursor down, up and right, stopping at edges and locked rows', () => {
    const rows = [
      { key: 'a', locked: false },
      { key: 'b', locked: true },
      { key: 'c', locked: false },
    ]
    const cols = ['d1', 'd2']
    expect(nextCell(rows, cols, 'a', 'd1', 'right')).toEqual({ row: rows[0], day: 'd2' })
    expect(nextCell(rows, cols, 'a', 'd2', 'right')).toBeUndefined()
    expect(nextCell(rows, cols, 'a', 'd1', 'down')).toBeUndefined()
    expect(nextCell(rows, cols, 'c', 'd1', 'down')).toBeUndefined()
    expect(nextCell(rows, cols, 'c', 'd2', 'up')).toBeUndefined()
    expect(nextCell(rows, cols, 'a', 'd1', 'up')).toBeUndefined()
  })
  it('copies the previous period: its own rows, and time where the cell is empty', () => {
    const prevDay = '2026-10-05'
    const prev: RangeDay[] = [{ day: prevDay, entries: [E('a', '09:00', '10:00', {}, prevDay), E('m', '10:00', '11:00', { outlook: OUTLOOK }, prevDay), E('c', '11:00', '11:30', { source: 'detected' }, prevDay), E('z', '12:00', '12:00', { label: 'z' }, prevDay)] }]
    const copy = copyFromPrevious(prev, [prevDay], [MON], (key) => (key === 'k:task:z' ? 5 : 0))
    expect(copy.rows.map((r) => r.key)).toEqual(['k:task:a', 'k:task:z'])
    expect(copy.fills).toEqual([{ row: copy.rows[0], day: MON, ms: 60 * M }])
  })
})
