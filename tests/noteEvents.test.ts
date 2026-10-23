import { describe, expect, it } from 'vitest'
import { eventLink, parseNoteLink, pickGroups, statusOf, statusText, type EventRef } from '../src/shared/noteEvents'

const H = 36e5
const now = new Date(2026, 9, 18, 12, 0).getTime()
const ev = (id: string, startH: number, durH: number, extra: Partial<EventRef> = {}): EventRef => {
  const start = now + startH * H
  const d = new Date(start)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { day, id, label: `Событие ${id}`, kind: 'task', start, end: start + durH * H, outlook: false, ...extra }
}

describe('events in notes', () => {
  it('links round-trip', () => {
    const l = eventLink({ day: '2026-10-18', id: 'ab-12', label: 'Созвон [важный]' })
    expect(l).toBe('[Созвон  важный](qvarch://event/2026-10-18/ab-12)'.replace('  ', ' '))
    expect(parseNoteLink('qvarch://event/2026-10-18/ab-12')).toEqual({ kind: 'event', day: '2026-10-18', id: 'ab-12' })
    expect(parseNoteLink('qvarch://jira/ABC-12')).toEqual({ kind: 'jira', key: 'ABC-12' })
    expect(parseNoteLink('https://x')).toBeUndefined()
  })
  it('knows done / going on / ahead', () => {
    expect(statusOf(ev('a', -2, 1), now)).toBe('done')
    expect(statusOf(ev('a', -1, 2), now)).toBe('now')
    expect(statusText(ev('a', 2, 1), now)).toBe('через 2 ч')
  })
  it('keeps planned meetings from filling the list', () => {
    const all = [
      ev('now', -0.5, 1),
      ev('morning', -3, 1),
      ev('yesterday', -24, 1),
      ev('old-outlook', -24 * 90, 1, { outlook: true }),
      ev('old-own', -24 * 90, 1),
      ...Array.from({ length: 40 }, (_, i) => ev(`plan${i}`, 24 * (i + 1), 1, { outlook: true })),
    ]
    const g = pickGroups(all, '', now, ev('x', 0, 1).day)
    expect(g.today.map((e) => e.id)).toEqual(['now', 'morning'])
    expect(g.past.map((e) => e.id)).toEqual(['yesterday', 'old-own'])
    expect(g.ahead.length).toBe(8)
    expect(g.ahead[0].id).toBe('plan0')
    expect(g.more.ahead).toBe(14 - 8)
    // a search reaches the old meeting and further plans
    expect(pickGroups(all, 'old-outlook', now, ev('x', 0, 1).day).past.map((e) => e.id)).toEqual(['old-outlook'])
    expect(pickGroups(all, 'plan30', now, ev('x', 0, 1).day).ahead.map((e) => e.id)).toEqual(['plan30'])
  })
})
