import { HOUR } from '../timeline'
import type { Ms } from '../types'

/** The calendar's geometry without state: the hour scale, its finer lines, events side by side, an event's box. */

/** Zoom limits of the hour scale (×). */
export const ZY_MIN = 0.15
export const ZY_MAX = 12
const MIN_HOUR_PX = 48

/** One hour in px for a body `bodyH` px tall at zoom `zy`: never less than the whole day in view, never above 720. */
export function hourPxFor(bodyH: number, zy: number): number {
  const fit = Math.max(8, (bodyH - 2) / 24)
  return Math.max(fit, Math.min(720, Math.max(MIN_HOUR_PX, bodyH / 24) * zy))
}

/** A line between the hours: its y, «HH:MM», whether it is the half hour. */
export interface SubLine {
  y: number
  label: string
  half: boolean
}

/** Finer lines once an hour is tall enough: every 15 or 30 minutes (none on a small scale). */
export function subLinesFor(hourPx: number): SubLine[] {
  const step = hourPx >= 260 ? 15 : hourPx >= 110 ? 30 : 0
  if (!step) return []
  const out: SubLine[] = []
  for (let h = 0; h < 24; h++)
    for (let m = step; m < 60; m += step) out.push({ y: (h + m / 60) * hourPx, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, half: m === 30 })
  return out
}

/** An event in its day: its column of `cols` side by side. */
export interface DayColumn<T> {
  e: T
  col: number
  cols: number
}

/** Events that really overlap in time side by side; back-to-back ones stay one under another (sorted by start). */
export function layoutDay<T extends { start: Ms; end: Ms }>(list: T[], minMs = 0): Array<DayColumn<T>> {
  const out: Array<{ e: T; col: number; cluster: number }> = []
  const clusterCols: number[] = []
  let cluster = -1
  let clusterEnd = -Infinity
  let colEnds: number[] = []
  for (const e of list) {
    const end = Math.max(e.end, e.start + minMs)
    if (e.start >= clusterEnd) {
      cluster++
      colEnds = []
      clusterCols[cluster] = 0
    }
    let col = colEnds.findIndex((x) => x <= e.start)
    if (col < 0) col = colEnds.length
    colEnds[col] = end
    clusterEnd = Math.max(clusterEnd, end)
    clusterCols[cluster] = Math.max(clusterCols[cluster], col + 1)
    out.push({ e, col, cluster })
  }
  return out.map((x) => ({ e: x.e, col: x.col, cols: clusterCols[x.cluster] }))
}

/** One line of an event's text (px). */
const LINE = 12.5

/**
 * An event's height — exactly as long as it lasts, so the order in time is always seen — and what text fits:
 * the time line, how many title lines (else — the tooltip).
 */
export function eventBox(ms: Ms, hourPx: number): { h: number; time: boolean; lines: number } {
  const h = Math.max(3, (ms / HOUR) * hourPx - 1)
  const time = h >= 2 * LINE + 4
  const lines = Math.max(0, Math.floor((h - 3 - (time ? LINE : 0)) / LINE))
  return { h, time, lines }
}
