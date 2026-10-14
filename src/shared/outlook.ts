import { addLink, remapLinks } from './links'
import { dayEnd, dayStart, firstFreeLane, overlap } from './timeline'
import type { DayData, Entry, KindDef, Ms } from './types'

/**
 * Outlook (Microsoft Graph) meetings on the timeline, and calls linked to the meetings they belong to.
 *  - a meeting becomes a "Встреча" block; it follows Outlook until the user edits it (then it is theirs),
 *    a block the user deleted is not brought back, a meeting cancelled / declined in Outlook goes away;
 *  - a call (detected separately, by the mic or the Teams status) is linked to the meeting it happened in:
 *    it may start earlier or later and run longer than planned — any real overlap counts.
 */
export interface OutlookEvent {
  id: string
  subject: string
  start: Ms
  end: Ms
  allDay: boolean
  cancelled: boolean
  /** free / tentative / busy / oof / workingElsewhere */
  showAs: string
  /** none / organizer / accepted / tentativelyAccepted / declined / notResponded */
  response: string
  organizer?: string
  online: boolean
  joinUrl?: string
  location?: string
  attendees: number
}

export interface OutlookState {
  /** local — the classic Outlook on this computer (COM); graph — Microsoft Graph (needs the org's consent). */
  source: 'local' | 'graph'
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
const meetingKind = (kinds: KindDef[]) => kinds.find((k) => k.id === 'meeting')?.id ?? kinds.find((k) => k.id === 'call')?.id ?? kinds[0]?.id ?? 'meeting'

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

/** The pair key of a link (order-free) — for remembering links the user removed. */
export const pairKey = (a: string, b: string): string => [a, b].sort().join('|')

/**
 * Links each call block to the meeting(s) it happened in. A call may start before the meeting, join late
 * or run over: it belongs to every meeting it overlaps by ≥ 5 min (or half of a short meeting); failing
 * that, to the one it overlaps most. A link the user removed is not made again. Returns true on change.
 */
export function linkCallsToMeetings(d: DayData, kinds: KindDef[], newId: () => string, at: Ms): boolean {
  const callKind = kinds.find((k) => k.id === 'call')?.id ?? 'call'
  const calls = d.entries.filter((e) => e.kind === callKind && !e.outlook)
  const meetings = d.entries.filter((e) => e.outlook)
  if (!calls.length || !meetings.length) return false
  const dismissed = new Set(d.linkDismissed ?? [])
  let links = d.links ?? []
  const before = links.length
  for (const c of calls) {
    const scored = meetings.map((m) => ({ m, ov: overlap(c.start, c.end, m.start, m.end) })).filter((x) => x.ov > 0)
    if (!scored.length) continue
    const strong = scored.filter((x) => x.ov >= Math.min(5 * 60_000, (x.m.end - x.m.start) / 2))
    const picked = strong.length ? strong : [scored.reduce((a, b) => (b.ov > a.ov ? b : a))]
    for (const { m } of picked) {
      if (dismissed.has(pairKey(c.id, m.id))) continue
      const next = addLink(links, { type: 'entry', id: c.id }, { type: 'entry', id: m.id }, newId(), at)
      if (next !== links) {
        next[next.length - 1].auto = true
        links = next
      }
    }
  }
  if (links.length === before) return false
  d.links = links
  return true
}

/**
 * "Фактическое время из …": `keepId` gets the time of `fromId` (a linked block — e.g. the call that really
 * happened in a planned meeting) and `fromId` goes; its links, call and notes move over. An Outlook meeting
 * is always the one kept (deleted, it would come back with the next sync): picking the meeting from its call
 * keeps the meeting with its own time. Two meetings are not merged. Returns the kept block's id.
 */
export function adoptTime(d: DayData, keepId: string, fromId: string): string | undefined {
  const a = d.entries.find((e) => e.id === keepId)
  const b = d.entries.find((e) => e.id === fromId)
  if (!a || !b || a === b || (a.outlook && b.outlook)) return undefined
  const [keep, gone] = b.outlook ? [b, a] : [a, b]
  keep.start = b.start
  keep.end = b.end
  d.entries = d.entries.filter((e) => e !== gone)
  if (d.links) d.links = remapLinks(d.links, [gone.id], keep.id)
  for (const c of d.calls) if (c.entryId === gone.id) c.entryId = keep.id
  for (const n of d.notes) if (n.entryId === gone.id) n.entryId = keep.id
  return keep.id
}

