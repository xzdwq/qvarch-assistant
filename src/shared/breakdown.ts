import { mergeIntervals, overlap, trackedMs } from './timeline'
import type { ActivitySegment, AppKind, CallSegment, DayData, Entry, Ms } from './types'

export interface AppShare {
  app: string
  kind: AppKind
  ms: number
}

export interface TitleShare {
  app: string
  kind: AppKind
  title: string
  ms: number
}

export interface Breakdown {
  start: Ms
  end: Ms
  /** Time inside the range while the PC was on. */
  pcOnMs: number
  activeMs: number
  idleMs: number
  callsMs: number
  apps: AppShare[]
  titles: TitleShare[]
  calls: CallSegment[]
  entries: Entry[]
}

const isIdle = (k: AppKind) => k === 'idle' || k === 'locked'

/** What happened inside [start, end]: apps, window titles, idle, calls — for the details panel. */
export function breakdown(d: DayData, start: Ms, end: Ms): Breakdown {
  const apps = new Map<string, AppShare>()
  const titles = new Map<string, TitleShare>()
  let activeMs = 0
  let idleMs = 0
  for (const a of d.activity) {
    const ms = overlap(start, end, a.start, a.end)
    if (!ms) continue
    if (isIdle(a.kind)) idleMs += ms
    else activeMs += ms
    const app = apps.get(a.app) ?? { app: a.app, kind: a.kind, ms: 0 }
    app.ms += ms
    apps.set(a.app, app)
    if (a.title) {
      const k = `${a.app}\u0000${a.title}`
      const t = titles.get(k) ?? { app: a.app, kind: a.kind, title: a.title, ms: 0 }
      t.ms += ms
      titles.set(k, t)
    }
  }
  const calls = d.calls.filter((c) => c.end > start && c.start < end)
  const callsMs = mergeIntervals(calls.map((c) => ({ start: Math.max(c.start, start), end: Math.min(c.end, end) })), 60_000).reduce(
    (s, c) => s + (c.end - c.start),
    0,
  )
  return {
    start,
    end,
    pcOnMs: trackedMs(start, end, d.spans),
    activeMs,
    idleMs,
    callsMs,
    apps: [...apps.values()].sort((a, b) => b.ms - a.ms),
    titles: [...titles.values()].sort((a, b) => b.ms - a.ms),
    calls,
    entries: d.entries.filter((e) => e.end > start && e.start < end).sort((a, b) => a.start - b.start),
  }
}

export interface PointInfo {
  t: Ms
  pcOn: boolean
  entry?: Entry
  /** Other blocks at the same moment (parallel lanes). */
  parallel: Entry[]
  activity?: ActivitySegment
  call?: CallSegment
}

/** Everything known about a single moment — for the hover card. */
export function infoAt(d: DayData, t: Ms): PointInfo {
  const at = <T extends { start: Ms; end: Ms }>(list: T[]) => list.find((x) => x.start <= t && t < x.end)
  const byLane = [...d.entries].sort((a, b) => (a.lane ?? 0) - (b.lane ?? 0))
  return {
    t,
    pcOn: d.spans.some((s) => s.start <= t && t < s.end),
    entry: at(byLane),
    parallel: byLane.filter((e) => e.start <= t && t < e.end).slice(1),
    activity: at(d.activity),
    call: at(d.calls),
  }
}

/** Gaps of the main line around `t` — what a click on an empty spot selects. */
export function gapAround(d: DayData, t: Ms, limitEnd: Ms): { start: Ms; end: Ms } {
  const spans = [...d.spans].sort((a, b) => a.start - b.start)
  let start = spans.length ? spans[0].start : t
  let end = limitEnd
  for (const s of spans) if (s.end <= t) start = Math.max(start, s.end)
  // the span containing t bounds the gap from the left
  const span = spans.find((s) => s.start <= t && t < s.end)
  if (span) start = Math.max(start, span.start)
  for (const e of d.entries) {
    if (e.end <= t) start = Math.max(start, e.end)
    if (e.start > t) end = Math.min(end, e.start)
  }
  if (span && !span.open) end = Math.min(end, span.end)
  // an off-period (PC asleep, e.g. lunch away from the desk) is a gap of its own
  if (!span) {
    const next = spans.find((s) => s.start > t)
    if (next) end = Math.min(end, next.start)
  }
  return { start: Math.min(start, t), end: Math.max(end, t) }
}
