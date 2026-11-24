import { describe, expect, it } from 'vitest'
import { clampWindow, rebaseWindow } from '../../src/shared/tracker/timeWindow'
import { HOUR, MINUTE, atTime, dayEnd, dayStart } from '../../src/shared/timeline'

const bounds = (day: string): [number, number] => [dayStart(day), dayEnd(day)]

describe('clampWindow', () => {
  it('moves a window that lies past the bounds to their edge, keeping its span', () => {
    const b = bounds('2026-03-10')
    expect(clampWindow([b[1] + HOUR, b[1] + 3 * HOUR], b, 10 * MINUTE)).toEqual([b[1] - 2 * HOUR, b[1]])
  })
  it('widens a too narrow window and narrows a too wide one', () => {
    const b = bounds('2026-03-10')
    expect(clampWindow([b[0], b[0] + MINUTE], b, 10 * MINUTE)).toEqual([b[0], b[0] + 10 * MINUTE])
    expect(clampWindow([b[0] - HOUR, b[1] + HOUR], b, 10 * MINUTE)).toEqual(b)
  })
})

describe('rebaseWindow', () => {
  it('keeps the same hours and scale on another day (back and forward)', () => {
    const win: [number, number] = [atTime('2026-03-10', '10:00'), atTime('2026-03-10', '13:30')]
    expect(rebaseWindow(win, bounds('2026-03-10'), bounds('2026-03-05'), 10 * MINUTE)).toEqual([atTime('2026-03-05', '10:00'), atTime('2026-03-05', '13:30')])
    expect(rebaseWindow(win, bounds('2026-03-10'), bounds('2026-03-12'), 10 * MINUTE)).toEqual([atTime('2026-03-12', '10:00'), atTime('2026-03-12', '13:30')])
  })
  it('stays inside a shorter day', () => {
    const win: [number, number] = [atTime('2026-03-10', '20:00'), dayEnd('2026-03-10')]
    const nb = bounds('2026-03-11')
    const [a, b] = rebaseWindow(win, bounds('2026-03-10'), [nb[0], nb[1] - HOUR], 10 * MINUTE)
    expect(b).toBe(nb[1] - HOUR)
    expect(b - a).toBe(dayEnd('2026-03-10') - atTime('2026-03-10', '20:00'))
  })
  it('the same bounds leave the window as it is', () => {
    const b = bounds('2026-03-10')
    const win: [number, number] = [atTime('2026-03-10', '09:00'), atTime('2026-03-10', '11:00')]
    expect(rebaseWindow(win, b, b, 10 * MINUTE)).toEqual(win)
  })
})
