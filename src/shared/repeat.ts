import type { Ms } from './types'

/**
 * Repeats and reminders.
 *  A repeat makes copies of a block every hour / day / week / year — a series (they stay tied by its id:
 *  an edit or a delete can go to one of them or to all).
 *  A reminder: "at the start" (or N minutes before it) — follows the block when it moves; or at a set time.
 */
export type RepeatRule = 'hour' | 'day' | 'week' | 'year'
export const REPEAT_RULES: Array<{ id: RepeatRule; label: string; every: string; count: number }> = [
  { id: 'hour', label: 'Каждый час', every: 'каждый час', count: 8 },
  { id: 'day', label: 'Каждый день', every: 'каждый день', count: 10 },
  { id: 'week', label: 'Каждую неделю', every: 'каждую неделю', count: 8 },
  { id: 'year', label: 'Каждый год', every: 'каждый год', count: 3 },
]

/** The k-th repeat of a moment (calendar steps: a day stays the same local time across DST). */
export function shiftBy(t: Ms, rule: RepeatRule, k: number): Ms {
  if (rule === 'hour') return t + k * 3_600_000
  const d = new Date(t)
  if (rule === 'day') d.setDate(d.getDate() + k)
  else if (rule === 'week') d.setDate(d.getDate() + 7 * k)
  else d.setFullYear(d.getFullYear() + k)
  return d.getTime()
}

export interface Remind {
  /** Minutes before the start (0 — at the start); follows the block. */
  before?: number
  /** A set moment (when not tied to the start). */
  at?: Ms
  /** Already shown. */
  fired?: boolean
}
/** When the reminder goes off for a thing starting at `start` (a note: its moment). */
export function remindAt(r: Remind | undefined, start: Ms): Ms | undefined {
  if (!r) return undefined
  if (r.at !== undefined) return r.at
  return start - (r.before ?? 0) * 60_000
}
export const REMIND_BEFORE = [0, 5, 10, 15, 30, 60]
export const beforeLabel = (m: number) => (m === 0 ? 'в начале' : m < 60 ? `за ${m} мин` : `за ${m / 60} ч`)
