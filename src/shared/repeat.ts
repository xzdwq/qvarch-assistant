import type { Ms } from './types'

/**
 * Repeats and reminders.
 *  A repeat makes copies of a block every hour / day / week / year — a series (they stay tied by its id:
 *  an edit or a delete can go to one of them or to all).
 *  A reminder: "at the start" (or N minutes before it) — follows the block when it moves; or at a set time.
 */

/** A calendar step of k units (a day stays the same local time across DST). */
const calendarStep = (step: (d: Date, k: number) => void) => (t: Ms, k: number): Ms => {
  const d = new Date(t)
  step(d, k)
  return d.getTime()
}

/** Each rule: its menu names, how many copies it makes, how it steps. */
const REPEAT_RULE_DEFS = {
  hour: { label: 'Каждый час', every: 'каждый час', count: 8, shift: (t: Ms, k: number): Ms => t + k * 3_600_000 },
  day: { label: 'Каждый день', every: 'каждый день', count: 10, shift: calendarStep((d, k) => d.setDate(d.getDate() + k)) },
  week: { label: 'Каждую неделю', every: 'каждую неделю', count: 8, shift: calendarStep((d, k) => d.setDate(d.getDate() + 7 * k)) },
  year: { label: 'Каждый год', every: 'каждый год', count: 3, shift: calendarStep((d, k) => d.setFullYear(d.getFullYear() + k)) },
}
export type RepeatRule = keyof typeof REPEAT_RULE_DEFS
export const REPEAT_RULES: Array<{ id: RepeatRule; label: string; every: string; count: number }> = (Object.keys(REPEAT_RULE_DEFS) as RepeatRule[]).map(
  (id) => ({ id, label: REPEAT_RULE_DEFS[id].label, every: REPEAT_RULE_DEFS[id].every, count: REPEAT_RULE_DEFS[id].count }),
)

/** The k-th repeat of a moment (calendar steps: a day stays the same local time across DST). */
export function shiftBy(t: Ms, rule: RepeatRule, k: number): Ms {
  return REPEAT_RULE_DEFS[rule].shift(t, k)
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
