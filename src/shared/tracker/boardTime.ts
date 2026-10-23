import { dayEnd, dayStart, MINUTE } from '../timeline'
import type { Quick } from '../quickadd'
import type { Entry, Ms, Note, PlanBlock } from '../types'
import { isMeeting } from '../work'

/** A day of the board: what is recorded, noted and planned (as useRange loads it). */
export interface BoardDay {
  day: string
  entries: Entry[]
  notes: Note[]
  plan: PlanBlock[]
}
type Span = { start: Ms; end: Ms }

/** Union length of intervals, cut to [lo, hi]. */
export function unionWithin(list: Span[], lo = -Infinity, hi = Infinity): number {
  const s = list.map((x) => ({ start: Math.max(lo, x.start), end: Math.min(hi, x.end) })).filter((x) => x.end > x.start).sort((a, b) => a.start - b.start)
  let sum = 0
  let cs = -Infinity
  let ce = -Infinity
  for (const x of s) {
    if (x.start > ce) {
      if (ce > cs) sum += ce - cs
      cs = x.start
      ce = x.end
    } else ce = Math.max(ce, x.end)
  }
  return sum + (ce > cs ? ce - cs : 0)
}

const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

/** A day cell of the week strip: done and planned time, the kinds' shares, counts. */
export interface DayCell {
  day: string
  n: number
  wd: string
  off: boolean
  done: number
  plan: number
  kinds: Array<{ kind: string; pct: number }>
  count: number
  notes: number
}
export function dayCell(d: BoardDay, now: Ms, workDays: number[]): DayCell {
  const date = new Date(`${d.day}T12:00:00`)
  const byKind = new Map<string, number>()
  for (const e of d.entries) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + (e.end - e.start))
  const sum = [...byKind.values()].reduce((a, b) => a + b, 0) || 1
  return {
    day: d.day,
    n: date.getDate(),
    wd: WD[date.getDay()],
    off: !workDays.includes(date.getDay()),
    done: unionWithin(d.entries, -Infinity, now),
    plan: unionWithin(d.entries, now) + unionWithin(d.plan.filter((p) => !p.doneEntryId), now),
    kinds: [...byKind].sort((a, b) => b[1] - a[1]).map(([kind, ms]) => ({ kind, pct: (ms / sum) * 100 })),
    count: d.entries.length,
    notes: d.notes.length,
  }
}

/** The period's sums: done, planned, on tasks, in meetings (each day's union — parallel blocks count once). */
export function periodTotals(days: BoardDay[], now: Ms): { done: number; plan: number; tasks: number; meetings: number; count: number } {
  const sumOf = (pick: (es: Entry[]) => Entry[], lo: Ms, hi: Ms) => days.reduce((s, d) => s + unionWithin(pick(d.entries), lo, hi), 0)
  return {
    done: sumOf((es) => es, -Infinity, now),
    plan: sumOf((es) => es, now, Infinity),
    tasks: sumOf((es) => es.filter((e) => e.task), -Infinity, now),
    meetings: sumOf((es) => es.filter(isMeeting), -Infinity, now),
    count: days.reduce((s, d) => s + d.entries.length, 0),
  }
}

/** A row of the day's feed: a block, a plan, a note, a free gap, or the "now" line. */
export type FeedRow =
  | { t: 'e'; key: string; e: Entry; at: Ms; plan: boolean }
  | { t: 'p'; key: string; p: PlanBlock; at: Ms }
  | { t: 'n'; key: string; n: Note; at: Ms }
  | { t: 'gap'; key: string; start: Ms; end: Ms; at: Ms; plan: boolean }
  | { t: 'now'; key: string; at: Ms }
/** Shorter free time is not worth a row. */
export const GAP_MIN = 15 * MINUTE

/**
 * The day as a feed: blocks, plans and notes in time order with the free gaps (inside the working day, or
 * around what there is) between them; today also gets the "now" line and a gap through it is cut in two.
 */
export function dayFeed(d: BoardDay, a: { now: Ms; today: string; work?: [Ms, Ms]; order: 'asc' | 'desc' }): FeedRow[] {
  const n = a.now
  const isToday = d.day === a.today
  const future = d.day > a.today
  const plans = d.plan.filter((p) => !p.doneEntryId)
  const rows: FeedRow[] = [
    ...d.entries.map((e) => ({ t: 'e' as const, key: e.id, e, at: e.start, plan: future || (isToday && e.start >= n) })),
    ...plans.map((p) => ({ t: 'p' as const, key: `p${p.id}`, p, at: p.start })),
    ...d.notes.map((x) => ({ t: 'n' as const, key: `n${x.id}`, n: x, at: x.at })),
  ]
  const busy = [...d.entries, ...plans].sort((x, y) => x.start - y.start)
  const lo = Math.min(a.work?.[0] ?? Infinity, busy[0]?.start ?? Infinity)
  const hi = Math.max(a.work?.[1] ?? -Infinity, busy.reduce((m, b) => Math.max(m, b.end), -Infinity))
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    const cuts = isToday ? [n] : []
    const push = (s: Ms, e: Ms): void => {
      // a gap through "now" is two: the free past and the free rest of the day
      const c = cuts.find((x) => x > s && x < e)
      if (c !== undefined) {
        push(s, c)
        push(c, e)
        return
      }
      if (e - s >= GAP_MIN) rows.push({ t: 'gap', key: `g${s}`, start: s, end: e, at: s, plan: future || (isToday && s >= n) })
    }
    let t = lo
    for (const b of busy) {
      if (b.start > t) push(t, b.start)
      t = Math.max(t, b.end)
    }
    if (hi > t) push(t, hi)
  }
  if (isToday) rows.push({ t: 'now', key: 'now', at: n })
  rows.sort((x, y) => x.at - y.at || (x.t === 'now' ? -1 : y.t === 'now' ? 1 : 0))
  return a.order === 'desc' ? rows.reverse() : rows
}

/** Without a time in the text: from now, 30 min (or the named length) — on another day at the same clock time. */
export function placeQuick(q: Quick, now: Ms, today: string): Span {
  const dur = q.dur ?? 30 * MINUTE
  if (q.start !== undefined) return { start: q.start, end: q.end ?? q.start + dur }
  const n = Math.floor(now / MINUTE) * MINUTE
  const start = Math.min(dayEnd(q.day) - dur, dayStart(q.day) + (n - dayStart(today)))
  return { start, end: start + dur }
}

/** The timeline's first view of a day: its blocks and working hours (and now), padded to whole hours. */
export function timelineWindow(day: string, entries: Span[], work: [Ms, Ms] | undefined, now: Ms | undefined): [Ms, Ms] {
  const HOUR = 60 * MINUTE
  const starts = entries.map((e) => e.start)
  const ends = [...entries.map((e) => e.end), ...(now !== undefined ? [now] : [])]
  if (work) {
    starts.push(work[0])
    ends.push(work[1])
  }
  const from = starts.length ? Math.min(...starts) : dayStart(day) + 9 * HOUR
  const to = ends.length ? Math.max(...ends) : dayStart(day) + 18 * HOUR
  return [Math.max(dayStart(day), Math.floor((from - 15 * MINUTE) / HOUR) * HOUR), Math.min(dayEnd(day), Math.ceil((to + 15 * MINUTE) / HOUR) * HOUR)]
}

/** 1 запись, 2 записи, 5 записей. */
export const plural = (n: number, one: string, few: string, many: string): string =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many
