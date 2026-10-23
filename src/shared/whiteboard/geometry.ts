import { isLineKind, type BoardItem, type Box, type Boxed, type TextItem } from './model'

/** Where items are: their boxes, hit-testing, a selection frame, the view that fits them. */

// ---------- turned boxes ----------
/** A point of a shape's own box (u, v from its top-left) on the board — it turns around its centre. */
export function shapeCorner(sh: Boxed, u: number, v: number): [number, number] {
  const a = ((sh.rot ?? 0) * Math.PI) / 180
  const dx = u - sh.w / 2
  const dy = v - sh.h / 2
  return [sh.x + sh.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), sh.y + sh.h / 2 + dx * Math.sin(a) + dy * Math.cos(a)]
}
/** A board point in a shape's own box. */
export function shapeLocal(sh: Boxed, x: number, y: number): [number, number] {
  const a = (-(sh.rot ?? 0) * Math.PI) / 180
  const dx = x - (sh.x + sh.w / 2)
  const dy = y - (sh.y + sh.h / 2)
  return [sh.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), sh.h / 2 + dx * Math.sin(a) + dy * Math.cos(a)]
}
/** A point of a text's own box (u, v from its top-left) on the board. */
export function textCorner(t: TextItem, u: number, v: number): [number, number] {
  const a = ((t.rot ?? 0) * Math.PI) / 180
  return [t.x + u * Math.cos(a) - v * Math.sin(a), t.y + u * Math.sin(a) + v * Math.cos(a)]
}
/** A board point in a text's own box. */
export function textLocal(t: TextItem, x: number, y: number): [number, number] {
  const a = (-(t.rot ?? 0) * Math.PI) / 180
  const dx = x - t.x
  const dy = y - t.y
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)]
}

/** The box around some points, grown by `pad` on every side. */
function boxAround(cs: Array<[number, number]>, pad = 0): Box {
  return { x0: Math.min(...cs.map((c) => c[0])) - pad, y0: Math.min(...cs.map((c) => c[1])) - pad, x1: Math.max(...cs.map((c) => c[0])) + pad, y1: Math.max(...cs.map((c) => c[1])) + pad }
}
/** A box's four corners through a corner function (a turned shape / text). */
const cornersOf = <T extends { w: number; h: number }>(i: T, corner: (i: T, u: number, v: number) => [number, number]) => [corner(i, 0, 0), corner(i, i.w, 0), corner(i, 0, i.h), corner(i, i.w, i.h)]

/** Where an item is (with its line width). */
export function itemBox(i: BoardItem): Box {
  switch (i.type) {
    case 'image':
      if (!i.rot) return { x0: i.x, y0: i.y, x1: i.x + i.w, y1: i.y + i.h }
      return boxAround(cornersOf(i, shapeCorner))
    case 'shape': {
      const pad = i.width / 2 + (isLineKind(i.kind) && i.kind !== 'line' ? Math.max(8, i.width * 4) : 0)
      if (isLineKind(i.kind))
        return { x0: Math.min(i.x, i.x + i.w) - pad, y0: Math.min(i.y, i.y + i.h) - pad, x1: Math.max(i.x, i.x + i.w) + pad, y1: Math.max(i.y, i.y + i.h) + pad }
      if (!i.rot) return { x0: i.x - pad, y0: i.y - pad, x1: i.x + i.w + pad, y1: i.y + i.h + pad }
      return boxAround(cornersOf(i, shapeCorner), pad)
    }
    case 'text':
      if (!i.rot) return { x0: i.x, y0: i.y, x1: i.x + i.w, y1: i.y + i.h }
      return boxAround(cornersOf(i, textCorner))
    case 'ink': {
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (let k = 0; k < i.pts.length; k += 3) {
        const x = i.pts[k]
        const y = i.pts[k + 1]
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      const r = i.size
      return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r }
    }
  }
}

/** Everything drawn (undefined — an empty board). */
export function boardBox(items: BoardItem[]): Box | undefined {
  if (!items.length) return undefined
  return items.map(itemBox).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
}

/** The squared distance from a point to a segment. */
export const segDist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax
  const dy = by - ay
  const l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0
  const x = ax + t * dx - px
  const y = ay + t * dy - py
  return x * x + y * y
}

/** How far a local point is outside a w×h box (0, 0 — inside). */
const outsideOf = (lx: number, ly: number, w: number, h: number) => [Math.max(-lx, 0, lx - w), Math.max(-ly, 0, ly - h)] as const

/** Does a circle (the eraser) at x, y with radius r touch the item's line? */
export function hitsItem(i: BoardItem, x: number, y: number, r: number, interior = true): boolean {
  const b = itemBox(i)
  if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false
  switch (i.type) {
    case 'image': {
      const [lx, ly] = shapeLocal(i, x, y)
      const [dx, dy] = outsideOf(lx, ly, i.w, i.h)
      return dx * dx + dy * dy <= r * r
    }
    case 'shape': {
      const reach = r + i.width / 2
      if (isLineKind(i.kind)) return segDist2(x, y, i.x, i.y, i.x + i.w, i.y + i.h) <= reach * reach
      const [lx, ly] = shapeLocal(i, x, y)
      const [dx, dy] = outsideOf(lx, ly, i.w, i.h)
      const outside = Math.hypot(dx, dy)
      if (outside > reach) return false
      if (interior || i.fill || outside > 0) return true
      // inside an unfilled shape: only near its outline
      return Math.min(lx, ly, i.w - lx, i.h - ly) <= reach
    }
    case 'text': {
      // the circle against the text's own (unturned) box
      const [lx, ly] = textLocal(i, x, y)
      const [dx, dy] = outsideOf(lx, ly, i.w, i.h)
      return dx * dx + dy * dy <= r * r
    }
    case 'ink': {
      const reach = r + i.size / 2
      const r2 = reach * reach
      const p = i.pts
      if (p.length === 3) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= r2
      for (let k = 0; k + 5 < p.length; k += 3) if (segDist2(x, y, p[k], p[k + 1], p[k + 3], p[k + 4]) <= r2) return true
      return false
    }
  }
}

/** Is an item caught by a selection frame (any of its line inside / its box crossing it)? */
export function inFrame(i: BoardItem, f: Box): boolean {
  if (i.type !== 'ink') {
    const b = itemBox(i)
    return b.x1 >= f.x0 && b.x0 <= f.x1 && b.y1 >= f.y0 && b.y0 <= f.y1
  }
  for (let k = 0; k < i.pts.length; k += 3) {
    const x = i.pts[k]
    const y = i.pts[k + 1]
    if (x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1) return true
  }
  return false
}

/** The view that shows the whole box in a w×h viewport (with a margin), zoom limited. */
export function fitView(box: Box | undefined, w: number, h: number, margin = 40): { x: number; y: number; z: number } {
  if (!box) return { x: -w / 2, y: -h / 2, z: 1 }
  const bw = Math.max(1, box.x1 - box.x0)
  const bh = Math.max(1, box.y1 - box.y0)
  const z = Math.min(4, Math.max(0.1, Math.min((w - margin * 2) / bw, (h - margin * 2) / bh)))
  return { x: (box.x0 + box.x1) / 2 - w / 2 / z, y: (box.y0 + box.y1) / 2 - h / 2 / z, z }
}
