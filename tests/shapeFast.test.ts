import { describe, expect, it } from 'vitest'
import { recognize, type Pt } from '../src/shared/shapeRecognize'

/** A fast hand: few points (one every `step` px), corners rounded by `r` (a quick hand rounds them), the end past the start. */
function fastRect(w: number, h: number, step: number, r: number, overshoot = 0): Pt[] {
  const path: Pt[] = [[r, 0]]
  const corner = (cx: number, cy: number, a0: number) => {
    for (let k = 0; k <= 3; k++) {
      const a = a0 + (k / 3) * (Math.PI / 2)
      path.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
  }
  corner(w - r, r, -Math.PI / 2)
  corner(w - r, h - r, 0)
  corner(r, h - r, Math.PI / 2)
  corner(r, r, Math.PI)
  path.push([r + overshoot, -overshoot / 4])
  const out: Pt[] = [path[0]]
  let left = step
  for (let i = 1; i < path.length; i++) {
    let [ax, ay] = path[i - 1]
    const [bx, by] = path[i]
    let d = Math.hypot(bx - ax, by - ay)
    while (d >= left) {
      ax += ((bx - ax) * left) / d
      ay += ((by - ay) * left) / d
      out.push([ax, ay])
      d -= left
      left = step
    }
    left -= d
  }
  out.push(path[path.length - 1])
  return out
}

describe('a square drawn fast is still a square', () => {
  for (const [step, r] of [[25, 0], [35, 8], [45, 15], [30, 20]] as const)
    it(`a point every ${step}px, corners rounded ${r}px`, () => {
      expect(recognize(fastRect(200, 200, step, r, 10))).toMatchObject({ type: 'shape', kind: 'rect' })
      expect(recognize(fastRect(260, 140, step, r, 10))).toMatchObject({ type: 'shape', kind: 'rect' })
    })
  it('a slanted four-cornered shape with one round corner (as in the picture) is not a circle', () => {
    // its corners; the bottom-left one drawn round, the end a little past the start
    const q: Pt[] = [[40, 85], [218, 75], [262, 228], [93, 247]]
    const pts: Pt[] = []
    const seg = (a: Pt, b: Pt, n: number) => {
      for (let j = 0; j < n; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / n + Math.sin(j) * 0.8, a[1] + ((b[1] - a[1]) * j) / n])
    }
    seg(q[0], q[1], 12)
    seg(q[1], q[2], 10)
    seg(q[2], [110, 236], 10)
    // the round corner
    for (let k = 0; k <= 6; k++) {
      const a = Math.PI / 2 + (k / 6) * (Math.PI / 2.4)
      pts.push([110 + Math.cos(a) * 18, 236 + Math.sin(a) * 12 - 1])
    }
    seg([91, 228], [52, 92], 10)
    pts.push([36, 86])
    const r = recognize(pts)
    expect(r?.type === 'shape' && r.kind === 'ellipse').toBe(false)
    // four corners where they were drawn: the stroke's own, or a neat rectangle / rhombus over them
    const got: Pt[] =
      r?.type === 'poly'
        ? r.pts
        : r?.type === 'shape'
          ? (r.kind === 'rect' ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[0, -1], [1, 0], [0, 1], [-1, 0]]).map(([u, v]) => {
              const a = (r.rot * Math.PI) / 180
              const [x, y] = [(u * r.w) / 2, (v * r.h) / 2]
              return [r.cx + x * Math.cos(a) - y * Math.sin(a), r.cy + x * Math.sin(a) + y * Math.cos(a)] as Pt
            })
          : []
    expect(got).toHaveLength(4)
    for (const c of q) expect(Math.min(...got.map((g) => Math.hypot(g[0] - c[0], g[1] - c[1])))).toBeLessThan(25)
  })
  it('a fast circle is still a circle', () => {
    const c: Pt[] = Array.from({ length: 14 }, (_, i) => [Math.cos((i / 13) * Math.PI * 2.1) * 100, Math.sin((i / 13) * Math.PI * 2.1) * 98])
    expect(recognize(c)).toMatchObject({ type: 'shape', kind: 'ellipse' })
  })
})
