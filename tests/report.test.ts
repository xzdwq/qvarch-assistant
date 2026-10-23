import { describe, expect, it } from 'vitest'
import { bars, formatHours, groupItems, matches, parseHours, placeTime, takeTime, weekStart } from '../src/shared/report'
import type { Entry } from '../src/shared/types'

const M = 60_000
const H = 60 * M
const DAY = '2026-10-12' // a Monday
const t = (hm: string, day = DAY) => new Date(`${day}T${hm}:00`).getTime()
const E = (id: string, s: string, e: string, extra: Partial<Entry> = {}, day = DAY): Entry => ({ id, start: t(s, day), end: t(e, day), kind: 'task', label: id, source: 'manual', ...extra })

describe('parseHours', () => {
  it('reads what people type', () => {
    expect(parseHours('2h 30m')).toBe(150 * M)
    expect(parseHours('2ч 30м')).toBe(150 * M)
    expect(parseHours('1:30')).toBe(90 * M)
    expect(parseHours('90m')).toBe(90 * M)
    expect(parseHours('45 мин')).toBe(45 * M)
    expect(parseHours('1,5')).toBe(90 * M)
    expect(parseHours('2')).toBe(2 * H)
    expect(parseHours('')).toBe(0)
    expect(parseHours('abc')).toBeUndefined()
  })
  it('formats a cell', () => {
    expect(formatHours(90 * M)).toBe('1:30')
    expect(formatHours(0)).toBe('')
  })
})

describe('the sheet', () => {
  const work: [number, number] = [t('09:00'), t('18:00')]
  const lunch: [number, number] = [t('13:00'), t('14:00')]
  it('puts new time into free working time, around blocks and lunch', () => {
    const busy = [E('a', '09:00', '10:00'), E('b', '11:00', '13:00')]
    expect(placeTime(busy, 90 * M, work, lunch)).toEqual([
      [t('10:00'), t('11:00')],
      [t('14:00'), t('14:30')],
    ])
  })
  it('what does not fit goes after the day', () => {
    expect(placeTime([E('a', '09:00', '18:00')], 30 * M, work)).toEqual([[t('18:00'), t('18:30')]])
  })
  it('takes time from the latest blocks, never from Outlook', () => {
    const blocks = [E('a', '09:00', '10:00'), E('b', '11:00', '11:30'), E('o', '12:00', '13:00', { outlook: { id: 'x', sig: '' } })]
    expect(takeTime(blocks, 45 * M)).toEqual([{ id: 'b', drop: true }, { id: 'a', end: t('09:45') }])
  })
  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-18')).toBe('2026-10-12')
    expect(weekStart('2026-10-12')).toBe('2026-10-12')
  })
})

describe('reports', () => {
  const items = [
    { day: DAY, e: E('m', '10:00', '11:00', { kind: 'meeting' }) },
    { day: DAY, e: E('c', '10:30', '11:30', { kind: 'call', source: 'detected' }) },
    { day: DAY, e: E('j', '12:00', '13:00', { task: { key: 'ABC-1', summary: 's' } }) },
  ]
  it('groups with overlaps counted once inside a group', () => {
    const g = groupItems([...items, { day: DAY, e: E('c2', '10:45', '11:15', { kind: 'call' }) }], 'kind')
    expect(g.find((x) => x.key === 'call')!.ms).toBe(60 * M)
    expect(g.find((x) => x.key === 'meeting')!.ms).toBe(60 * M)
  })
  it('filters', () => {
    expect(items.filter((i) => matches(i.e, { taskType: ['jira'] })).map((i) => i.e.id)).toEqual(['j'])
    expect(items.filter((i) => matches(i.e, { sources: ['call'] })).map((i) => i.e.id)).toEqual(['c'])
    expect(items.filter((i) => matches(i.e, { text: 'abc' })).map((i) => i.e.id)).toEqual(['j'])
  })
  it('bars: total is the union, parts per series', () => {
    const [b] = bars(items, [DAY], 'day', (i) => i.e.kind)
    expect(b.total).toBe(150 * M)
    expect(b.parts.get('call')).toBe(60 * M)
  })
})
