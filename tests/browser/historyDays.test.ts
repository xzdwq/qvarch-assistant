import { describe, expect, it } from 'vitest'
import type { Visit } from '../../src/shared/browser'
import { dayBounds, dayOf, dayTitle, findVisits, historyDays, plural } from '../../src/shared/browser/historyDays'

const now = new Date(2026, 4, 14, 15, 0).getTime()
const visit = (id: string, at: number, title = id, url = `https://site.test/${id}`): Visit => ({ id, url, title, at })
const h = 3600e3
const visits = [visit('a', now - 1 * h, 'Orders'), visit('b', now - 2 * h, 'Clients'), visit('c', now - 20 * h, 'Orders list'), visit('d', now - 50 * h, 'Settings')]

describe('the history by days', () => {
  it("a day's key and title", () => {
    expect(dayOf(now)).toBe('2026-05-14')
    expect(dayTitle('2026-05-14', now)).toBe('Сегодня')
    expect(dayTitle('2026-05-13', now)).toBe('Вчера')
    expect(dayTitle('2026-05-12', now)).toMatch(/12 мая/)
    expect(dayTitle('2025-05-12', now)).toMatch(/2025/)
  })
  it('found by every word, in the title or the address', () => {
    expect(findVisits(visits, '').length).toBe(4)
    expect(findVisits(visits, 'orders').map((v) => v.id)).toEqual(['a', 'c'])
    expect(findVisits(visits, 'orders LIST').map((v) => v.id)).toEqual(['c'])
    expect(findVisits(visits, 'site.test/d').map((v) => v.id)).toEqual(['d'])
  })
  it('grouped by day, cut at the limit, each day with its whole count', () => {
    const days = historyDays(visits, 3, now)
    expect(days.map((d) => [d.k, d.items.map((v) => v.id), d.total])).toEqual([
      ['2026-05-14', ['a', 'b'], 2],
      ['2026-05-13', ['c'], 1],
    ])
    expect(days[0].title).toBe('Сегодня')
  })
  it("a day's bounds: its midnight and the next", () => {
    const b = dayBounds('2026-05-14')
    expect(new Date(b.from).getHours()).toBe(0)
    expect(dayOf(b.from)).toBe('2026-05-14')
    expect(dayOf(b.to)).toBe('2026-05-15')
  })
  it('pages counted in words', () => {
    expect([1, 3, 5, 21].map((n) => plural(n, 'страницу', 'страницы', 'страниц'))).toEqual(['страницу', 'страницы', 'страниц', 'страницу'])
  })
})
