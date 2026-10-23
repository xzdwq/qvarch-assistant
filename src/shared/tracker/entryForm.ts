import type { TaskRef } from '../jira'
import type { Quick } from '../quickadd'
import { REPEAT_RULES, type Remind, type RepeatRule } from '../repeat'
import { dayStart } from '../timeline'
import type { Ms } from '../types'

/**
 * The event card's rules without state: the reminder's modes, the chips' short labels, a block's fallback title,
 * where a quick line puts a new event.
 */

/** A reminder as the card picks it: off · b<N> — N minutes before the start · at — a set time. */
export type RemindMode = 'off' | 'at' | `b${number}`

/** The reminder a mode stands for (`at` — the set time). */
export function remindOf(mode: RemindMode, at: Ms): Remind | undefined {
  if (mode === 'off') return undefined
  return mode === 'at' ? { at } : { before: Number(mode.slice(1)) }
}

/** The mode a saved reminder is shown with. */
export function remindModeOf(r: Remind | undefined): RemindMode {
  if (!r) return 'off'
  return r.at !== undefined ? 'at' : `b${r.before ?? 0}`
}

/** The reminder chip's short label ('' — off). */
export function remindShort(mode: RemindMode, at: Ms): string {
  if (mode === 'off') return ''
  if (mode === 'at') return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const n = Number(mode.slice(1))
  return n === 0 ? 'в начале' : n < 60 ? `за ${n}м` : `за ${n / 60}ч`
}

const REPEAT_SHORT: Record<RepeatRule, string> = { hour: 'час', day: 'день', week: 'нед', year: 'год' }

/** The repeat chip's short label ('' — no repeat). */
export function repeatShort(rule: RepeatRule | '', count: number): string {
  return rule ? `${REPEAT_SHORT[rule]} ×${count}` : ''
}

/** How many copies a repeat rule makes by default. */
export const repeatCountOf = (rule: RepeatRule): number => REPEAT_RULES.find((x) => x.id === rule)!.count

/** «every day» of a series ('' — not a series). */
export const seriesEvery = (rule: RepeatRule | undefined): string => (rule ? (REPEAT_RULES.find((x) => x.id === rule)?.every ?? '') : '')

/**
 * A block's title: its own text; else — a placeholder (a dictation waiting for its transcript), the linked task,
 * the kind's name (a meeting or a break needs no description).
 */
export function blockLabel(title: string, task: TaskRef | undefined, kindName: string, pending?: string): string {
  return title || pending || (task ? `${task.key} ${task.summary}` : kindName)
}

/** Where a new event goes. */
export interface EventPlace {
  day: string
  start: Ms
  end: Ms
}

/**
 * What a new event's quick line says wins over the form: a named time (on its day), a duration (back from the end when
 * the end follows "now", forward from the start otherwise), another day (the same times of day).
 */
export function placeByQuickLine(form: EventPlace & { followsNow: boolean }, q: Quick): EventPlace {
  if (q.start !== undefined) return { day: q.day, start: q.start, end: q.end ?? q.start + (q.dur ?? form.end - form.start) }
  let { day, start, end } = form
  if (q.dur) {
    if (form.followsNow) start = end - q.dur
    else end = start + q.dur
  }
  if (q.day !== day) {
    const shift = dayStart(q.day) - dayStart(day)
    start += shift
    end += shift
    day = q.day
  }
  return { day, start, end }
}

/** An error as the card shows it (without the IPC wrapper's prefix). */
export { remoteError as errorText } from '../remoteError'
