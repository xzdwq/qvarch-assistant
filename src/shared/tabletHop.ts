/**
 * The pen moved over to another drawing surface (several boards on screen — a note's): the tablet is mapped onto
 * one surface at a time, the pen cannot leave it by itself. Held at an edge, hovering (nothing drawn), having come
 * at that edge from inside — with another surface beyond it — for a moment, it goes over there. Pure: the screen
 * part feeds it the pen and the surfaces.
 */

/** A surface's edges (the pen goes over one, comes in at one). */
export const HOP_SIDES = ['left', 'right', 'top', 'bottom'] as const
export type HopSide = (typeof HOP_SIDES)[number]
/** The edge of the next surface the pen comes in at, going over this one. */
export const HOP_ENTRY: Record<HopSide, HopSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }
/** A surface's visible area on screen (px). */
export interface HopRect {
  id: number
  x: number
  y: number
  w: number
  h: number
}
export interface HopInput {
  now: number
  /** The pointer on screen (px). */
  at: { x: number; y: number }
  active: HopRect
  others: readonly HopRect[]
  /** The pen in range, not touching (hovering). */
  hovering: boolean
  /** Something is being drawn (the tip / a button down) — no hop. */
  drawing: boolean
  /** Where the pen was going lately (px per second; 0 — still). */
  heading: { x: number; y: number }
}
/** A hop being waited for: to which surface, over which edge, how far the wait is (0…1). */
export interface HopPending {
  target: number
  side: HopSide
  progress: number
}

/** How close to an edge counts as at it, px. */
export const HOP_EDGE_PX = 6
/** How long the pen is held at the edge before it goes over, ms (by default — the tablet's settings set it). */
export const HOP_DWELL_MS = 450
/** How fast the pen must have been coming at the edge (px / s) — a pen resting by an edge stays. */
export const HOP_MIN_SPEED = 60

/** An edge's outward direction. */
const OUTWARD: Record<HopSide, { x: number; y: number }> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } }
const SIDES = HOP_SIDES

/** The edge of `r` the point is at (within `px`), if any — the one it is closest to. */
export function edgeAt(p: { x: number; y: number }, r: HopRect, px = HOP_EDGE_PX): HopSide | undefined {
  const dist: Record<HopSide, number> = { left: p.x - r.x, right: r.x + r.w - p.x, top: p.y - r.y, bottom: r.y + r.h - p.y }
  const near = SIDES.filter((s) => dist[s] <= px).sort((a, b) => dist[a] - dist[b])
  return near[0]
}

/** How much two spans overlap. */
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
/**
 * The surface beyond an edge: wholly on that side of it; facing it (overlapping along the edge) first, then the
 * nearest one.
 */
export function surfaceBeyond(side: HopSide, a: HopRect, others: readonly HopRect[]): HopRect | undefined {
  const beyond: Record<HopSide, (o: HopRect) => number | undefined> = {
    left: (o) => (o.x + o.w <= a.x + 1 ? a.x - (o.x + o.w) : undefined),
    right: (o) => (o.x >= a.x + a.w - 1 ? o.x - (a.x + a.w) : undefined),
    top: (o) => (o.y + o.h <= a.y + 1 ? a.y - (o.y + o.h) : undefined),
    bottom: (o) => (o.y >= a.y + a.h - 1 ? o.y - (a.y + a.h) : undefined),
  }
  const along = (o: HopRect) => (side === 'left' || side === 'right' ? overlap(a.y, a.y + a.h, o.y, o.y + o.h) : overlap(a.x, a.x + a.w, o.x, o.x + o.w))
  const ranked = others
    .filter((o) => o.id !== a.id)
    .map((o) => ({ o, gap: beyond[side](o), facing: along(o) > 0 }))
    .filter((x): x is { o: HopRect; gap: number; facing: boolean } => x.gap !== undefined)
    .sort((x, y) => Number(y.facing) - Number(x.facing) || x.gap - y.gap)
  return ranked[0]?.o
}

/** The hop's wait: started when the pen comes at an edge with a surface beyond, kept while it stays there. */
export class EdgeHop {
  private wait?: { target: number; side: HopSide; since: number }

  /** `dwellMs` — how long the pen is held at the edge (read each time: the setting may change). */
  constructor(private dwellMs: () => number = () => HOP_DWELL_MS) {}

  /** The pen now: the hop waited for (and how far), or the surface to go over to now. */
  feed(i: HopInput): { pending?: HopPending; hop?: number } {
    const side = i.hovering && !i.drawing ? edgeAt(i.at, i.active) : undefined
    const target = side && surfaceBeyond(side, i.active, i.others)
    if (!side || !target) return this.reset()
    const w = this.wait
    if (!w || w.side !== side || w.target !== target.id) {
      // a new wait — only when the pen came at this edge (clamped there it stands still: the wait goes on)
      const out = OUTWARD[side]
      if (i.heading.x * out.x + i.heading.y * out.y < HOP_MIN_SPEED) return this.reset()
      this.wait = { target: target.id, side, since: i.now }
      return { pending: { target: target.id, side, progress: 0 } }
    }
    const progress = (i.now - w.since) / Math.max(1, this.dwellMs())
    if (progress < 1) return { pending: { target: w.target, side, progress } }
    this.wait = undefined
    return { hop: w.target }
  }
  reset(): { pending?: undefined } {
    this.wait = undefined
    return {}
  }
}
