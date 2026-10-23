import type { Exchange } from '../traffic'

/** The words of the `qa` checks: counts, paths, a request's line, a step's failure. */

/** 1 поле, 2 поля, 5 полей. */
export const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10
  const dd = n % 100
  return d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many
}
/** A request's path with its ids (uuid) as :id. */
export const pathOf = (u: string) => {
  try {
    const x = new URL(u)
    return x.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
  } catch {
    return u
  }
}
/** A step's failure in words: «Timeout exceeded» says little — what it waited for (Playwright's call log names it). */
export const stepError = (e: unknown, sec: number) => {
  const m = (e instanceof Error ? e.message : String(e)).replace(/\u001b\[[\d;]*m/g, '')
  const what = /waiting for (.+)/.exec(m)?.[1]
  return /Timeout \d+ms exceeded/.test(m) && what ? `не найден или недоступен за ${sec} с: ${what.trim()}` : m.split('\n')[0]
}
export const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s)
/** A request and its answer in one line: «POST /api/x → 200». */
export const line = (x: Exchange) => `${x.method} ${pathOf(x.url)} → ${x.status === undefined ? '…' : x.status === 0 ? 'не дошёл' : x.status}`
