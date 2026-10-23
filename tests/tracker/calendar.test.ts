import { describe, expect, it } from 'vitest'
import type { Entry } from '../../src/shared/types'
import { DEFAULT_KINDS } from '../../src/shared/kinds'
import { HOUR, MINUTE } from '../../src/shared/timeline'
import { dayKey, dayLabel, dayNum, leadOf, monthBands, weekdayOf } from '../../src/shared/tracker/calendarDays'
import { eventBox, hourPxFor, layoutDay, subLinesFor } from '../../src/shared/tracker/calendarLayout'
import { byDay, dayStats, neighboursOf } from '../../src/shared/tracker/calendarItems'
import { decidePending, edgeAt, snapT } from '../../src/shared/tracker/calendarGesture'

const T0 = Date.UTC(2026, 9, 5, 9) // a Monday
const ev = (id: string, start: number, end: number, extra: Partial<Entry> = {}): Entry => ({ id, start, end, kind: 'task', label: id, source: 'manual', ...extra })

describe('calendar days', () => {
  it('day numbers round-trip and keep the weekday', () => {
    const n = dayNum('2026-10-05')
    expect(dayKey(n)).toBe('2026-10-05')
    expect(dayKey(n + 27)).toBe('2026-11-01')
    expect(weekdayOf(n)).toBe(1)
  })
  it('labels a day by the column width', () => {
    const mon = dayNum('2026-10-05')
    expect(dayLabel(mon, 80)).toBe('пн 5')
    expect(dayLabel(mon, 20)).toBe('5')
    expect(dayLabel(mon, 10)).toBe('5') // a Monday stays on a narrow strip
    expect(dayLabel(mon + 1, 10)).toBe('')
    expect(dayLabel(mon, 5)).toBe('')
  })
  it('leaves a little context before the day brought into view', () => {
    expect(leadOf(1)).toBe(0)
    expect(leadOf(7)).toBeCloseTo(1)
    expect(leadOf(30)).toBe(6)
  })
  it('splits the strip into month bands clipped to its width', () => {
    const first = dayNum('2026-10-30')
    const xOf = (n: number) => (n - first) * 10
    const bands = monthBands(first, first + 5, xOf, 1000)
    expect(bands.map((b) => b.key)).toEqual(['2026-10', '2026-11'])
    expect(bands[0]).toMatchObject({ x: 0, w: 20, label: 'Октябрь 2026' })
    expect(bands[1]).toMatchObject({ x: 20, label: 'Ноябрь 2026' })
    expect(monthBands(dayNum('2026-12-31'), dayNum('2027-01-01'), xOf, 1e6).map((b) => b.label)).toEqual(['Декабрь 2026', 'Январь 2027'])
  })
})

describe('calendar layout', () => {
  it('puts only really overlapping events side by side', () => {
    // sorted by start, as the calendar passes them
    const list = [ev('a', T0, T0 + HOUR), ev('b', T0 + 30 * MINUTE, T0 + 2 * HOUR), ev('d', T0 + HOUR, T0 + 90 * MINUTE), ev('c', T0 + 2 * HOUR, T0 + 3 * HOUR)]
    const out = layoutDay(list)
    expect(out.map((x) => [x.e.id, x.col, x.cols])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['d', 0, 2],
      ['c', 0, 1],
    ])
  })
  it('keeps the whole day in view at the smallest scale and caps the largest', () => {
    expect(hourPxFor(480, 0.01)).toBeCloseTo(478 / 24)
    expect(hourPxFor(480, 1)).toBe(48)
    expect(hourPxFor(480, 100)).toBe(720)
  })
  it('adds finer lines once an hour is tall', () => {
    expect(subLinesFor(60)).toEqual([])
    expect(subLinesFor(120)).toHaveLength(24)
    const q = subLinesFor(300)
    expect(q).toHaveLength(72)
    expect(q[1]).toEqual({ y: 150, label: '00:30', half: true })
  })
  it('fits the text an event has room for', () => {
    expect(eventBox(10 * MINUTE, 48)).toEqual({ h: 7, time: false, lines: 0 })
    const hour = eventBox(HOUR, 48)
    expect(hour.time).toBe(true)
    expect(hour.lines).toBe(2)
  })
})

describe('calendar side list and totals', () => {
  const items = [1, 2, 3, 4, 5].map((i) => ({ key: `k${i}`, t: i * 10, day: i < 3 ? '2026-10-05' : '2026-10-06' }))
  it('groups by day in order', () => {
    expect(byDay(items).map((g) => [g.day, g.items.length])).toEqual([
      ['2026-10-05', 2],
      ['2026-10-06', 3],
    ])
  })
  it('takes the neighbours around the open item (or its moment), without it', () => {
    expect(neighboursOf(items, 'k3', 0, 1)).toEqual({ before: [items[1]], after: [items[3]] })
    expect(neighboursOf(items, undefined, 25, 2)).toEqual({ before: items.slice(0, 2), after: items.slice(2, 4) })
    expect(neighboursOf(items, undefined, 99, 1)).toEqual({ before: [items[4]], after: [] })
  })
  it('counts a day: done once for parallel blocks, planned after now', () => {
    const now = T0 + 2 * HOUR
    const list = [ev('a', T0, T0 + HOUR, { task: { key: 'X-1', summary: '' } }), ev('b', T0 + 30 * MINUTE, T0 + HOUR, { kind: 'call' }), ev('c', T0 + HOUR, T0 + 3 * HOUR, { kind: 'break' })]
    const s = dayStats(list, [{ start: T0, end: T0 + 4 * HOUR }], 2, now, DEFAULT_KINDS)
    expect(s).toEqual({ done: 2 * HOUR, productive: HOUR, planned: HOUR, plan: 4 * HOUR, count: 3, tasks: 1, meetings: 1, notes: 2 })
  })
})

describe('calendar gestures', () => {
  it('snaps to five minutes', () => {
    expect(snapT(T0 + 7 * MINUTE + 31_000)).toBe(T0 + 10 * MINUTE)
  })
  it('decides a press by its first clear direction', () => {
    expect(decidePending(3, -4)).toBeUndefined()
    expect(decidePending(10, 4)).toBe('pan')
    expect(decidePending(2, 9)).toBe('create')
  })
  it('grabs an edge only on a tall enough event', () => {
    expect(edgeAt(40, 2, 38)).toBe('start')
    expect(edgeAt(40, 37, 3)).toBe('end')
    expect(edgeAt(40, 20, 20)).toBeUndefined()
    expect(edgeAt(20, 1, 19)).toBeUndefined()
  })
})
