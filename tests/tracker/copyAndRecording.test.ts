import { describe, expect, it } from 'vitest'
import { dayStart, HOUR, MINUTE } from '../../src/shared/timeline'
import { afterEvent, copyDraft, sameTimesOn } from '../../src/shared/tracker/entryCopy'
import { extendRecording, recordingEnd } from '../../src/shared/tracker/recording'
import type { Entry } from '../../src/shared/types'

const DAY = '2026-10-23'
const at = (h: number, m = 0) => dayStart(DAY) + h * HOUR + m * MINUTE
const entry = (id: string, s: number, e: number, lane = 0, extra: Partial<Entry> = {}): Entry => ({ id, start: s, end: e, lane, kind: 'task', label: id, source: 'manual', ...extra })

describe('a copy of an event', () => {
  it('right after it, as long as it', () => {
    expect(afterEvent({ start: at(10), end: at(11, 30) })).toEqual({ start: at(11, 30), end: at(13) })
  })
  it('the same times of day on another day', () => {
    const p = sameTimesOn({ start: at(10), end: at(11) }, DAY, '2026-10-26')
    expect(p).toEqual({ start: dayStart('2026-10-26') + 10 * HOUR, end: dayStart('2026-10-26') + 11 * HOUR })
  })
  it('takes kind, text and task — never its id, series, reminder or Outlook link', () => {
    const src = entry('a', at(10), at(11), 2, { description: 'd', task: { key: 'T-1', summary: 's' }, series: { id: 's', rule: 'day' }, remind: { before: 5 }, outlook: { id: 'o' } } as Partial<Entry>)
    const c = copyDraft(src, { start: at(12), end: at(13) })
    expect(c).toEqual({ start: at(12), end: at(13), lane: undefined, label: 'a', description: 'd', task: { key: 'T-1', summary: 's' }, kind: 'task', source: 'manual' })
  })
})

describe('«Запись»', () => {
  const limits = { workEnd: at(18), stopAtWorkEnd: true, dayEnd: dayStart('2026-10-24') }
  it('its end follows the clock (never shorter than a minute)', () => {
    expect(recordingEnd(at(10), at(12, 5), limits)).toEqual({ end: at(12, 5), stop: false })
    expect(recordingEnd(at(10), at(10), limits).end).toBe(at(10, 1))
  })
  it('begun before the work day\'s end — stops at it; begun after — goes on; off in the settings — goes on', () => {
    expect(recordingEnd(at(17), at(18, 10), limits)).toEqual({ end: at(18), stop: true })
    expect(recordingEnd(at(18, 30), at(20), limits)).toEqual({ end: at(20), stop: false })
    expect(recordingEnd(at(17), at(18, 10), { ...limits, stopAtWorkEnd: false }).stop).toBe(false)
    // a day off (no work hours) — only midnight
    expect(recordingEnd(at(17), at(19), { ...limits, workEnd: undefined }).stop).toBe(false)
  })
  it('stops at midnight', () => {
    expect(recordingEnd(at(23), dayStart('2026-10-24') + 5 * MINUTE, { ...limits, stopAtWorkEnd: false })).toEqual({ end: dayStart('2026-10-24'), stop: true })
  })
  it('runs along its lane; running into another event — moves down to a lane free for all of it', () => {
    const list = [entry('rec', at(10), at(10, 30), 0), entry('meet', at(11), at(12), 0)]
    expect(extendRecording(list, 'rec', at(10, 50)).find((e) => e.id === 'rec')).toMatchObject({ end: at(10, 50), lane: 0 })
    const moved = extendRecording(list, 'rec', at(11, 15))
    expect(moved.find((e) => e.id === 'rec')).toMatchObject({ end: at(11, 15), lane: 1 })
    expect(moved.find((e) => e.id === 'meet')?.lane).toBe(0)
  })
})
