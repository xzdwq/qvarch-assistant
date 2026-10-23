import { isLineKind, itemId, type ShapeItem, type ShapeKind } from './model'

/** The shape tool's settings a new shape takes. */
export interface ShapeStyle {
  kind: ShapeKind
  color: string
  width: number
  fill: boolean
  dash: boolean
}

/** A shape from one corner (one end) to the other; `square` — a square / a circle, a line at 45° steps. */
export function draftShape(x0: number, y0: number, x1: number, y1: number, square: boolean, st: ShapeStyle): ShapeItem {
  const kind = st.kind
  let dx = x1 - x0
  let dy = y1 - y0
  if (square) {
    if (isLineKind(kind)) {
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
      const len = Math.hypot(dx, dy)
      dx = Math.cos(a) * len
      dy = Math.sin(a) * len
    } else {
      const m = Math.max(Math.abs(dx), Math.abs(dy))
      dx = Math.sign(dx || 1) * m
      dy = Math.sign(dy || 1) * m
    }
  }
  const base = { id: itemId(), type: 'shape' as const, kind, color: st.color, width: st.width, ...(st.dash ? { dash: true } : {}) }
  if (isLineKind(kind)) return { ...base, x: x0, y: y0, w: dx, h: dy }
  return { ...base, x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), w: Math.abs(dx), h: Math.abs(dy), ...(st.fill ? { fill: st.color + '30' } : {}) }
}

/** A click without a drag (smaller than 3 screen px at zoom z): a shape of the usual size there. */
export function clickedShape(sh: ShapeItem, z: number): ShapeItem {
  if (!(Math.abs(sh.w) < 3 / z && Math.abs(sh.h) < 3 / z)) return sh
  return isLineKind(sh.kind) ? { ...sh, w: 160, h: 0 } : { ...sh, x: sh.x - 70, y: sh.y - 45, w: 140, h: 90 }
}
