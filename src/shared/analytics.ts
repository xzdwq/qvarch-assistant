import type { ReportItem } from './report'
import type { Ms } from './types'

/**
 * Аналитика: where the time of a period went, beyond totals — every event (a task, or the same title of a kind)
 * with its count, sum, average and day-by-day line; when in the week and the day the time is spent; the
 * day-by-day stack by kind; the treemap layout.
 */

/** Union length of intervals (parallel time counted once). */
export function union(list: Array<{ start: Ms; end: Ms }>): number {
  const s = [...list].sort((a, b) => a.start - b.start)
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

export interface EventStat {
  /** A task key, or `kind|title` for blocks without a task. */
  key: string
  label: string
  kind: string
  task?: { key: string; summary: string }
  count: number
  ms: number
  avg: number
  /** Days it happened on. */
  days: number
  /** The time on each day of the period (for the sparkline). */
  perDay: number[]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Every event of the period, the biggest first. */
export function eventsOf(items: ReportItem[], days: string[]): EventStat[] {
  const idx = new Map(days.map((d, i) => [d, i]))
  const map = new Map<string, { st: EventStat; parts: ReportItem[] }>()
  for (const it of items) {
    const e = it.e
    const key = e.task ? e.task.key : `${e.kind}|${norm(e.label)}`
    let g = map.get(key)
    if (!g) {
      g = { st: { key, label: e.task ? e.task.summary || e.label : e.label, kind: e.kind, task: e.task, count: 0, ms: 0, avg: 0, days: 0, perDay: Array(days.length).fill(0) }, parts: [] }
      map.set(key, g)
    }
    g.parts.push(it)
    g.st.count++
  }
  const out: EventStat[] = []
  for (const { st, parts } of map.values()) {
    const byDay = new Map<string, ReportItem[]>()
    for (const p of parts) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p])
    for (const [d, list] of byDay) {
      const ms = union(list.map((x) => x.e))
      st.ms += ms
      const i = idx.get(d)
      if (i !== undefined) st.perDay[i] += ms
    }
    st.days = byDay.size
    st.avg = st.count ? st.ms / st.count : 0
    out.push(st)
  }
  return out.sort((a, b) => b.ms - a.ms)
}

/** Time by weekday (0 = Monday … 6 = Sunday) × hour of the day, ms. */
export function heatOf(items: ReportItem[]): number[][] {
  const m = Array.from({ length: 7 }, () => Array(24).fill(0) as number[])
  const H = 3_600_000
  for (const { e } of items) {
    let t = e.start
    while (t < e.end) {
      const d = new Date(t)
      const next = Math.min(e.end, new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime())
      m[(d.getDay() + 6) % 7][d.getHours()] += next - t
      t = next > t ? next : t + H
    }
  }
  return m
}

/** Each day's time by kind (for the stacked area): series in the order of their totals. */
export function dailyByKind(items: ReportItem[], days: string[]): { kinds: string[]; rows: Array<Record<string, number>> } {
  const idx = new Map(days.map((d, i) => [d, i]))
  const rows: Array<Record<string, number>> = days.map(() => ({}))
  const groups = new Map<string, ReportItem[]>()
  for (const it of items) {
    const k = `${it.day}|${it.e.kind}`
    groups.set(k, [...(groups.get(k) ?? []), it])
  }
  const tot = new Map<string, number>()
  for (const [k, list] of groups) {
    const [day, kind] = k.split('|')
    const i = idx.get(day)
    if (i === undefined) continue
    const ms = union(list.map((x) => x.e))
    rows[i][kind] = ms
    tot.set(kind, (tot.get(kind) ?? 0) + ms)
  }
  return { kinds: [...tot].sort((a, b) => b[1] - a[1]).map(([k]) => k), rows }
}

export interface Tile {
  i: number
  x: number
  y: number
  w: number
  h: number
}
/** Squarified treemap of `values` (any order) in a w×h box; tiles keep the index of their value. */
export function treemap(values: number[], w: number, h: number): Tile[] {
  const items = values.map((v, i) => ({ v: Math.max(0, v), i })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)
  const total = items.reduce((s, x) => s + x.v, 0)
  if (!total || w <= 0 || h <= 0) return []
  const scale = (w * h) / total
  const out: Tile[] = []
  let rect = { x: 0, y: 0, w, h }
  let row: Array<{ v: number; i: number }> = []
  const worst = (r: typeof row, side: number) => {
    const s = r.reduce((a, x) => a + x.v * scale, 0)
    const mx = Math.max(...r.map((x) => x.v * scale))
    const mn = Math.min(...r.map((x) => x.v * scale))
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn))
  }
  const layout = (r: typeof row) => {
    const s = r.reduce((a, x) => a + x.v * scale, 0)
    if (rect.w >= rect.h) {
      const cw = s / rect.h
      let y = rect.y
      for (const x of r) {
        const ch = (x.v * scale) / cw
        out.push({ i: x.i, x: rect.x, y, w: cw, h: ch })
        y += ch
      }
      rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h }
    } else {
      const ch = s / rect.w
      let x0 = rect.x
      for (const x of r) {
        const cw = (x.v * scale) / ch
        out.push({ i: x.i, x: x0, y: rect.y, w: cw, h: ch })
        x0 += cw
      }
      rect = { x: rect.x, y: rect.y + ch, w: rect.w, h: rect.h - ch }
    }
  }
  for (const it of items) {
    const side = Math.min(rect.w, rect.h)
    if (!row.length || worst([...row, it], side) <= worst(row, side)) row.push(it)
    else {
      layout(row)
      row = [it]
    }
  }
  if (row.length) layout(row)
  return out
}
