import { describe, expect, it } from 'vitest'
import { EdgeHop, edgeAt, HOP_DWELL_MS, surfaceBeyond, type HopInput } from '../src/shared/tabletHop'

// two boards one under the other (a note), a third to the right of the first
const A = { id: 1, x: 100, y: 100, w: 400, h: 300 }
const B = { id: 2, x: 100, y: 450, w: 400, h: 300 }
const C = { id: 3, x: 560, y: 120, w: 300, h: 200 }

describe('the surface beyond an edge', () => {
  it('the edge the pen is at', () => {
    expect(edgeAt({ x: 300, y: 398 }, A)).toBe('bottom')
    expect(edgeAt({ x: 499, y: 200 }, A)).toBe('right')
    expect(edgeAt({ x: 300, y: 250 }, A)).toBeUndefined()
  })
  it('wholly on that side; facing it first, then the nearest', () => {
    expect(surfaceBeyond('bottom', A, [B, C])?.id).toBe(2)
    expect(surfaceBeyond('right', A, [B, C])?.id).toBe(3)
    expect(surfaceBeyond('left', A, [B, C])).toBeUndefined()
    expect(surfaceBeyond('top', B, [A, C])?.id).toBe(1)
  })
})

describe('the pen going over', () => {
  const at = (over: Partial<HopInput>): HopInput => ({ now: 0, at: { x: 300, y: 399 }, active: A, others: [B, C], hovering: true, drawing: false, heading: { x: 0, y: 400 }, ...over })
  it('come at the edge, held there (still — clamped) — over after the wait, not at once', () => {
    const h = new EdgeHop()
    expect(h.feed(at({ now: 0 })).pending).toEqual({ target: 2, side: 'bottom', progress: 0 })
    expect(h.feed(at({ now: HOP_DWELL_MS / 2, heading: { x: 0, y: 0 } })).pending?.progress).toBeCloseTo(0.5)
    expect(h.feed(at({ now: HOP_DWELL_MS + 1, heading: { x: 0, y: 0 } })).hop).toBe(2)
  })
  it('never while drawing, never when not hovering, never resting by an edge it did not come at', () => {
    expect(new EdgeHop().feed(at({ drawing: true }))).toEqual({})
    expect(new EdgeHop().feed(at({ hovering: false }))).toEqual({})
    expect(new EdgeHop().feed(at({ heading: { x: 0, y: 0 } }))).toEqual({})
    expect(new EdgeHop().feed(at({ heading: { x: 300, y: 0 } }))).toEqual({})
  })
  it('the pen leaves the edge or touches down — the wait is over', () => {
    const h = new EdgeHop()
    h.feed(at({ now: 0 }))
    expect(h.feed(at({ now: 200, at: { x: 300, y: 300 } }))).toEqual({})
    h.feed(at({ now: 300 }))
    expect(h.feed(at({ now: 300 + HOP_DWELL_MS, drawing: true }))).toEqual({})
  })
  it('no surface beyond that edge — nothing', () => {
    expect(new EdgeHop().feed(at({ at: { x: 101, y: 250 }, heading: { x: -400, y: 0 } }))).toEqual({})
  })
})
