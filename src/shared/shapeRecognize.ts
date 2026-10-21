/**
 * A hand-drawn stroke recognised as the shape it means (as QuickShape: draw, hold at the end — it becomes exact).
 * The methods are the classic ones: Ramer–Douglas–Peucker to find the corners, the stroke's principal axes for its
 * turn, the mean distance to the ideal ellipse / rectangle / rhombus for the choice.
 *  - an ellipse / a circle, a rectangle / a square, a rhombus — exact shapes (a turned one stays turned);
 *  - a straight line (snapped to 0° / 45° / 90° when near);
 *  - a triangle, any polygon, a broken line — their corners joined by straight segments.
 * Anything else (a scribble, a word) — nothing: the stroke stays as drawn.
 */
export type Pt = [number, number]
export type Recognized =
  | { type: 'shape'; kind: 'ellipse' | 'rect' | 'diamond'; cx: number; cy: number; w: number; h: number; rot: number }
  | { type: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'poly'; pts: Pt[]; closed: boolean }

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
/** The distance from p to the segment a–b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  if (!l2) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
/** Ramer–Douglas–Peucker: the points that keep the line within eps of the original. */
export function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: Array<[number, number]> = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let far = -1
    let fd = eps
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b])
      if (d > fd) ((fd = d), (far = i))
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([a, far], [far, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}
/** Corners that are not: almost straight on, or too close to the next one. */
function cleanCorners(c: Pt[], closed: boolean, minSeg: number): Pt[] {
  let out = c.slice()
  for (let changed = true; changed && out.length > (closed ? 3 : 2); ) {
    changed = false
    const n = out.length
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const p = out[(i - 1 + n) % n]
      const q = out[i]
      const r = out[(i + 1) % n]
      const a1 = Math.atan2(q[1] - p[1], q[0] - p[0])
      const a2 = Math.atan2(r[1] - q[1], r[0] - q[0])
      let turn = Math.abs(a2 - a1)
      if (turn > Math.PI) turn = 2 * Math.PI - turn
      if (turn < (18 * Math.PI) / 180 || dist(p, q) < minSeg) {
        out = out.filter((_, k) => k !== i)
        changed = true
        break
      }
    }
  }
  return out
}
const rotate = (p: Pt, a: number): Pt => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)]
/** The turn of the stroke's main axis, folded into (−45°, 45°] (a box's turn repeats every 90°). */
function mainAxis(pts: Pt[]): number {
  let mx = 0
  let my = 0
  for (const [x, y] of pts) ((mx += x), (my += y))
  mx /= pts.length
  my /= pts.length
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
    sxy += (x - mx) * (y - my)
  }
  let a = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  while (a > Math.PI / 4) a -= Math.PI / 2
  while (a <= -Math.PI / 4) a += Math.PI / 2
  return a
}
interface Frame {
  a: number
  u0: number
  u1: number
  v0: number
  v1: number
  local: Pt[]
}
function frameAt(pts: Pt[], a: number): Frame {
  const local = pts.map((p) => rotate(p, -a))
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (const [u, v] of local) {
    if (u < u0) u0 = u
    if (u > u1) u1 = u
    if (v < v0) v0 = v
    if (v > v1) v1 = v
  }
  return { a, u0, u1, v0, v1, local }
}
/** Mean distance from the ideal shape in the frame's box, in parts of the box's diagonal. */
function errEllipse(f: Frame): number {
  const cx = (f.u0 + f.u1) / 2
  const cy = (f.v0 + f.v1) / 2
  const rx = Math.max(1e-6, (f.u1 - f.u0) / 2)
  const ry = Math.max(1e-6, (f.v1 - f.v0) / 2)
  let s = 0
  for (const [u, v] of f.local) s += Math.abs(Math.hypot((u - cx) / rx, (v - cy) / ry) - 1) * Math.min(rx, ry)
  return s / f.local.length / Math.hypot(rx * 2, ry * 2)
}
function errRect(f: Frame): number {
  let s = 0
  for (const [u, v] of f.local) s += Math.min(Math.abs(u - f.u0), Math.abs(u - f.u1), Math.abs(v - f.v0), Math.abs(v - f.v1))
  return s / f.local.length / Math.hypot(f.u1 - f.u0, f.v1 - f.v0)
}
function errDiamond(f: Frame): number {
  const cx = (f.u0 + f.u1) / 2
  const cy = (f.v0 + f.v1) / 2
  const q: Pt[] = [[cx, f.v0], [f.u1, cy], [cx, f.v1], [f.u0, cy]]
  let s = 0
  for (const p of f.local) s += Math.min(...q.map((a, i) => segDist(p, a, q[(i + 1) % 4])))
  return s / f.local.length / Math.hypot(f.u1 - f.u0, f.v1 - f.v0)
}
/** Mean distance from the points to the closed polygon. */
function errPolygon(pts: Pt[], poly: Pt[]): number {
  let s = 0
  for (const p of pts) s += Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length])))
  return s / pts.length
}
const DEG = Math.PI / 180

/** `minSize` — smaller strokes (a dot, a tick) are left alone; world units. */
export function recognize(raw: Pt[], minSize = 12): Recognized | undefined {
  // the points, without repeats
  const pts: Pt[] = []
  for (const p of raw) if (!pts.length || dist(p, pts[pts.length - 1]) > 0.5) pts.push([p[0], p[1]])
  if (pts.length < 5) return undefined
  let len = 0
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i])
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  if (diag < minSize) return undefined
  const first = pts[0]
  const last = pts[pts.length - 1]
  const closed = dist(first, last) < 0.22 * diag && len > 2.1 * diag

  /** The straight pieces must be the stroke itself: their length near the drawn one (a scribble is much longer). */
  const faithful = (c: Pt[], close: boolean) => {
    let s = 0
    for (let i = 1; i < c.length; i++) s += dist(c[i - 1], c[i])
    if (close) s += dist(c[c.length - 1], c[0])
    return len < 1.25 * s
  }
  if (!closed) {
    const c = cleanCorners(rdp(pts, Math.max(0.05 * diag, 1.5)), false, 0.08 * len)
    if (!faithful(c, false)) return undefined
    if (c.length === 2) {
      const [a, b] = [c[0], c[1]]
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0])
      const snap = Math.round(ang / (45 * DEG)) * 45 * DEG
      if (Math.abs(ang - snap) < 6 * DEG) ang = snap
      const l = dist(a, b)
      return { type: 'line', x0: a[0], y0: a[1], x1: a[0] + Math.cos(ang) * l, y1: a[1] + Math.sin(ang) * l }
    }
    // a broken line of a few straight pieces
    if (c.length <= 5) return { type: 'poly', pts: c, closed: false }
    return undefined
  }

  // closed: the corners (split at the point farthest from the start — RDP needs two ends)
  let far = 0
  for (let i = 1; i < pts.length; i++) if (dist(pts[i], first) > dist(pts[far], first)) far = i
  const eps = 0.06 * diag
  const half1 = rdp(pts.slice(0, far + 1), eps)
  const half2 = rdp([...pts.slice(far), first], eps)
  const corners = cleanCorners([...half1, ...half2.slice(1, -1)], true, 0.1 * diag)
  const k = corners.length

  // the box's turn: the main axis — or none (a square's / a circle's axis says nothing); the closer one wins
  const frames = [frameAt(pts, 0), frameAt(pts, mainAxis(pts))]
  const best = (err: (f: Frame) => number) => frames.map((f) => ({ f, e: err(f) })).sort((x, y) => x.e - y.e)[0]
  const toShape = (kind: 'ellipse' | 'rect' | 'diamond', f: Frame): Recognized => {
    let w = f.u1 - f.u0
    let h = f.v1 - f.v0
    // nearly equal sides — a circle / a square
    if (Math.abs(w - h) / Math.max(w, h) < (kind === 'ellipse' ? 0.14 : 0.1)) w = h = (w + h) / 2
    let a = f.a
    if (Math.abs(a) < 8 * DEG || (kind === 'ellipse' && w === h)) a = 0
    const [cx, cy] = rotate([(f.u0 + f.u1) / 2, (f.v0 + f.v1) / 2], f.a)
    return { type: 'shape', kind, cx, cy, w, h, rot: (a * 180) / Math.PI }
  }
  // the ideal shape the stroke lies closest to wins — one measure for all: an ellipse, a rectangle, a rhombus, and
  // the polygon through the stroke's own corners (a slanted square, a square with a round corner — not a circle)
  const el = best(errEllipse)
  const r = best(errRect)
  const d = best(errDiamond)
  const box = r.e <= d.e ? { kind: 'rect' as const, ...r } : { kind: 'diamond' as const, ...d }
  // (a circle's corners are many — RDP keeps 7 and more: no polygon for it)
  const poly = k >= 3 && k <= 6 && faithful(corners, true) ? errPolygon(pts, corners) / diag : Infinity
  const top = Math.min(el.e, box.e, poly)
  if (top === el.e && el.e < 0.07) return toShape('ellipse', el.f)
  // a true rectangle / rhombus whose corners stand where the stroke's corners are — that one (neat); else the
  // stroke's own corners (a slanted square stays slanted, not a turned rhombus)
  const boxCorners = (kind: 'rect' | 'diamond', f: Frame): Pt[] => {
    const cx = (f.u0 + f.u1) / 2
    const cy = (f.v0 + f.v1) / 2
    const local: Pt[] = kind === 'rect' ? [[f.u0, f.v0], [f.u1, f.v0], [f.u1, f.v1], [f.u0, f.v1]] : [[cx, f.v0], [f.u1, cy], [cx, f.v1], [f.u0, cy]]
    return local.map((p) => rotate(p, f.a))
  }
  // each corner of the neat shape has a drawn corner by it (a round corner may give two — fine); a wobbly stroke
  // with many corners is judged by the distance alone
  const checkable = k >= 4 && k <= 6
  const cornersMatch = (q: Pt[]) => q.every((b) => Math.min(...corners.map((c) => dist(b, c))) < 0.08 * diag)
  if (box.e < 0.045 && (checkable ? cornersMatch(boxCorners(box.kind, box.f)) : top === box.e)) return toShape(box.kind, box.f)
  if (top === poly) return { type: 'poly', pts: corners, closed: true }
  return undefined
}
