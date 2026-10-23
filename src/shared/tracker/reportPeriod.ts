import { shiftDay } from '../timeline'
import { daysBetween, weekStart } from '../report'

/** The period a report covers: a calendar unit around an anchor day, or a picked range. */
export type Period = 'day' | 'week' | 'month' | 'year' | 'custom'

/** What decides the period's days (the anchor for a unit, from / to for a picked range). */
export interface PeriodPick {
  period: Period
  anchor: string
  from: string
  to: string
}

export const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'year', label: 'Год' },
  { id: 'custom', label: 'Период' },
]

/** A day as text in Russian ("12 окт."). */
export const fmtDay = (d: string, o: Intl.DateTimeFormatOptions): string => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', o)

/** The anchor day moved by whole months / years (kept on the 1st of the month). */
function shiftMonths(anchor: string, months: number): string {
  const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00`)
  d.setMonth(d.getMonth() + months)
  return d.toLocaleDateString('sv-SE')
}

/** First and last day of the period (a picked range in any order comes back ordered). */
export function periodRange(p: PeriodPick): [string, string] {
  const a = p.anchor
  switch (p.period) {
    case 'day':
      return [a, a]
    case 'week':
      return [weekStart(a), shiftDay(weekStart(a), 6)]
    case 'month': {
      const first = `${a.slice(0, 7)}-01`
      const last = new Date(`${first}T12:00:00`)
      last.setMonth(last.getMonth() + 1, 0)
      return [first, last.toLocaleDateString('sv-SE')]
    }
    case 'year':
      return [`${a.slice(0, 4)}-01-01`, `${a.slice(0, 4)}-12-31`]
    case 'custom':
      return p.from <= p.to ? [p.from, p.to] : [p.to, p.from]
  }
}

/** The fields that change when the period steps one length forward (1) or back (-1). */
export function shiftedPeriod(p: PeriodPick, dir: 1 | -1): Partial<PeriodPick> {
  switch (p.period) {
    case 'custom': {
      const [a, b] = periodRange(p)
      const len = daysBetween(a, b).length
      return { from: shiftDay(a, dir * len), to: shiftDay(b, dir * len) }
    }
    case 'day':
      return { anchor: shiftDay(p.anchor, dir) }
    case 'week':
      return { anchor: shiftDay(p.anchor, dir * 7) }
    case 'month':
      return { anchor: shiftMonths(p.anchor, dir) }
    case 'year':
      return { anchor: shiftMonths(p.anchor, dir * 12) }
  }
}

/** The period's name in the bar ("Октябрь 2026", "6 – 12 окт."); a picked range has its own button. */
export function periodLabel(period: Period, [a, b]: [string, string]): string {
  switch (period) {
    case 'day':
      return fmtDay(a, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    case 'week':
      return `${fmtDay(a, { day: 'numeric', month: a.slice(5, 7) === b.slice(5, 7) ? undefined : 'short' })} – ${fmtDay(b, { day: 'numeric', month: 'short' })}`
    case 'month': {
      const s = fmtDay(a, { month: 'long', year: 'numeric' }).replace(' г.', '')
      return s[0].toUpperCase() + s.slice(1)
    }
    case 'year':
      return a.slice(0, 4)
    case 'custom':
      return ''
  }
}

/** A picked range as text: one day, or both ends. */
export function rangeLabel([a, b]: [string, string]): string {
  return a === b ? fmtDay(a, { day: 'numeric', month: 'short', year: 'numeric' }) : `${fmtDay(a, { day: 'numeric', month: 'short' })} – ${fmtDay(b, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/** The same length of time right before the range — to compare with. */
export function previousRange([a, b]: [string, string]): [string, string] {
  const n = daysBetween(a, b).length
  return [shiftDay(a, -n), shiftDay(a, -1)]
}
