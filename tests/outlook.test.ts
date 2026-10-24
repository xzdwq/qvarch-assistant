import { describe, expect, it } from 'vitest'
import { applyMeetings, type OutlookEvent } from '../src/shared/outlook'
import { DEFAULT_KINDS } from '../src/shared/kinds'
import type { DayData, Entry } from '../src/shared/types'

const DAY = '2026-10-12'
const t = (hm: string) => new Date(`${DAY}T${hm}:00`).getTime()
let n = 0
const id = () => `id${++n}`
const day = (entries: Entry[] = []): DayData => ({ day: DAY, calls: [], entries, notes: [] })
const ev = (p: Partial<OutlookEvent>): OutlookEvent => ({
  id: 'ev1',
  subject: 'ABC: Daily',
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

describe('Outlook meetings on the timeline', () => {
  it('a meeting becomes a "Встреча" block and follows Outlook while untouched', () => {
    const d = day()
    expect(applyMeetings(d, [ev({})], DEFAULT_KINDS, id)).toBe(true)
    expect(d.entries).toHaveLength(1)
    expect(d.entries[0]).toMatchObject({ kind: 'meeting', label: 'ABC: Daily', source: 'outlook', start: t('10:15') })
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
