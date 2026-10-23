import { isLineKind, type BoardItem, type ImageItem, type ShapeItem, type TextItem } from './model'

/** The selection's moves: affine maps (move / scale / turn) and items carried through them. */

/** x' = a·x + c·y + e, y' = b·x + d·y + f */
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}
export const translate = (dx: number, dy: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy })
export const scaleAbout = (s: number, cx: number, cy: number): Affine => ({ a: s, b: 0, c: 0, d: s, e: cx - s * cx, f: cy - s * cy })
/** Turned by `deg` clockwise (the screen's y goes down) around cx, cy. */
export function rotateAbout(deg: number, cx: number, cy: number): Affine {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { a: cos, b: sin, c: -sin, d: cos, e: cx - cos * cx + sin * cy, f: cy - sin * cx - cos * cy }
}
export const apply = (m: Affine, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]

/** The map's uniform scale and its turn (degrees). */
const scaleOf = (m: Affine) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))
const turnOf = (m: Affine) => (Math.atan2(m.b, m.a) * 180) / Math.PI
/** A turn added up, rounded to 0.01°, set on the item (or dropped when straight). */
function withTurn<T extends { rot?: number }>(out: T, was: number | undefined, m: Affine): T {
  const rot = Math.round((((was ?? 0) + turnOf(m)) % 360) * 100) / 100
  if (rot) out.rot = rot
  else delete out.rot
  return out
}

/** A box turned around its centre (a picture, a shape): the centre moves, the size scales, the turn adds up. */
function transformBoxed<T extends ImageItem | ShapeItem>(i: T, m: Affine, extra: Partial<T> = {}): T {
  const s = scaleOf(m)
  const [cx, cy] = apply(m, i.x + i.w / 2, i.y + i.h / 2)
  const w = i.w * s
  const h = i.h * s
  return withTurn({ ...i, x: cx - w / 2, y: cy - h / 2, w, h, ...extra }, i.rot, m)
}

/** An item moved / scaled / turned (line widths and font sizes scale with it). */
export function transformItem<T extends BoardItem>(i: T, m: Affine): T {
  const s = scaleOf(m)
  const it = i as BoardItem
  switch (it.type) {
    case 'image':
      return transformBoxed(it, m) as T
    case 'shape': {
      if (!isLineKind(it.kind)) return transformBoxed(it, m, { width: it.width * s }) as T
      const [x0, y0] = apply(m, it.x, it.y)
      const [x1, y1] = apply(m, it.x + it.w, it.y + it.h)
      return { ...it, x: x0, y: y0, w: x1 - x0, h: y1 - y0, width: it.width * s } as T
    }
    case 'ink': {
      const pts = it.pts.slice()
      for (let k = 0; k < pts.length; k += 3) {
        const [x, y] = apply(m, pts[k], pts[k + 1])
        pts[k] = x
        pts[k + 1] = y
      }
      return { ...it, pts, size: it.size * s } as T
    }
    case 'text': {
      const [x, y] = apply(m, it.x, it.y)
      const t: TextItem = { ...it, x, y, size: it.size * s, w: it.w * s, h: it.h * s }
      return withTurn(t, it.rot, m) as T
    }
  }
}
