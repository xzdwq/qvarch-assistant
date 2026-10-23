import { dayEnd, dayStart, firstFreeLane } from './timeline'
import type { DayData, Entry, KindDef, Ms } from './types'
import { isKind } from './tracker/constants'

/**
 * Outlook meetings on the timeline (calls are blocks of their own — not tied to meetings).
 *  - a meeting becomes a "Встреча" block; it follows Outlook until the user edits it (then it is theirs),
 *    a block the user deleted is not brought back, a meeting cancelled / declined in Outlook goes away;
 */

/** Where meetings come from: the classic Outlook on this computer (COM) or Microsoft Graph. */
export const OUTLOOK_SOURCES = ['local', 'graph'] as const
export type OutlookSource = (typeof OUTLOOK_SOURCES)[number]
/** How an event shows the time — Graph's names; the index is Outlook's OlBusyStatus (Graph alone may say "unknown"). */
export const OUTLOOK_SHOW_AS = ['free', 'tentative', 'busy', 'oof', 'workingElsewhere', 'unknown'] as const
export type OutlookShowAs = (typeof OUTLOOK_SHOW_AS)[number]
/** The user's answer to an event — Graph's names; the index is Outlook's OlResponseStatus. */
export const OUTLOOK_RESPONSES = ['none', 'organizer', 'tentativelyAccepted', 'accepted', 'declined', 'notResponded'] as const
export type OutlookResponse = (typeof OUTLOOK_RESPONSES)[number]

export interface OutlookEvent {
  id: string
  subject: string
  start: Ms
  end: Ms
  allDay: boolean
  cancelled: boolean
  showAs: OutlookShowAs
  response: OutlookResponse
  organizer?: string
  online: boolean
  joinUrl?: string
  location?: string
  attendees: number
}

export interface OutlookState {
  /** local — the classic Outlook on this computer (COM); graph — Microsoft Graph (needs the org's consent). */
  source: OutlookSource
  configured: boolean
  connected: boolean
  account?: { name: string; email?: string }
  syncing: boolean
  syncedAt?: number
  error?: string
  /** The Teams status, polled while connected. */
  presence?: { availability: string; activity: string; at: number }
}

/** Presence activities meaning "in a call right now" (InAMeeting is only the calendar saying so — not used). */
export const CALL_ACTIVITIES = ['InACall', 'InAConferenceCall', 'Presenting']

/** Does a meeting belong on the timeline? */
export const wanted = (e: OutlookEvent): boolean => !e.allDay && !e.cancelled && e.showAs !== 'free' && e.response !== 'declined' && e.end > e.start

const sig = (start: Ms, end: Ms, label: string) => `${start}|${end}|${label}`
/** The kind of a meeting's block: «Встреча», else «Созвон», else the first kind there is. */
const meetingKind = (kinds: KindDef[]) => kinds.find((k) => isKind(k.id, 'meeting'))?.id ?? kinds.find((k) => isKind(k.id, 'call'))?.id ?? kinds[0]?.id ?? 'meeting'

export function describe(e: OutlookEvent): string | undefined {
  const parts = [
    e.organizer ? `Организатор: ${e.organizer}` : '',
    e.online ? 'Teams' : '',
    e.location && !/microsoft teams/i.test(e.location) ? e.location : '',
    e.attendees ? `участников: ${e.attendees}` : '',
    e.response === 'tentativelyAccepted' || e.showAs === 'tentative' ? 'под вопросом' : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

/**
 * Brings one day's meeting blocks in line with Outlook (`events` — every event of the synced window).
 * Returns true when the day changed.
 */
export function applyMeetings(d: DayData, events: OutlookEvent[], kinds: KindDef[], newId: () => string): boolean {
  const from = dayStart(d.day)
  const to = dayEnd(d.day)
  const dismissed = new Set(d.outlookDismissed ?? [])
  let changed = false
  const seen = new Set<string>()
  for (const ev of events) {
    const start = Math.max(ev.start, from)
    const end = Math.min(ev.end, to)
    if (end <= start || !wanted(ev)) continue
    seen.add(ev.id)
    if (dismissed.has(ev.id)) continue
    const label = ev.subject.trim() || 'Встреча'
    const meta = { id: ev.id, sig: sig(start, end, label), online: ev.online || undefined, joinUrl: ev.joinUrl, organizer: ev.organizer }
    const existing = d.entries.find((x) => x.outlook?.id === ev.id)
    if (existing) {
      const untouched = sig(existing.start, existing.end, existing.label) === existing.outlook!.sig
      if (untouched && existing.outlook!.sig !== meta.sig) {
        existing.start = start
        existing.end = end
        existing.label = label
        existing.description = describe(ev)
        existing.outlook = meta
        changed = true
      }
      continue
    }
    const entry: Entry = {
      id: newId(),
      start,
      end,
      kind: meetingKind(kinds),
      label,
      description: describe(ev),
      source: 'outlook',
      lane: firstFreeLane(d.entries, start, end),
      outlook: meta,
    }
    d.entries.push(entry)
    changed = true
  }
  // gone from Outlook (deleted / cancelled / declined): an untouched block goes too
  const before = d.entries.length
  const edited = (x: Entry) => sig(x.start, x.end, x.label) !== x.outlook!.sig
  d.entries = d.entries.filter((x) => !x.outlook || seen.has(x.outlook.id) || edited(x))
  return changed || d.entries.length !== before
}
