import { describe, expect, it } from 'vitest'
import type { Quick } from '../../src/shared/quickadd'
import { dayStart, HOUR, MINUTE } from '../../src/shared/timeline'
import { blockLabel, errorText, placeByQuickLine, remindModeOf, remindOf, remindShort, repeatShort, seriesEvery } from '../../src/shared/tracker/entryForm'

const day = '2026-10-05'
const at = (h: number, m = 0) => dayStart(day) + h * HOUR + m * MINUTE
const q = (p: Partial<Quick>): Quick => ({ label: 'x', day, parts: [], ...p })

describe('event card: reminder and repeat', () => {
  it('maps a reminder to its mode and back', () => {
    expect(remindOf('off', 0)).toBeUndefined()
    expect(remindOf('b15', 0)).toEqual({ before: 15 })
    expect(remindOf('at', 42)).toEqual({ at: 42 })
    expect(remindModeOf(undefined)).toBe('off')
    expect(remindModeOf({ before: 0 })).toBe('b0')
    expect(remindModeOf({ at: 5 })).toBe('at')
  })
  it('labels the chips shortly', () => {
    expect(remindShort('off', 0)).toBe('')
    expect(remindShort('b0', 0)).toBe('в начале')
    expect(remindShort('b30', 0)).toBe('за 30м')
    expect(remindShort('b120', 0)).toBe('за 2ч')
    expect(repeatShort('', 5)).toBe('')
    expect(repeatShort('week', 5)).toBe('нед ×5')
    expect(seriesEvery(undefined)).toBe('')
  })
})

describe('event card: title and place', () => {
  it('falls back from the text to a placeholder, the task, the kind', () => {
    const task = { key: 'X-1', summary: 'Fix' }
    expect(blockLabel('Own', task, 'Задача')).toBe('Own')
    expect(blockLabel('', task, 'Задача', '…')).toBe('…')
    expect(blockLabel('', task, 'Задача')).toBe('X-1 Fix')
    expect(blockLabel('', undefined, 'Задача')).toBe('Задача')
  })
  it('lets the quick line name the time, the duration, the day', () => {
    const form = { day, start: at(9), end: at(10), followsNow: false }
    expect(placeByQuickLine(form, q({ start: at(14), end: at(15, 30) }))).toEqual({ day, start: at(14), end: at(15, 30) })
    expect(placeByQuickLine(form, q({ start: at(14) }))).toEqual({ day, start: at(14), end: at(15) })
    expect(placeByQuickLine(form, q({ dur: 30 * MINUTE }))).toEqual({ day, start: at(9), end: at(9, 30) })
    expect(placeByQuickLine({ ...form, followsNow: true }, q({ dur: 30 * MINUTE }))).toEqual({ day, start: at(9, 30), end: at(10) })
    const next = '2026-10-06'
    expect(placeByQuickLine(form, q({ day: next }))).toEqual({ day: next, start: dayStart(next) + 9 * HOUR, end: dayStart(next) + 10 * HOUR })
  })
  it('shows an IPC error without its wrapper', () => {
    expect(errorText(new Error("Error invoking remote method 'x': Error: busy"))).toBe('busy')
    expect(errorText('plain')).toBe('plain')
  })
})
