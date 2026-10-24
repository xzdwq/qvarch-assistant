import { describe, expect, it } from 'vitest'
import { dayStart, HOUR, MINUTE } from '../../src/shared/timeline'
import { afterEvent, copyDraft, sameTimesOn } from '../../src/shared/tracker/entryCopy'
import { canRecord, extendRecording, isStaleRecording, recordingStep, type RecordLimits } from '../../src/shared/tracker/recording'
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
  const limits: RecordLimits = { workEnd: at(18), stopAtWorkEnd: true, dayEnd: dayStart('2026-10-24') }
  const step = (s: number, e: number, now: number, l = limits) => recordingStep({ start: s, end: e }, now, l)
  it('its end follows the clock — never shortened, never under a minute; ahead of its time — waits', () => {
    expect(step(at(10), at(10, 1), at(12, 5))).toEqual({ end: at(12, 5), stop: false })
    expect(step(at(10), at(10), at(10)).end).toBe(at(10, 1))
    // planned till 13:00, now 12:00 — stays till 13:00, then stretches
    expect(step(at(11), at(13), at(12))).toEqual({ end: at(13), stop: false })
    expect(step(at(11), at(13), at(13, 20))).toEqual({ end: at(13, 20), stop: false })
    // ahead: nothing yet
    expect(step(at(15), at(16), at(12))).toEqual({ end: at(16), stop: false })
  })
  it('begun before the work day\'s end — stops at it; begun after — goes on; off in the settings — goes on', () => {
    expect(step(at(17), at(17, 1), at(18, 10))).toEqual({ end: at(18), stop: true })
    expect(step(at(18, 30), at(18, 31), at(20))).toEqual({ end: at(20), stop: false })
    expect(step(at(17), at(17, 1), at(18, 10), { ...limits, stopAtWorkEnd: false }).stop).toBe(false)
    // a day off (no work hours) — only midnight
    expect(step(at(17), at(17, 1), at(19), { ...limits, workEnd: undefined }).stop).toBe(false)
    // planned past the work day's end: stopped there, its own end kept
    expect(step(at(17), at(19), at(18, 5))).toEqual({ end: at(19), stop: true })
  })
  it('stops at midnight', () => {
    expect(step(at(23), at(23, 1), dayStart('2026-10-24') + 5 * MINUTE, { ...limits, stopAtWorkEnd: false })).toEqual({ end: dayStart('2026-10-24'), stop: true })
  })
  it('may be started on an event going on (or just over) or ahead; not on an Outlook meeting or a detected call', () => {
    const e = (end: number, extra: Partial<Entry> = {}) => ({ end, source: 'manual' as const, ...extra })
    expect(canRecord(e(at(12)), at(12, 2))).toBe(true)
    expect(canRecord(e(at(12)), at(12, 4))).toBe(false)
    expect(canRecord(e(at(15)), at(12))).toBe(true)
    expect(canRecord(e(at(15), { outlook: { id: 'o', sig: '' } }), at(12))).toBe(false)
    expect(canRecord(e(at(15), { source: 'detected' }), at(12))).toBe(false)
  })
  it('one the app was closed through ends where it got; one ahead stays', () => {
    expect(isStaleRecording({ start: at(10), end: at(11) }, at(14))).toBe(true)
    expect(isStaleRecording({ start: at(10), end: at(13, 59) }, at(14))).toBe(false)
    expect(isStaleRecording({ start: at(15), end: at(16) }, at(14))).toBe(false)
  })
  it('runs along its lane; running into another event — moves down to a lane free for all of it', () => {
    const list = [entry('rec', at(10), at(10, 30), 0), entry('meet', at(11), at(12), 0)]
    expect(extendRecording(list, 'rec', at(10, 50)).find((e) => e.id === 'rec')).toMatchObject({ end: at(10, 50), lane: 0 })
    const moved = extendRecording(list, 'rec', at(11, 15))
    expect(moved.find((e) => e.id === 'rec')).toMatchObject({ end: at(11, 15), lane: 1 })
    expect(moved.find((e) => e.id === 'meet')?.lane).toBe(0)
  })
})
