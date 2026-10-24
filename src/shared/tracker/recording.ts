import { firstFreeLane, laneIsFree, MINUTE, pinLanes, putEntry } from '../timeline'
import type { Entry, Ms } from '../types'

/**
 * «Запись»: an event whose end follows the clock while it is recorded (as a detected call's does) — any number of
 * them at once, each marked on itself (`Entry.recording`). One going on now stretches; one ahead waits for its time
 * and stretches once its planned end has passed. It runs along a free lane, the first one first; when the next
 * stretch would run into another event it moves down to a lane free for all of it. It stops by itself at the end of
 * the work day (when it began before it and the setting says so) and at midnight.
 */

/** An event still counts as going on this long after its end (a recording may be started on it). */
export const RECORD_GRACE_MS = 3 * MINUTE
/** A recording whose end lags this far behind the clock was not followed (the app was closed) — it is over. */
export const RECORD_STALE_MS = 2 * MINUTE

/** A recording may be started on it: going on (or just over) or ahead; not an Outlook meeting, not a detected call. */
export const canRecord = (e: Pick<Entry, 'end' | 'outlook' | 'source'>, now: Ms) => !e.outlook && e.source !== 'detected' && now <= e.end + RECORD_GRACE_MS

export interface RecordLimits {
  /** The work day's end (none — a day off). */
  workEnd?: Ms
  stopAtWorkEnd: boolean
  dayEnd: Ms
}
/**
 * The recording's step now: its end (stretched to the clock — never shortened) and whether it is over (it hit the end
 * of the work day / of the day). Ahead of its start — nothing yet.
 */
export function recordingStep(e: Pick<Entry, 'start' | 'end'>, now: Ms, l: RecordLimits): { end: Ms; stop: boolean } {
  if (now < e.start) return { end: e.end, stop: false }
  // the work day's end stops it only when it began before it (one started in the evening goes on)
  const limit = l.stopAtWorkEnd && l.workEnd !== undefined && e.start < l.workEnd ? Math.min(l.workEnd, l.dayEnd) : l.dayEnd
  return { end: Math.max(e.end, e.start + MINUTE, Math.min(now, limit)), stop: now >= limit }
}
/** A recording found when the app starts: it was stretching and the app was closed meanwhile — it ends where it got. */
export const isStaleRecording = (e: Pick<Entry, 'start' | 'end'>, now: Ms) => e.start < now && e.end < now - RECORD_STALE_MS

/** The recording's event stretched to `end`: on its lane while that stays free, else on the first lane free for it all. */
export function extendRecording(entries: Entry[], id: string, end: Ms): Entry[] {
  const e = entries.find((x) => x.id === id)
  if (!e || end <= e.start) return entries
  if (end === e.end) return entries
  const lane = laneIsFree(entries, e.lane ?? 0, e.start, end, id) ? e.lane : firstFreeLane(entries, e.start, end, id)
  return pinLanes(putEntry(entries, { ...e, end, lane }), id)
}
