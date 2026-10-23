import { itemBox } from './geometry'
import { itemId, type InkItem } from './model'

/**
 * The eraser "like in Paint": the part of a line the eraser circle (cx, cy, r) covers is cut out — what is left
 * becomes separate lines (each keeps the style). Every segment is cut exactly where it enters / leaves the circle
 * (the circle grows by half the line's width, so the cut goes through the whole line). Returns the pieces
 * ([] — all gone; [item] itself — untouched).
 */
export function eraseInk(item: InkItem, cx: number, cy: number, r: number): InkItem[] {
  const reach = r + item.size / 2
  const r2 = reach * reach
  const p = item.pts
  const n = p.length / 3
  const inside = (k: number) => (p[k * 3] - cx) ** 2 + (p[k * 3 + 1] - cy) ** 2 <= r2
  const b = itemBox(item)
  if (cx < b.x0 - r || cx > b.x1 + r || cy < b.y0 - r || cy > b.y1 + r) return [item]
  if (n === 1) return inside(0) ? [] : [item]
  const runs: number[][] = []
  let cur: number[] = []
  const lerp = (k: number, t: number) => {
    const a = k * 3
    const c = a + 3
    return [p[a] + (p[c] - p[a]) * t, p[a + 1] + (p[c + 1] - p[a + 1]) * t, p[a + 2] + (p[c + 2] - p[a + 2]) * t]
  }
  let touched = false
  if (!inside(0)) cur.push(p[0], p[1], p[2])
  else touched = true
  for (let k = 0; k < n - 1; k++) {
    const [t0, t1] = segmentInCircle(p, k, cx, cy, r2)
    const enters = t0 > 0 && t0 < 1
    const leaves = t1 > 0 && t1 < 1
    const covered = t0 <= 0 && t1 >= 1
    if (covered) {
      touched = true
      if (cur.length) runs.push(cur)
      cur = []
      continue
    }
    if (enters) {
      touched = true
      cur.push(...lerp(k, t0))
      runs.push(cur)
      cur = []
    }
    if (leaves) {
      touched = true
      cur = [...lerp(k, t1)]
    }
    if (!inside(k + 1)) cur.push(p[k * 3 + 3], p[k * 3 + 4], p[k * 3 + 5])
  }
  if (cur.length) runs.push(cur)
  if (!touched) return [item]
  // a crumb shorter than half the line's width is not worth keeping
  const long = (run: number[]) => {
    let len = 0
    for (let k = 3; k < run.length; k += 3) len += Math.hypot(run[k] - run[k - 3], run[k + 1] - run[k - 2])
    return len >= item.size / 2
  }
  return runs.filter((run) => run.length >= 6 && long(run)).map((pts) => ({ ...item, id: itemId(), pts }))
}

/**
 * Where the segment k → k+1 of flat points is inside the circle (cx, cy, √r2): t in [t0, t1] (the roots of
 * |a + t·d − c|² = r2); [2, -1] — never inside.
 */
function segmentInCircle(p: number[], k: number, cx: number, cy: number, r2: number): [number, number] {
  const ax = p[k * 3] - cx
  const ay = p[k * 3 + 1] - cy
  const dx = p[k * 3 + 3] - p[k * 3]
  const dy = p[k * 3 + 4] - p[k * 3 + 1]
  const A = dx * dx + dy * dy
  const B = 2 * (ax * dx + ay * dy)
  const C = ax * ax + ay * ay - r2
  const disc = B * B - 4 * A * C
  if (A > 1e-9 && disc > 0) {
    const sq = Math.sqrt(disc)
    return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]
  }
  return C <= 0 ? [0, 1] : [2, -1]
}
