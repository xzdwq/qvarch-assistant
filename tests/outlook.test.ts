import { describe, expect, it } from 'vitest'
import { adoptTime, applyMeetings, linkCallsToMeetings, pairKey, type OutlookEvent } from '../src/shared/outlook'
import { DEFAULT_KINDS } from '../src/shared/kinds'
import type { DayData, Entry } from '../src/shared/types'

const DAY = '2026-10-12'
const t = (hm: string) => new Date(`${DAY}T${hm}:00`).getTime()
let n = 0
const id = () => `id${++n}`
const day = (entries: Entry[] = []): DayData => ({ day: DAY, spans: [], activity: [], calls: [], entries, notes: [] })
const ev = (p: Partial<OutlookEvent>): OutlookEvent => ({
  id: 'ev1',
  subject: 'DOS: Daily',
  start: t('10:15'),
  end: t('10:30'),
  allDay: false,
  cancelled: false,
  showAs: 'busy',
  response: 'accepted',
  online: true,
  attendees: 5,
  ...p,
})
const call = (a: string, b: string): Entry => ({ id: `call${a}`, start: t(a), end: t(b), kind: 'call', label: 'Созвон Teams', source: 'detected' })

describe('Outlook meetings on the timeline', () => {
  it('a meeting becomes a "Встреча" block and follows Outlook while untouched', () => {
    const d = day()
    expect(applyMeetings(d, [ev({})], DEFAULT_KINDS, id)).toBe(true)
    expect(d.entries).toHaveLength(1)
    expect(d.entries[0]).toMatchObject({ kind: 'meeting', label: 'DOS: Daily', source: 'outlook', start: t('10:15') })
    applyMeetings(d, [ev({ start: t('10:20'), end: t('10:40') })], DEFAULT_KINDS, id)
    expect(d.entries[0]).toMatchObject({ start: t('10:20'), end: t('10:40') })
  })
  it("the user's edit wins over Outlook; a deleted (dismissed) meeting is not brought back", () => {
    const d = day()
    applyMeetings(d, [ev({})], DEFAULT_KINDS, id)
    d.entries[0].label = 'Дейли — обсудили релиз'
    applyMeetings(d, [ev({ start: t('11:00'), end: t('11:15') })], DEFAULT_KINDS, id)
    expect(d.entries[0]).toMatchObject({ label: 'Дейли — обсудили релиз', start: t('10:15') })
    const d2 = day()
    d2.outlookDismissed = ['ev1']
    expect(applyMeetings(d2, [ev({})], DEFAULT_KINDS, id)).toBe(false)
    expect(d2.entries).toHaveLength(0)
  })
  it('cancelled / declined / free / all-day meetings are not blocks; a cancelled one goes away', () => {
    const d = day()
    applyMeetings(d, [ev({}), ev({ id: 'x' }), ev({ id: 'f', showAs: 'free' }), ev({ id: 'a', allDay: true })], DEFAULT_KINDS, id)
    expect(d.entries.map((e) => e.outlook?.id)).toEqual(['ev1', 'x'])
    applyMeetings(d, [ev({ cancelled: true }), ev({ id: 'x', response: 'declined' })], DEFAULT_KINDS, id)
    expect(d.entries).toHaveLength(0)
  })
})

describe('calls linked to meetings', () => {
  it('links a call that started early and ran over; no link when it did not overlap', () => {
    const d = day([call('10:10', '10:50'), call('12:00', '12:20')])
    applyMeetings(d, [ev({})], DEFAULT_KINDS, id)
    expect(linkCallsToMeetings(d, DEFAULT_KINDS, id, 0)).toBe(true)
    expect(d.links).toHaveLength(1)
    expect(d.links![0]).toMatchObject({ auto: true, a: { id: 'call10:10' } })
    // again — nothing new
    expect(linkCallsToMeetings(d, DEFAULT_KINDS, id, 0)).toBe(false)
  })
  it('a long call over two back-to-back meetings is linked to both; a removed auto link is not made again', () => {
    const d = day([call('10:14', '11:05')])
    applyMeetings(d, [ev({}), ev({ id: 'ev2', subject: 'Ревью', start: t('10:30'), end: t('11:00') })], DEFAULT_KINDS, id)
    linkCallsToMeetings(d, DEFAULT_KINDS, id, 0)
    expect(d.links).toHaveLength(2)
    const m2 = d.entries.find((e) => e.outlook?.id === 'ev2')!
    d.links = d.links!.filter((l) => l.b.id !== m2.id)
    d.linkDismissed = [pairKey('call10:14', m2.id)]
    linkCallsToMeetings(d, DEFAULT_KINDS, id, 0)
    expect(d.links).toHaveLength(1)
  })
  it('a call that joined late, briefly, still belongs to the meeting it overlapped most', () => {
    const d = day([call('10:28', '10:45')])
    applyMeetings(d, [ev({})], DEFAULT_KINDS, id)
    linkCallsToMeetings(d, DEFAULT_KINDS, id, 0)
    expect(d.links).toHaveLength(1)
  })
})

describe('the real time of a meeting from its call', () => {
  const T = (h: number, m = 0) => new Date(2026, 9, 12, h, m).getTime()
  const day = (): DayData => ({
    day: '2026-10-12',
    spans: [],
    activity: [],
    calls: [{ start: T(10, 5), end: T(10, 50), app: 'Teams', source: 'mic', entryId: 'c' }],
    notes: [],
    entries: [
      { id: 'm', start: T(10), end: T(11), kind: 'meeting', label: 'Daily', source: 'outlook', outlook: { id: 'ev', sig: 'x' } },
      { id: 'c', start: T(10, 5), end: T(10, 50), kind: 'call', label: 'Созвон Teams', source: 'detected' },
      { id: 'x', start: T(12), end: T(13), kind: 'task', label: 'X', source: 'manual' },
    ],
    links: [
      { id: 'l1', a: { type: 'entry', id: 'c' }, b: { type: 'entry', id: 'm' }, at: 0 },
      { id: 'l2', a: { type: 'entry', id: 'c' }, b: { type: 'entry', id: 'x' }, at: 0 },
    ],
  })
  it('the meeting takes the call time, the call goes, its links and call segment move over', () => {
    const d = day()
    expect(adoptTime(d, 'm', 'c')).toBe('m')
    expect(d.entries.map((e) => e.id)).toEqual(['m', 'x'])
    expect(d.entries[0]).toMatchObject({ start: T(10, 5), end: T(10, 50) })
    expect(d.links).toHaveLength(1)
    expect(d.links![0]).toMatchObject({ a: { id: 'm' }, b: { id: 'x' } })
    expect(d.calls[0].entryId).toBe('m')
  })
  it('picked from the call, the meeting is still the one kept (with its own time)', () => {
    const d = day()
    expect(adoptTime(d, 'c', 'm')).toBe('m')
    expect(d.entries.find((e) => e.id === 'm')).toMatchObject({ start: T(10), end: T(11) })
    expect(d.entries.some((e) => e.id === 'c')).toBe(false)
  })
})
