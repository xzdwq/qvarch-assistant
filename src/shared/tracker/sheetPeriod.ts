import { daysBetween, weekStart } from '../report'
import { shiftDay } from '../timeline'

/** The sheet's period: one day, a Monday..Sunday week, or any range picked on the calendar. */
export type SheetMode = 'week' | 'day' | 'range'

/** The period as remembered: its mode, the day it stands on (day / week) and the range's edges. */
export interface SheetPeriod {
  mode: SheetMode
  anchor: string
  from: string
  to: string
}

/** A range wider than this many days is cut. */
export const MAX_DAYS = 62

/** The days (columns) of a period. */
export function periodDays(p: SheetPeriod): string[] {
  switch (p.mode) {
    case 'week':
      return daysBetween(weekStart(p.anchor), shiftDay(weekStart(p.anchor), 6))
    case 'range':
      return daysBetween(p.from, p.to).slice(0, MAX_DAYS)
    case 'day':
      return [p.anchor]
  }
}

/** The key rows added by hand are remembered under (per week, per range, per day). */
export function periodKey(p: SheetPeriod): string {
  switch (p.mode) {
    case 'week':
      return weekStart(p.anchor)
    case 'range':
      return `${p.from}_${p.to}`
    case 'day':
      return p.anchor
  }
}

/** A range picked on the calendar: one day → "day", Monday..Sunday → "week", anything else → that range. */
export function periodOfRange(p: SheetPeriod, from: string, to: string): SheetPeriod {
  if (from === to) return { ...p, mode: 'day', anchor: from }
  if (weekStart(from) === from && shiftDay(from, 6) === to) return { ...p, mode: 'week', anchor: from }
  return { ...p, mode: 'range', from, to }
}

/** The period one step later (dir 1) or earlier (-1): a day, a week, or the range's own length. */
export function shiftPeriod(p: SheetPeriod, dir: 1 | -1): SheetPeriod {
  switch (p.mode) {
    case 'range': {
      const n = periodDays(p).length
      return { ...p, from: shiftDay(p.from, dir * n), to: shiftDay(p.to, dir * n) }
    }
    case 'week':
      return { ...p, anchor: shiftDay(p.anchor, dir * 7) }
    case 'day':
      return { ...p, anchor: shiftDay(p.anchor, dir) }
  }
}
