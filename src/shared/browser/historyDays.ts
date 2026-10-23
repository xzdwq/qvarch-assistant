import type { Visit } from './tabs'

/** The history by days: the visits found by words, grouped under each day's title. */

/** A moment's day as a key: «2024-05-03» (local time). */
export const dayOf = (t: number) => new Date(t).toLocaleDateString('sv-SE')
/** A day's title: «Сегодня», «Вчера», else its weekday and date (the year only when not this one). */
export function dayTitle(k: string, now = Date.now()): string {
  const today = dayOf(now)
  if (k === today) return 'Сегодня'
  if (k === dayOf(now - 864e5)) return 'Вчера'
  return new Date(`${k}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: k.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })
}
/** The visits holding every word of the search (in the title or the address, any case). */
export function findVisits(visits: Visit[], q: string): Visit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return visits
  return visits.filter((v) => {
    const s = `${v.title} ${v.url}`.toLowerCase()
    return words.every((w) => s.includes(w))
  })
}
export interface HistoryDay {
  k: string
  title: string
  items: Visit[]
  /** All the day's visits found (more than shown when cut at the limit). */
  total: number
}
/** The visits (newest first) by days — the first `limit` of them shown, each day with its whole count. */
export function historyDays(found: Visit[], limit: number, now = Date.now()): HistoryDay[] {
  const out: HistoryDay[] = []
  const totals = new Map<string, number>()
  for (const v of found) totals.set(dayOf(v.at), (totals.get(dayOf(v.at)) ?? 0) + 1)
  for (const v of found.slice(0, limit)) {
    const k = dayOf(v.at)
    let d = out[out.length - 1]
    if (!d || d.k !== k) out.push((d = { k, title: dayTitle(k, now), items: [], total: totals.get(k) ?? 0 }))
    d.items.push(v)
  }
  return out
}
/** A day's bounds (ms): its midnight and the next one. */
export function dayBounds(k: string): { from: number; to: number } {
  const from = new Date(`${k}T00:00:00`)
  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  return { from: from.getTime(), to: to.getTime() }
}
/** 1 страница, 2 страницы, 5 страниц. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10
  const b = n % 100
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many
}
