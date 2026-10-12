import type { Ms } from './types'

/**
 * Activity "pulse": how lively the input is — key presses, mouse travel (px) and switches between
 * windows — per time bin. Only amounts, never which keys or where the mouse was.
 */
export interface PulsePoint {
  t: Ms
  /** key presses */
  k: number
  /** mouse travel, px */
  m: number
  /** foreground window switches */
  s: number
}

/** One activity score per bin: a key press ≈ 1, 300 px of mouse travel ≈ 1, a window switch ≈ 4. */
export const pulseScore = (p: Pick<PulsePoint, 'k' | 'm' | 's'>): number => p.k + p.m / 300 + p.s * 4

/** Minute bins stored in the day file: [minute of day, keys, mouse px, switches]. */
export type PulseRow = [number, number, number, number]

/** Adds an amount to the minute bin of `t` (rows are appended in time order). */
export function addToRows(rows: PulseRow[], dayStartMs: Ms, t: Ms, k: number, m: number, s: number): void {
  const minute = Math.floor((t - dayStartMs) / 60_000)
  let row = rows[rows.length - 1]
  if (!row || row[0] !== minute) {
    row = [minute, 0, 0, 0]
    rows.push(row)
  }
  row[1] += k
  row[2] += Math.round(m)
  row[3] += s
}

/**
 * Smooth curve through points (Catmull-Rom → cubic Bézier) as an SVG path — the soft wave
 * of the activity graph.
 */
export function smoothPath(pts: Array<[number, number]>): string {
  if (!pts.length) return ''
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}
