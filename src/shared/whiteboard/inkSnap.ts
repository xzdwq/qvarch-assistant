import type { Recognized } from '../shapeRecognize'
import { itemId, type ShapeItem } from './model'

/** A stroke held still: what it becomes — a shape (drawn instead of it) or straight pieces in the pen's line. */
export type SnapResult = { shape: ShapeItem; hint: string } | { pts: number[][]; hint: string }

/** What of a stroke's style a snapped shape takes: its colour (a gradient — at the mean pressure), opacity, width. */
export interface SnapStyle {
  color: string
  gradient?: string
  opacity: number
  size: number
}

/** The shapes a stroke snaps to: their names, and (when there is one) the name with equal sides. */
const SNAP_NAMES: Record<Extract<Recognized, { type: 'shape' }>['kind'], { name: string; equal?: string }> = {
  ellipse: { name: 'Круг / эллипс', equal: 'Круг' },
  rect: { name: 'Прямоугольник', equal: 'Квадрат' },
  diamond: { name: 'Ромб' },
}

/** The mean pressure of points (a missing one counts as 0.5). */
const meanPressure = (pts: number[][]) => pts.reduce((a, q) => a + (q[2] ?? 0.5), 0) / pts.length

/**
 * What a recognized stroke becomes: a shape / a line in the stroke's colour (its width ~0.7 of the brush), or
 * straight pieces through the corners (an even pressure — an even width), `step` apart (world units).
 */
export function snapStroke(rec: Recognized, orig: number[][], st: SnapStyle, step: number): SnapResult {
  const width = Math.max(1, Math.round(st.size * 0.7 * 10) / 10)
  const base = { id: itemId(), type: 'shape' as const, color: snapColor(st, orig), width }
  switch (rec.type) {
    case 'shape': {
      const shape: ShapeItem = { ...base, kind: rec.kind, x: rec.cx - rec.w / 2, y: rec.cy - rec.h / 2, w: rec.w, h: rec.h, ...(rec.rot ? { rot: Math.round(rec.rot * 10) / 10 } : {}) }
      const names = SNAP_NAMES[rec.kind]
      const hint = (rec.w === rec.h && names.equal) || names.name
      return { shape, hint }
    }
    case 'line':
      return { shape: { ...base, kind: 'line', x: rec.x0, y: rec.y0, w: rec.x1 - rec.x0, h: rec.y1 - rec.y0 }, hint: 'Линия' }
    case 'poly': {
      const p = meanPressure(orig)
      const cs = rec.closed ? [...rec.pts, rec.pts[0]] : rec.pts
      const hint = rec.closed ? (rec.pts.length === 3 ? 'Треугольник' : `Многоугольник · ${rec.pts.length}`) : 'Ломаная'
      return { pts: straightPieces(cs, p, step), hint }
    }
  }
}

/** Points along a polyline, `step` apart, all at one pressure (its last corner included). */
export function straightPieces(cs: number[][], pressure: number, step: number): number[][] {
  const out: number[][] = []
  for (let k = 0; k + 1 < cs.length; k++) {
    const [a, b] = [cs[k], cs[k + 1]]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n, pressure])
  }
  out.push([cs[cs.length - 1][0], cs[cs.length - 1][1], pressure])
  return out
}

/** The colour the stroke was drawn in (a gradient: at its mean pressure; the opacity as an alpha), #rrggbb[aa]. */
export function snapColor(st: Omit<SnapStyle, 'size'>, pts: number[][]): string {
  const hex = (c: string) => {
    const m = /^#?([0-9a-f]{6})/i.exec(c)
    const v = m ? parseInt(m[1], 16) : 0
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  }
  let rgb = hex(st.color)
  if (st.gradient) {
    const p = Math.min(1, Math.max(0, pts.reduce((a, q) => a + (q[2] ?? 0.5), 0) / Math.max(1, pts.length)))
    const b = hex(st.gradient)
    rgb = rgb.map((v, k) => Math.round(v + (b[k] - v) * p))
  }
  const a = st.opacity < 1 ? Math.round(Math.max(0, st.opacity) * 255).toString(16).padStart(2, '0') : ''
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}${a}`
}
