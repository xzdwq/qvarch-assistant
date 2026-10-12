import type { Entry, Ms } from './types'
import { dayKey, dayStart, mergeIntervals, MINUTE, shiftDay, unionMs } from './timeline'

/**
 * Reports over a period and the week sheet: durations typed by hand, where new time goes in a day,
 * what is taken away, and the time grouped by kind / task / day / week.
 */

// ---------- durations typed by hand ----------

/**
 * "2h 30m", "2ч 30м", "1:30", "90m", "90м", "1.5", "1,5ч", "2" (hours) → ms; "" → 0; nonsense → undefined.
 * A bare number is hours (as in timesheets).
 */
export function parseHours(input: string): number | undefined {
  const s = input.trim().toLowerCase().replace(',', '.')
  if (!s) return 0
  let m = /^(\d+):(\d{1,2})$/.exec(s)
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * MINUTE
  m = /^(\d+(?:\.\d+)?)$/.exec(s)
  if (m) return Math.round(Number(m[1]) * 60) * MINUTE
  m = /^(?:(\d+(?:\.\d+)?)\s*(?:h|ч|час[а-я]*))?\s*(?:(\d+)\s*(?:m|м|мин[а-я]*))?$/.exec(s)
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * MINUTE
  return undefined
}

/** ms → "1:30" (a cell of the sheet); 0 → "". */
export function formatHours(ms: number): string {
  const min = Math.round(ms / MINUTE)
  if (min <= 0) return ''
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
}

// ---------- the sheet: rows and where time goes ----------

/** A row of the sheet: a task (all kinds of time on it) or, without a task, a kind + its text. */
export interface SheetRow {
  key: string
  kind: string
  label: string
  task?: { key: string; summary: string }
}
export const rowKeyOf = (e: { kind: string; label: string; task?: { key: string } }): string =>
  e.task ? `t:${e.task.key}` : `k:${e.kind}:${e.label.trim().toLowerCase()}`
export function rowOf(e: { kind: string; label: string; task?: { key: string; summary: string } }): SheetRow {
  return { key: rowKeyOf(e), kind: e.kind, label: e.label, task: e.task ? { key: e.task.key, summary: e.task.summary } : undefined }
}

/** Monday of the week the day is in. */
export function weekStart(day: string): string {
  const dow = (new Date(dayStart(day)).getDay() + 6) % 7
  return shiftDay(day, -dow)
}
/** The days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = shiftDay(d, 1)) out.push(d)
  return out
}

const STEP = 5 * MINUTE
const ceilStep = (t: Ms) => Math.ceil(t / STEP) * STEP

/**
 * Where `need` ms of new time go in a day: into the free stretches of the working hours (not lunch, not
 * over other blocks), earliest first, split over several stretches if no one is long enough; what does not
 * fit goes right after the day's last block (or the working day's end).
 */
export function placeTime(entries: Array<{ start: Ms; end: Ms }>, need: Ms, work: [Ms, Ms], lunch?: [Ms, Ms]): Array<[Ms, Ms]> {
  const busy = mergeIntervals([...entries.map((e) => ({ start: e.start, end: e.end })), ...(lunch ? [{ start: lunch[0], end: lunch[1] }] : [])])
  const out: Array<[Ms, Ms]> = []
  let left = need
  let t = work[0]
  for (const b of [...busy, { start: work[1], end: work[1] }]) {
    if (left <= 0) break
    const from = ceilStep(Math.max(t, work[0]))
    const to = Math.min(b.start, work[1])
    if (to - from >= STEP) {
      const take = Math.min(left, to - from)
      out.push([from, from + take])
      left -= take
    }
    t = Math.max(t, b.end)
    if (t >= work[1]) break
  }
  if (left > 0) {
    const last = Math.max(work[1], ...busy.map((b) => b.end), ...out.map((o) => o[1]))
    const from = ceilStep(last)
    out.push([from, from + left])
  }
  return out
}

/**
 * Taking `remove` ms away from a row's blocks of a day: from the latest block backwards — shortened, or
 * removed when nothing is left. Outlook meetings are not touched.
 */
export function takeTime(blocks: Entry[], remove: Ms): Array<{ id: string; end?: Ms; drop?: true }> {
  const out: Array<{ id: string; end?: Ms; drop?: true }> = []
  let left = remove
  for (const e of [...blocks].filter((x) => !x.outlook).sort((a, b) => b.end - a.end)) {
    if (left <= 0) break
    const len = e.end - e.start
    if (len <= left + MINUTE / 2) {
      out.push({ id: e.id, drop: true })
      left -= len
    } else {
      out.push({ id: e.id, end: e.end - left })
      left = 0
    }
  }
  return out
}

// ---------- reports ----------

export type GroupBy = 'kind' | 'task' | 'day' | 'week'
export interface ReportFilter {
  kinds?: string[]
  tasks?: string[]
  /** "jira" — on a Jira task, "own" — on an own task (Q-n), "none" — without a task. */
  taskType?: Array<'jira' | 'own' | 'none'>
  sources?: Array<'outlook' | 'call' | 'manual'>
  text?: string
}
export interface RangeDay {
  day: string
  entries: Entry[]
  /** QA was on (ms). */
  pcOnMs: number
}

const OWN = 'Q-'
export function taskType(e: { task?: { key: string } }): 'jira' | 'own' | 'none' {
  return !e.task ? 'none' : e.task.key.startsWith(OWN) ? 'own' : 'jira'
}
/** Where a block came from: an Outlook meeting, a detected call, or put by hand (AI included). */
export function sourceOf(e: Entry): 'outlook' | 'call' | 'manual' {
  return e.outlook ? 'outlook' : e.source === 'detected' ? 'call' : 'manual'
}

export function matches(e: Entry, f: ReportFilter): boolean {
  if (f.kinds?.length && !f.kinds.includes(e.kind)) return false
  if (f.tasks?.length && !(e.task && f.tasks.includes(e.task.key))) return false
  if (f.taskType?.length && !f.taskType.includes(taskType(e))) return false
  if (f.sources?.length && !f.sources.includes(sourceOf(e))) return false
  const q = f.text?.trim().toLowerCase()
  if (q && !`${e.label} ${e.description ?? ''} ${e.task?.key ?? ''} ${e.task?.summary ?? ''}`.toLowerCase().includes(q)) return false
  return true
}

export interface ReportItem {
  day: string
  e: Entry
}
export interface Group {
  key: string
  ms: number
  count: number
  items: ReportItem[]
}

/** The key of a block's group. */
export function groupKey(it: ReportItem, by: GroupBy): string {
  if (by === 'kind') return it.e.kind
  if (by === 'task') return it.e.task?.key ?? ''
  if (by === 'day') return it.day
  return weekStart(it.day)
}

/** Time per group — a group's own overlaps counted once (a call inside a meeting is not double time). */
export function groupItems(items: ReportItem[], by: GroupBy): Group[] {
  const m = new Map<string, ReportItem[]>()
  for (const it of items) {
    const k = groupKey(it, by)
    m.set(k, [...(m.get(k) ?? []), it])
  }
  const out = [...m].map(([key, list]) => ({ key, ms: unionOf(list), count: list.length, items: list }))
  return by === 'day' || by === 'week' ? out.sort((a, b) => a.key.localeCompare(b.key)) : out.sort((a, b) => b.ms - a.ms)
}

/** Time of blocks over several days, overlaps counted once. */
export function unionOf(items: ReportItem[]): number {
  return unionMs(items.map((i) => ({ start: i.e.start, end: i.e.end })))
}

/** Bars of the chart: per day / week / month, the time of each series key (a kind or a task) in it. */
export function bars(items: ReportItem[], days: string[], unit: 'day' | 'week' | 'month', series: (it: ReportItem) => string): Array<{ key: string; days: string[]; parts: Map<string, number>; total: number }> {
  const bucket = (d: string) => (unit === 'day' ? d : unit === 'week' ? weekStart(d) : d.slice(0, 7))
  const order: string[] = []
  const map = new Map<string, { key: string; days: string[]; parts: Map<string, number>; total: number }>()
  for (const d of days) {
    const b = bucket(d)
    if (!map.has(b)) {
      order.push(b)
      map.set(b, { key: b, days: [], parts: new Map(), total: 0 })
    }
    map.get(b)!.days.push(d)
  }
  const byBucket = new Map<string, ReportItem[]>()
  for (const it of items) {
    const b = bucket(it.day)
    byBucket.set(b, [...(byBucket.get(b) ?? []), it])
  }
  for (const [b, list] of byBucket) {
    const bar = map.get(b)
    if (!bar) continue
    const bySeries = new Map<string, ReportItem[]>()
    for (const it of list) bySeries.set(series(it), [...(bySeries.get(series(it)) ?? []), it])
    for (const [s, l] of bySeries) bar.parts.set(s, unionOf(l))
    bar.total = unionOf(list)
  }
  return order.map((k) => map.get(k)!)
}

/** Today's key — for the period buttons. */
export const todayKey = (): string => dayKey(Date.now())
