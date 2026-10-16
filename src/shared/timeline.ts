import type { Entry, Ms, WorkSchedule } from './types'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Local-time day key, YYYY-MM-DD. */
export function dayKey(ms: Ms): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function dayStart(day: string): Ms {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

export function dayEnd(day: string): Ms {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d + 1).getTime()
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + delta).getTime())
}

/** "HH:MM" on a given day → epoch ms. */
export function atTime(day: string, hm: string): Ms {
  const [h, m] = hm.split(':').map(Number)
  return dayStart(day) + (h || 0) * HOUR + (m || 0) * MINUTE
}

export function formatHM(ms: Ms): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 3_900_000 → "1ч 05м", 300_000 → "5м". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / MINUTE))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}м`
  if (m === 0) return `${h}ч`
  return `${h}ч ${pad2(m)}м`
}

export function overlap(a0: Ms, a1: Ms, b0: Ms, b1: Ms): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}


export function sortByStart<T extends { start: Ms }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.start - b.start)
}

/**
 * Where the next "cut" starts: right after the latest main-line entry,
 * or at the start of the first span. A cursor that sits in an off-period (PC asleep)
 * jumps to the next span, so the uncut tail never starts in a gap.
 */
/** Entries as they stand at `t`: planned parts after it are cut off (stats count only what happened). */
export function clipEntries<T extends { start: Ms; end: Ms }>(entries: T[], t: Ms): T[] {
  return entries.filter((e) => e.start < t).map((e) => (e.end > t ? { ...e, end: t } : e))
}

/**
 * Where a quick add without a picked range goes (the island's "Период"):
 *  - the latest free stretch of the official work time (lunch and labelled blocks excluded), if ≥ 5 min;
 *  - otherwise (e.g. the day just started) one hour forward — from the work start, or from now;
 *  - on a day off / after hours with no free work time — the unlabelled tail, at most the last hour.
 */
export function quickRange(entries: Entry[], work: [Ms, Ms] | undefined, lunch: [Ms, Ms] | undefined, now: Ms, cursor: Ms): { start: Ms; end: Ms } {
  const MIN_FREE = 5 * MINUTE
  const mins = (t: Ms) => Math.floor(t / MINUTE) * MINUTE
  if (work) {
    const until = Math.min(now, work[1])
    if (until > work[0]) {
      const busy = entries.map((e) => ({ start: e.start, end: e.end }))
      if (lunch) busy.push({ start: lunch[0], end: lunch[1] })
      const gaps = subtractRanges(work[0], until, busy)
        .map(([start, end]) => ({ start, end }))
        .sort((x, y) => x.start - y.start)
      const free = gaps.filter((r) => r.end - r.start >= MIN_FREE)
      const last = free[free.length - 1]
      if (last) return { start: mins(last.start), end: last.end >= now - MINUTE ? now : last.end }
      // too little free time yet: an hour forward from where the free tail began (09:00, not 09:02)
      const tail = gaps.find((g) => g.end >= now - MINUTE)
      if (now < work[1]) {
        const start = mins(tail ? tail.start : Math.max(work[0], now))
        return { start, end: start + HOUR }
      }
    } else if (now < work[1]) {
      const start = mins(work[0])
      return { start, end: start + HOUR }
    }
  }
  const start = mins(Math.max(cursor, now - HOUR))
  return now - start >= MIN_FREE ? { start, end: now } : { start: mins(now), end: mins(now) + HOUR }
}

/** Description field text → title (first line) + description (the rest). */
export function splitTitle(text: string): { label: string; description?: string } {
  const [first = '', ...rest] = text.replace(/\r/g, '').split('\n')
  const description = rest.join('\n').trim()
  return { label: first.trim(), description: description || undefined }
}
/** Title + description back into the field's text. */
export const joinTitle = (label: string, description?: string): string => (description ? `${label}\n${description}` : label)

/** Where the next quick block starts: the end of the last block begun by now (no blocks — now). */
export function cutCursor(entries: Entry[], now: Ms): Ms {
  let cursor = -Infinity
  // a planned block (starts in the future) does not count
  for (const e of entries) if (e.start <= now && e.end > cursor) cursor = e.end
  return Number.isFinite(cursor) ? Math.min(cursor, now) : now
}

/** Blocks that run at the same time: each pair with its common stretch (the later one is `b`). */
export function overlapPairs<T extends { id: string; start: Ms; end: Ms }>(list: T[]): Array<{ a: T; b: T; start: Ms; end: Ms }> {
  const s = [...list].sort((x, y) => x.start - y.start || x.end - y.end)
  const out: Array<{ a: T; b: T; start: Ms; end: Ms }> = []
  for (let i = 0; i < s.length; i++)
    for (let j = i + 1; j < s.length && s[j].start < s[i].end; j++) {
      const start = s[j].start
      const end = Math.min(s[i].end, s[j].end)
      if (end > start) out.push({ a: s[i], b: s[j], start, end })
    }
  return out
}

/**
 * Inserts an entry. A new entry wins over overlapping entries: they get trimmed, split around it, or removed.
 */
export function placeEntry(entries: Entry[], entry: Entry, newId: () => string): Entry[] {
  const others = entries.filter((e) => e.id !== entry.id)
  const out: Entry[] = []
  for (const e of others) {
    if (e.end <= entry.start || e.start >= entry.end) {
      out.push(e)
      continue
    }
    if (e.start < entry.start) out.push({ ...e, end: entry.start })
    if (e.end > entry.end) {
      const keepsId = !(e.start < entry.start)
      out.push({ ...e, id: keepsId ? e.id : newId(), start: entry.end })
    }
  }
  out.push(entry)
  return sortByStart(out)
}

/** Ranges of the official schedule for a day: work and lunch. */
export function scheduleRanges(day: string, s: WorkSchedule): { work?: [Ms, Ms]; lunch?: [Ms, Ms] } {
  const dow = new Date(dayStart(day)).getDay()
  if (!s.workDays.includes(dow)) return {}
  return {
    work: [atTime(day, s.start), atTime(day, s.end)],
    lunch: s.lunchStart && s.lunchEnd ? [atTime(day, s.lunchStart), atTime(day, s.lunchEnd)] : undefined,
  }
}

/** Splits [start, end] at local midnights: [[day, start, end], ...]. */
export function splitByDay(start: Ms, end: Ms): Array<[string, Ms, Ms]> {
  const out: Array<[string, Ms, Ms]> = []
  let s = start
  while (s < end) {
    const day = dayKey(s)
    const e = Math.min(end, dayEnd(day))
    out.push([day, s, e])
    s = e
  }
  return out
}

/** Merges intervals that touch or overlap (gap ≤ tolerance). */
export function mergeIntervals<T extends { start: Ms; end: Ms }>(list: T[], toleranceMs = 0): T[] {
  const sorted = sortByStart(list)
  const out: T[] = []
  for (const it of sorted) {
    const last = out[out.length - 1]
    if (last && it.start - last.end <= toleranceMs) last.end = Math.max(last.end, it.end)
    else out.push({ ...it })
  }
  return out
}

/** [start, end] minus the given ranges → the uncovered pieces. */
export function subtractRanges(start: Ms, end: Ms, cut: Array<{ start: Ms; end: Ms }>): Array<[Ms, Ms]> {
  let pieces: Array<[Ms, Ms]> = [[start, end]]
  for (const c of cut) {
    const next: Array<[Ms, Ms]> = []
    for (const [a, b] of pieces) {
      if (c.end <= a || c.start >= b) next.push([a, b])
      else {
        if (c.start > a) next.push([a, c.start])
        if (c.end < b) next.push([c.end, b])
      }
    }
    pieces = next
  }
  return pieces.filter(([a, b]) => b > a)
}

export interface DisplaySegment {
  start: Ms
  end: Ms
  entry: Entry
  /** Parallel main-line entries (overlapping after a move/merge) are stacked: lane i of n. */
  lane: number
  lanes: number
}

/**
 * Lanes (parallel timelines) of main-line entries. Each entry asks for its stored lane (0 if none);
 * entries are placed in order of (lane, start) and an entry whose lane is already taken at that time is
 * pushed down to the next free lane. `yieldId` is placed last — the block being dragged gives way to
 * the others instead of shoving them around. `lanes` is the total number of lanes in use.
 */
export function layoutLanes(entries: Entry[], yieldId?: string): Map<string, { lane: number; lanes: number }> {
  const main = entries
  const order = main
    .filter((e) => e.id !== yieldId)
    .sort((x, y) => (x.lane ?? 0) - (y.lane ?? 0) || x.start - y.start)
  const last = main.find((e) => e.id === yieldId)
  if (last) order.push(last)
  const placed: Array<Array<{ start: Ms; end: Ms }>> = []
  const out = new Map<string, { lane: number; lanes: number }>()
  for (const e of order) {
    let lane = Math.max(0, e.lane ?? 0)
    while (placed[lane]?.some((p) => p.start < e.end && e.start < p.end)) lane++
    for (let i = placed.length; i <= lane; i++) placed.push([])
    placed[lane].push(e)
    out.set(e.id, { lane, lanes: 1 })
  }
  const lanes = Math.max(1, placed.length)
  for (const v of out.values()) v.lanes = lanes
  return out
}

/** Is [start, end] free on `lane`, ignoring entry `excludeId`? (lanes as laid out by layoutLanes) */
export function laneIsFree(entries: Entry[], lane: number, start: Ms, end: Ms, excludeId?: string): boolean {
  const others = entries.filter((e) => e.id !== excludeId)
  const layout = layoutLanes(others)
  return !others.some((e) => layout.get(e.id)?.lane === lane && e.start < end && start < e.end)
}

/** First lane where [start, end] is free (used for new blocks dropped over existing ones). */
export function firstFreeLane(entries: Entry[], start: Ms, end: Ms, excludeId?: string): number {
  let lane = 0
  while (!laneIsFree(entries, lane, start, end, excludeId)) lane++
  return lane
}

/** Sum of the union of ranges — labelled time without double-counting parallel entries. */
export function unionMs(list: Array<{ start: Ms; end: Ms }>): number {
  return mergeIntervals(list).reduce((s, x) => s + (x.end - x.start), 0)
}

/**
 * Merges entries into the earliest one (kind and label kept), spanning all of them.
 * Entries in between that were not selected stay as they are — they become parallel.
 */
export function mergeEntries(entries: Entry[], ids: string[]): { merged: Entry; removed: string[] } | undefined {
  const picked = sortByStart(entries.filter((e) => ids.includes(e.id)))
  if (picked.length < 2) return undefined
  const [first, ...rest] = picked
  return {
    merged: { ...first, start: Math.min(...picked.map((e) => e.start)), end: Math.max(...picked.map((e) => e.end)) },
    removed: rest.map((e) => e.id),
  }
}

/** Replaces/inserts an entry without trimming anything — used for moves and merges (overlaps go parallel). */
export function putEntry(entries: Entry[], entry: Entry): Entry[] {
  return sortByStart([...entries.filter((e) => e.id !== entry.id), entry])
}

/** Blocks laid out on their lanes (parallel timelines) for drawing. */
export function flattenForDisplay(entries: Entry[], yieldId?: string): DisplaySegment[] {
  const lanes = layoutLanes(entries, yieldId)
  return sortByStart(entries.map((e) => ({ start: e.start, end: e.end, entry: e, ...(lanes.get(e.id) ?? { lane: 0, lanes: 1 }) })))
}

/**
 * Old data had "nested" blocks (level 1) inside the main line. They move to a free parallel lane —
 * the time and the block stay, only the "nested" kind of placement is gone.
 */
export function unnest(entries: Array<Entry & { level?: number }>): { entries: Entry[]; changed: boolean } {
  if (!entries.some((e) => 'level' in e)) return { entries, changed: false }
  const strip = ({ level: _l, ...e }: Entry & { level?: number }): Entry => e
  let out = entries.filter((e) => !e.level).map(strip)
  for (const n of sortByStart(entries.filter((e) => e.level))) {
    const e = strip(n)
    out = putEntry(out, { ...e, lane: firstFreeLane(out, e.start, e.end, e.id) })
  }
  return { entries: pinLanes(out), changed: true }
}

/** "30м созвон", "1ч ревью", "45 min" → { minutes, rest }. */
export function parseQuickDuration(text: string): { minutes: number; rest: string } | undefined {
  const m = /^\s*(\d{1,3})\s*(м|мин|m|min|ч|h)\.?(?=\s|$)\s*/i.exec(text)
  if (!m) return undefined
  const n = Number(m[1])
  const minutes = /^(ч|h)$/i.test(m[2]) ? n * 60 : n
  if (!minutes || minutes > 12 * 60) return undefined
  return { minutes, rest: text.slice(m[0].length) }
}

/**
 * Writes the current layout into every main-line entry's `lane`, so later layouts reproduce exactly what
 * the user saw while dragging (the saved block yields, as in the preview) — no lanes jumping afterwards.
 */
export function pinLanes(entries: Entry[], yieldId?: string): Entry[] {
  const layout = layoutLanes(entries, yieldId)
  return entries.map((e) => ({ ...e, lane: layout.get(e.id)?.lane ?? 0 }))
}

