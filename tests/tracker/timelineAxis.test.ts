import { describe, expect, it } from 'vitest'
import { minorTicks, scheduleMarks, timelineAxis } from '../../src/shared/tracker/timelineAxis'
import { gapAround, hiddenSides, laneAtOffset } from '../../src/shared/tracker/timelineRanges'

const M = 60_000
const H = 60 * M
const DAY = '2026-10-12'
const t = (hm: string) => new Date(`${DAY}T${hm}:00`).getTime()

describe('minorTicks', () => {
  it('splits hour steps into quarters and skips labelled ticks', () => {
    const list = [t('09:00'), t('10:00')]
    expect(minorTicks(t('09:00'), t('10:00'), H, list)).toEqual([t('09:15'), t('09:30'), t('09:45')])
  })
  it('splits shorter steps into halves', () => {
    expect(minorTicks(t('09:00'), t('09:30'), 15 * M, [t('09:00'), t('09:15'), t('09:30')])).toEqual([t('09:07') + 30_000, t('09:22') + 30_000])
  })
})

describe('scheduleMarks', () => {
  it('labels work start, end and lunch at its middle', () => {
    const marks = scheduleMarks({ work: [t('09:00'), t('18:00')], lunch: [t('13:00'), t('14:00')] })
    expect(marks.map((m) => m.cls)).toEqual(['sch', 'sch', 'lunch'])
    expect(marks[0].text).toBe('Начало 09:00')
    expect(marks[2].t).toBe(t('13:30'))
  })
  it('is empty without a schedule', () => {
    expect(scheduleMarks({})).toEqual([])
  })
})

describe('timelineAxis', () => {
  const ticks = { step: H, list: [t('08:00'), t('09:00'), t('10:00'), t('11:00'), t('12:00')] }
  const base = { ticks, from: t('08:00'), to: t('12:00'), widthPx: 400, schedule: {} }
  it('keeps every tick when nothing competes', () => {
    const a = timelineAxis(base)
    expect(a.list).toEqual(ticks.list)
    expect(a.all).toEqual(ticks.list)
    expect(a.step).toBe(H)
  })
  it('drops ticks within 56px of now', () => {
    // 100px per hour: now at 10:20 is 33px from 10:00 and 67px from 11:00
    expect(timelineAxis({ ...base, now: t('10:20') }).list).toEqual([t('08:00'), t('09:00'), t('11:00'), t('12:00')])
  })
  it('drops schedule marks next to now and out of view', () => {
    const a = timelineAxis({ ...base, now: t('09:30'), schedule: { work: [t('09:00'), t('18:00')] } })
    expect(a.marks).toEqual([])
    const b = timelineAxis({ ...base, schedule: { work: [t('09:00'), t('18:00')] } })
    expect(b.marks.map((m) => m.t)).toEqual([t('09:00')])
    expect(b.list).not.toContain(t('09:00'))
  })
})

describe('gapAround', () => {
  const blocks = [
    { start: t('09:00'), end: t('10:00') },
    { start: t('11:00'), end: t('12:00') },
  ]
  it('is the stretch between the neighbouring blocks', () => {
    expect(gapAround(blocks, t('10:30'), t('00:00'), t('18:00'))).toEqual({ start: t('10:00'), end: t('11:00') })
  })
  it('runs to the bounds at the edges', () => {
    expect(gapAround(blocks, t('08:00'), t('00:00'), t('18:00'))).toEqual({ start: t('00:00'), end: t('09:00') })
    expect(gapAround(blocks, t('13:00'), t('00:00'), t('14:00'))).toEqual({ start: t('12:00'), end: t('14:00') })
  })
  it('is empty inside a block', () => {
    expect(gapAround(blocks, t('09:30'), t('00:00'), t('18:00'))).toEqual({ start: t('09:30'), end: t('09:30') })
  })
  it('never ends before it starts', () => {
    expect(gapAround(blocks, t('13:00'), t('00:00'), t('12:30'))).toEqual({ start: t('12:00'), end: t('12:30') })
    expect(gapAround([{ start: t('09:00'), end: t('10:00') }], t('11:00'), t('00:00'), t('09:30'))).toEqual({ start: t('10:00'), end: t('10:00') })
  })
})

describe('hiddenSides', () => {
  it('counts the blocks out of view per side with the outermost moments', () => {
    const blocks = [
      { start: t('07:00'), end: t('07:30') },
      { start: t('06:00'), end: t('06:30') },
      { start: t('09:00'), end: t('10:00') },
      { start: t('12:00'), end: t('13:00') },
    ]
    expect(hiddenSides(blocks, t('08:00'), t('12:00'))).toEqual({ left: 2, right: 1, first: t('06:00'), last: t('13:00') })
    expect(hiddenSides([], t('08:00'), t('12:00'))).toEqual({ left: 0, right: 0, first: 0, last: 0 })
  })
})

describe('laneAtOffset', () => {
  it('maps a vertical offset to a lane, clamped to the empty lane', () => {
    expect(laneAtOffset(-3, 36, 4, 2)).toBe(0)
    expect(laneAtOffset(39, 36, 4, 2)).toBe(0)
    expect(laneAtOffset(40, 36, 4, 2)).toBe(1)
    expect(laneAtOffset(500, 36, 4, 2)).toBe(2)
  })
})
