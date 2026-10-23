import { describe, expect, it } from 'vitest'
import { dayStart, HOUR, MINUTE } from '../../src/shared/timeline'
import type { Entry, PlanBlock } from '../../src/shared/types'
import { dayCell, dayFeed, periodTotals, placeQuick, plural, timelineWindow, unionWithin, type BoardDay } from '../../src/shared/tracker/boardTime'

const DAY = '2026-10-14'
const at = (h: number, day = DAY) => dayStart(day) + h * HOUR
let n = 0
const entry = (a: number, b: number, extra: Partial<Entry> = {}): Entry => ({ id: `e${n++}`, start: at(a), end: at(b), kind: 'task', label: 'x', source: 'manual', ...extra })
const board = (entries: Entry[], plan: PlanBlock[] = []): BoardDay => ({ day: DAY, entries, notes: [], plan })

describe('board time sums', () => {
  it('union cut to a window, overlaps once', () => {
    const l = [entry(9, 11), entry(10, 12), entry(14, 15)]
    expect(unionWithin(l)).toBe(4 * HOUR)
    expect(unionWithin(l, at(10.5), at(14.5))).toBe(2 * HOUR)
  })
  it('day cell: done before now, planned after, kinds shares', () => {
    const c = dayCell(board([entry(9, 11), entry(13, 14, { kind: 'call' })]), at(12), [1, 2, 3, 4, 5])
    expect(c.done).toBe(2 * HOUR)
    expect(c.plan).toBe(HOUR)
    expect(c.wd).toBe('Ср')
    expect(c.off).toBe(false)
    expect(c.kinds.map((k) => Math.round(k.pct))).toEqual([67, 33])
  })
  it('period totals: tasks and meetings apart', () => {
    const t = periodTotals([board([entry(9, 10, { task: { key: 'A-1', summary: '' } }), entry(10, 11, { kind: 'meeting' }), entry(20, 21)])], at(12))
    expect(t).toEqual({ done: 2 * HOUR, plan: HOUR, tasks: HOUR, meetings: HOUR, count: 3 })
  })
})

describe('board day feed', () => {
  const work: [number, number] = [at(9), at(18)]
  it('free gaps inside the working day, newest first by default', () => {
    const rows = dayFeed(board([entry(10, 12)]), { now: at(20, '2026-10-20'), today: '2026-10-20', work, order: 'desc' })
    expect(rows.map((r) => r.t)).toEqual(['gap', 'e', 'gap'])
    expect(rows[2]).toMatchObject({ t: 'gap', start: at(9), end: at(10), plan: false })
  })
  it('today: a gap through now is cut in two and the now line sits between them', () => {
    const rows = dayFeed(board([entry(9, 10)]), { now: at(13), today: DAY, work, order: 'asc' })
    expect(rows.map((r) => r.t)).toEqual(['e', 'gap', 'now', 'gap'])
    expect(rows[3]).toMatchObject({ start: at(13), end: at(18), plan: true })
  })
  it('short gaps are skipped; done plans are not shown', () => {
    const plan: PlanBlock = { id: 'p', start: at(12), end: at(13), kind: 'task', label: 'p', doneEntryId: 'x' } as PlanBlock
    const rows = dayFeed(board([entry(9, 10), entry(10 + 10 / 60, 18)], [plan]), { now: at(20, '2026-10-20'), today: '2026-10-20', work, order: 'asc' })
    expect(rows.map((r) => r.t)).toEqual(['e', 'e'])
  })
})

describe('board helpers', () => {
  it('quick placement: a named time, or now on that day', () => {
    expect(placeQuick({ label: '', day: DAY, start: at(9), parts: [] }, at(15), DAY)).toEqual({ start: at(9), end: at(9) + 30 * MINUTE })
    const other = placeQuick({ label: '', day: '2026-10-15', dur: HOUR, parts: [] }, at(15) + 5 * 1000, DAY)
    expect(other).toEqual({ start: at(15, '2026-10-15'), end: at(16, '2026-10-15') })
  })
  it('timeline window: padded to whole hours, clamped to the day', () => {
    expect(timelineWindow(DAY, [{ start: at(9.5), end: at(17.2) }], undefined, undefined)).toEqual([at(9), at(18)])
    expect(timelineWindow(DAY, [], undefined, undefined)).toEqual([at(8), at(19)])
  })
  it('russian plural', () => {
    expect([1, 2, 5, 11, 21, 22].map((x) => plural(x, 'a', 'b', 'c'))).toEqual(['a', 'b', 'c', 'c', 'a', 'b'])
  })
})
