/**
 * Timestamps: whatever is pasted (Unix seconds / ms / µs / ns, ISO 8601, RFC 2822, «18.10.2026 15:30»,
 * SQL «2026-10-18 15:30:00», Excel's day number) → one moment; that moment written every usual way.
 */
export const TS_UNITS = ['s', 'ms', 'us', 'ns'] as const
export type TsUnit = (typeof TS_UNITS)[number]
/** A number in a unit → ms. */
const TO_MS: Record<TsUnit, (v: number) => number> = { s: (v) => v * 1000, ms: (v) => v, us: (v) => v / 1000, ns: (v) => v / 1e6 }

/** A number's unit by its size (as today's moments are written: 10 digits — s, 13 — ms, 16 — µs, 19 — ns). */
export function unitOf(digits: string): TsUnit {
  const n = digits.replace(/^-/, '').split('.')[0].length
  return n <= 11 ? 's' : n <= 14 ? 'ms' : n <= 17 ? 'us' : 'ns'
}
const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0')

/** Any text → ms since 1970 (undefined — not a moment). `unit` forces the unit of a bare number. */
export function parseMoment(input: string, unit?: TsUnit, now = Date.now()): number | undefined {
  const s = input.trim()
  if (!s) return undefined
  if (/^(now|сейчас|today|сегодня)$/i.test(s)) return now
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const ms = TO_MS[unit ?? unitOf(s)](Number(s))
    return Number.isFinite(ms) && Math.abs(ms) < 8.64e15 ? Math.round(ms) : undefined
  }
  // dd.mm.yyyy [hh:mm[:ss]]
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?)?$/.exec(s)
  if (m) return local(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), +(m[7] ?? '0').padEnd(3, '0'))
  // SQL / ISO without a zone — local time
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?$/.exec(s)
  if (m) return local(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), +(m[7] ?? '0').slice(0, 3).padEnd(3, '0'))
  // ISO with a zone, RFC 2822 / HTTP dates: the platform reads them
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, '$1'))
  return Number.isNaN(t) ? undefined : t
}
function local(y: number, mo: number, d: number, h: number, mi: number, sec: number, ms: number): number | undefined {
  const dt = new Date(y, mo - 1, d, h, mi, sec, ms)
  // 31.02 and the like
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return undefined
  return dt.getTime()
}

/** The time zone's offset at a moment, minutes east of UTC. */
export function offsetIn(ms: number, tz?: string): number {
  if (!tz) return -new Date(ms).getTimezoneOffset()
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour') % 24, v('minute'), v('second'))
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000)
}
const offStr = (min: number) => `${min < 0 ? '-' : '+'}${pad(Math.abs(min) / 60)}:${pad(Math.abs(min) % 60)}`

/** ISO 8601 with the zone's own offset (2026-10-18T15:30:00.000+03:00). */
export function isoIn(ms: number, tz?: string): string {
  const off = offsetIn(ms, tz)
  const d = new Date(ms + off * 60000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}${offStr(off)}`
}
/** SQL style, in a zone (2026-10-18 15:30:00). */
export function sqlIn(ms: number, tz?: string): string {
  return isoIn(ms, tz).slice(0, 19).replace('T', ' ')
}
/** Excel / LibreOffice: days since 30.12.1899 (local time), with the time as the fraction. */
export function toExcel(ms: number): number {
  const off = offsetIn(ms)
  return Math.round(((ms + off * 60000) / 864e5 + 25569) * 1e6) / 1e6
}
export function fromExcel(serial: number): number {
  const approx = (serial - 25569) * 864e5
  return Math.round(approx - offsetIn(approx) * 60000)
}
/** ISO week number and its year. */
export function isoWeek(ms: number): { week: number; year: number } {
  const d = new Date(ms)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return { week: Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7), year: t.getUTCFullYear() }
}
/** «3 дня назад» / «через 2 часа». */
export function relative(ms: number, now = Date.now()): string {
  const diff = ms - now
  const a = Math.abs(diff) / 1000
  const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' })
  const sign = Math.sign(diff) || 1
  if (a < 45) return a < 2 ? 'сейчас' : rtf.format(Math.round(sign * a), 'second')
  if (a < 2700) return rtf.format(Math.round((sign * a) / 60), 'minute')
  if (a < 64800) return rtf.format(Math.round((sign * a) / 3600), 'hour')
  if (a < 26 * 86400) return rtf.format(Math.round((sign * a) / 86400), 'day')
  if (a < 320 * 86400) return rtf.format(Math.round((sign * a) / (30.44 * 86400)), 'month')
  return rtf.format(Math.round((sign * a) / (365.25 * 86400)), 'year')
}
