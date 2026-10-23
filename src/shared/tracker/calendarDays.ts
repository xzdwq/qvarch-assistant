/**
 * Days as numbers for the calendar strip: day N = N days since 1970-01-01 (UTC, no time zone drift), the strip's
 * labels (day, month bands, the shown range).
 */

export const DAY_MS = 86_400_000

/** '2026-10-23' → its day number. */
export const dayNum = (d: string): number => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS)
/** Day number → '2026-10-23'. */
export const dayKey = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10)
/** 0 — Sunday … 6 — Saturday. */
export const weekdayOf = (n: number): number => new Date(n * DAY_MS).getUTCDay()

/** How many days are left before the first one brought into view (a little context on the left). */
export const leadOf = (span: number): number => (span <= 1.5 ? 0 : span <= 8 ? Math.min(1, span * 0.15) : span * 0.2)

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

/** A day's label in the header for a column `colW` px wide: «пн 5», «5», only Mondays, or nothing. */
export function dayLabel(n: number, colW: number): string {
  const d = +dayKey(n).slice(8)
  if (colW >= 64) return `${WD[weekdayOf(n)]} ${d}`
  if (colW >= 18) return String(d)
  return colW >= 7 && weekdayOf(n) === 1 ? String(d) : ''
}

/** A month's band over the days: its left edge and width (px) clipped to the strip, its title. */
export interface MonthBand {
  key: string
  x: number
  w: number
  label: string
}

/** The months touched by days first..last; `xOf` — a day's left edge, `width` — the strip's width. */
export function monthBands(first: number, last: number, xOf: (n: number) => number, width: number): MonthBand[] {
  const out: MonthBand[] = []
  let n = first
  while (n <= last) {
    const k = dayKey(n)
    const start = dayNum(`${k.slice(0, 7)}-01`)
    const y = +k.slice(0, 4)
    const m = +k.slice(5, 7)
    const next = dayNum(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`)
    const x = Math.max(0, xOf(start))
    out.push({ key: k.slice(0, 7), x, w: Math.min(width, xOf(next)) - x, label: `${MONTHS[m - 1]} ${y}` })
    n = next
  }
  return out
}

/** Only the first letter up (CSS capitalize would make «2026 Г.»). */
export const capFirst = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1)

/** A date as Russian text («5 октября»…). */
export const fmtDay = (d: string, o: Intl.DateTimeFormatOptions): string => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', o)

/** The shown range as a title: one day — in full; several — «5 окт. — 11 окт. 2026 г.». */
export function rangeTitle(start: number, span: number): string {
  const a = dayKey(Math.floor(start + 0.01))
  const b = dayKey(Math.ceil(start + span - 0.01) - 1)
  return a >= b ? fmtDay(a, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : `${fmtDay(a, { day: 'numeric', month: 'short' })} — ${fmtDay(b, { day: 'numeric', month: 'short', year: 'numeric' })}`
}
