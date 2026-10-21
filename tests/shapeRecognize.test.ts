import { describe, expect, it } from 'vitest'
import { recognize, type Pt } from '../src/shared/shapeRecognize'

// a hand: a steady wobble (not random — the test must not flicker)
const wob = (i: number, amp: number) => amp * (Math.sin(i * 0.9) * 0.6 + Math.sin(i * 2.3) * 0.4)
const along = (corners: Pt[], step = 3, amp = 1.5, close = true): Pt[] => {
  const out: Pt[] = []
  const cs = close ? [...corners, corners[0]] : corners
  let i = 0
  for (let k = 0; k + 1 < cs.length; k++) {
    const [a, b] = [cs[k], cs[k + 1]]
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    for (let j = 0; j < n; j++, i++) out.push([a[0] + ((b[0] - a[0]) * j) / n + wob(i, amp), a[1] + ((b[1] - a[1]) * j) / n + wob(i + 7, amp)])
  }
  out.push(cs[cs.length - 1])
  return out
}
const ellipse = (cx: number, cy: number, rx: number, ry: number, rot = 0, amp = 1.5, overshoot = 0.05): Pt[] =>
  Array.from({ length: 90 }, (_, i) => {
    const t = (i / 89) * Math.PI * 2 * (1 + overshoot)
    const x = Math.cos(t) * rx + wob(i, amp)
    const y = Math.sin(t) * ry + wob(i + 5, amp)
    return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)] as Pt
  })
const turn = (ps: Pt[], deg: number, cx: number, cy: number): Pt[] => {
  const a = (deg * Math.PI) / 180
  return ps.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)])
}

describe('a stroke held at the end becomes its shape', () => {
  it('a circle', () => {
    const r = recognize(ellipse(200, 200, 80, 78))
    expect(r).toMatchObject({ type: 'shape', kind: 'ellipse', rot: 0 })
    if (r?.type !== 'shape') return
    expect(r.w).toBe(r.h)
    expect(Math.abs(r.cx - 200)).toBeLessThan(5)
    expect(Math.abs(r.w - 160)).toBeLessThan(10)
  })
  it('a turned ellipse keeps its turn', () => {
    const r = recognize(ellipse(0, 0, 120, 50, (30 * Math.PI) / 180))
    expect(r).toMatchObject({ type: 'shape', kind: 'ellipse' })
    if (r?.type !== 'shape') return
    expect(Math.abs(r.rot - 30)).toBeLessThan(6)
  })
  it('a rectangle, a square turned 30°', () => {
    expect(recognize(along([[0, 0], [200, 0], [200, 100], [0, 100]]))).toMatchObject({ type: 'shape', kind: 'rect', rot: 0 })
    const sq = recognize(turn(along([[0, 0], [120, 0], [120, 120], [0, 120]]), 30, 60, 60))
    expect(sq?.type === 'shape' && (sq.kind === 'rect' || sq.kind === 'diamond')).toBe(true)
  })
  it('a rhombus', () => {
    expect(recognize(along([[100, 0], [180, 120], [100, 240], [20, 120]]))).toMatchObject({ type: 'shape', kind: 'diamond' })
  })
  it('a triangle — its three corners joined straight', () => {
    const r = recognize(along([[0, 200], [100, 0], [200, 200]]))
    expect(r).toMatchObject({ type: 'poly', closed: true })
    if (r?.type === 'poly') expect(r.pts).toHaveLength(3)
  })
  it('a straight line, snapped to the horizontal when near', () => {
    const r = recognize(along([[0, 0], [300, 12]], 3, 1.5, false))
    expect(r?.type).toBe('line')
    if (r?.type === 'line') expect(Math.abs(r.y1 - r.y0)).toBeLessThan(0.001)
  })
  it('a broken line of straight pieces', () => {
    const r = recognize(along([[0, 0], [150, 0], [150, 150]], 3, 1.2, false))
    expect(r).toMatchObject({ type: 'poly', closed: false })
    if (r?.type === 'poly') expect(r.pts).toHaveLength(3)
  })
  it('a scribble or a dot stays as drawn', () => {
    const scribble: Pt[] = Array.from({ length: 120 }, (_, i) => [i * 3 + Math.sin(i * 1.7) * 40, Math.cos(i * 0.9) * 60 + Math.sin(i * 0.37) * 50])
    expect(recognize(scribble)).toBeUndefined()
    expect(recognize([[0, 0], [1, 1], [2, 1], [3, 2], [4, 2], [5, 3]])).toBeUndefined()
  })
})
