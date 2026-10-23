import { firstFreeLane, laneIsFree, MINUTE, pinLanes, putEntry } from '../timeline'
import type { Entry, Ms } from '../types'

export type { RecordingState } from '../types'

/**
 * «Запись»: an event that goes on from the moment it is started until it is stopped — its end follows the clock
 * (as a detected call's does). It runs along a free lane, the first one first; when the next stretch would run into
 * another event it moves down to a lane free for all of it. It stops by itself at the end of the work day (when it
 * began before it and the setting says so) and at midnight.
 */

/** Where the recording's end is now, and whether it is over (it hit the end of the work day / of the day). */
export function recordingEnd(start: Ms, now: Ms, limits: { workEnd?: Ms; stopAtWorkEnd: boolean; dayEnd: Ms }): { end: Ms; stop: boolean } {
  // the work day's end stops it only when it began before it (one started in the evening goes on)
  const limit = limits.stopAtWorkEnd && limits.workEnd !== undefined && start < limits.workEnd ? Math.min(limits.workEnd, limits.dayEnd) : limits.dayEnd
  const end = Math.max(start + MINUTE, Math.min(now, limit))
  return { end, stop: now >= limit }
}

/** The recording's event stretched to `end`: on its lane while that stays free, else on the first lane free for it all. */
export function extendRecording(entries: Entry[], id: string, end: Ms): Entry[] {
  const e = entries.find((x) => x.id === id)
  if (!e || end <= e.start) return entries
  const lane = laneIsFree(entries, e.lane ?? 0, e.start, end, id) ? e.lane : firstFreeLane(entries, e.start, end, id)
  return pinLanes(putEntry(entries, { ...e, end, lane }), id)
}
