/**
 * Island geometry shared by main and renderer.
 * The island window has a fixed size and is transparent + click-through outside the visible content;
 * the content itself morphs (pill ↔ panel) with CSS transitions, so there is no window resizing jank.
 */
export const ISLAND_WINDOW = { width: 800, height: 640 }
export const ISLAND_PILL = { width: 750, height: 70 }
export const ISLAND_PANEL_WIDTH = 750 // same width as the collapsed pill

/** The screen edge the island sticks to (or none — it floats). */
export type Dock = 'top' | 'bottom' | 'left' | 'right'
/** The docked pill: a thin strip along a top / bottom edge, a narrow upright one along a side. */
export const DOCK_STRIP = { w: 260, h: 34 }
export const DOCK_SIDE = { w: 34, h: 260 }
/**
 * Magnetic edges with hysteresis: a floating pill is caught within DOCK_ATTACH of an edge; a stuck one stays
 * until pulled further than DOCK_DETACH — a small slip of the hand never unsticks it.
 */
export const DOCK_ATTACH = 20
export const DOCK_DETACH = 24

interface Box {
  x: number
  y: number
  width: number
  height: number
}
/**
 * Which edge a pill released at `pill` (screen px) sticks to: the nearest edge of its display's work area
 * within `reach` — only an outer edge: where another display continues beyond it (two monitors side by
 * side) the pill must pass through, so that edge never catches it.
 */
export function dockFor(pill: Box, display: { bounds: Box; workArea: Box }, others: Array<{ bounds: Box }>, reach = DOCK_ATTACH): Dock | undefined {
  const wa = display.workArea
  const b = display.bounds
  const overlapV = (o: Box) => o.y < pill.y + pill.height && pill.y < o.y + o.height
  const overlapH = (o: Box) => o.x < pill.x + pill.width && pill.x < o.x + o.width
  const near = (a: number, c: number) => Math.abs(a - c) <= 2
  const outer: Record<Dock, boolean> = {
    left: !others.some((o) => near(o.bounds.x + o.bounds.width, b.x) && overlapV(o.bounds)),
    right: !others.some((o) => near(o.bounds.x, b.x + b.width) && overlapV(o.bounds)),
    top: !others.some((o) => near(o.bounds.y + o.bounds.height, b.y) && overlapH(o.bounds)),
    bottom: !others.some((o) => near(o.bounds.y, b.y + b.height) && overlapH(o.bounds)),
  }
  const dist: Array<[Dock, number]> = [
    ['top', pill.y - wa.y],
    ['bottom', wa.y + wa.height - (pill.y + pill.height)],
    ['left', pill.x - wa.x],
    ['right', wa.x + wa.width - (pill.x + pill.width)],
  ]
  const hit = dist.filter(([e, d]) => outer[e] && d <= reach).sort((a, c) => a[1] - c[1])
  return hit[0]?.[0]
}

/** The edge a pill sticks to, given the one it is stuck to now (hysteresis: leaving takes a longer pull). */
export function nextDock(pill: Box, display: { bounds: Box; workArea: Box }, others: Array<{ bounds: Box }>, current?: Dock): Dock | undefined {
  if (current && dockFor(pill, display, others, DOCK_DETACH) === current) return current
  return dockFor(pill, display, others, DOCK_ATTACH)
}
