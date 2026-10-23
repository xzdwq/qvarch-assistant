import { isProductive } from '../kinds'
import { clipEntries, unionMs } from '../timeline'
import type { Entry, KindDef, Ms } from '../types'
import { isCall, isMeeting } from '../work'

/** The calendar's lists without state: the side list around the open item, grouped by day; a day's totals. */

/** Something listed in the side panel (an event or a note) with its day and moment. */
export interface DayItem {
  key: string
  t: Ms
  day: string
}

/** Items grouped by day, in order (the date stands on the left of each group). */
export function byDay<T extends DayItem>(list: T[]): Array<{ day: string; items: T[] }> {
  const out: Array<{ day: string; items: T[] }> = []
  for (const x of list) {
    const last = out[out.length - 1]
    if (last && last.day === x.day) last.items.push(x)
    else out.push({ day: x.day, items: [x] })
  }
  return out
}

/**
 * Up to `count` items before and after the open one (`id`, or — a new one — the moment `at`) in a time-ordered list;
 * the open one itself is in neither.
 */
export function neighboursOf<T extends DayItem>(list: T[], id: string | undefined, at: Ms, count: number): { before: T[]; after: T[] } {
  let i = id ? list.findIndex((x) => x.key === id) : -1
  if (i < 0) i = list.findIndex((x) => x.t >= at)
  if (i < 0) i = list.length
  const self = id && list[i]?.key === id ? 1 : 0
  return { before: list.slice(Math.max(0, i - count), i), after: list.slice(i + self, i + self + count) }
}

/** A day's footer: done (parallel counted once), of it productive, still planned, the plan, counts. */
export interface DayStats {
  done: Ms
  productive: Ms
  planned: Ms
  plan: Ms
  count: number
  tasks: number
  meetings: number
  notes: number
}

/** The footer of a day: `list` — its shown events, `plan` — its plan blocks, `now` splits done from planned. */
export function dayStats(list: Entry[], plan: Array<{ start: Ms; end: Ms }>, notes: number, now: Ms, kinds: KindDef[]): DayStats {
  const done = clipEntries(list, now)
  return {
    done: unionMs(done),
    productive: unionMs(done.filter((e) => isProductive(kinds, e.kind))),
    planned: unionMs(list.filter((e) => e.end > now).map((e) => ({ start: Math.max(e.start, now), end: e.end }))),
    count: list.length,
    plan: unionMs(plan.map((p) => ({ start: p.start, end: p.end }))),
    tasks: new Set(list.filter((e) => e.task).map((e) => e.task!.key)).size,
    meetings: list.filter((e) => isMeeting(e) || isCall(e)).length,
    notes,
  }
}
