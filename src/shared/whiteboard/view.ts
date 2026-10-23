import type { Box } from './model'

/** The board's view: its top-left in world units and its zoom; screen ↔ world; a small map of the board. */
export interface View {
  x: number
  y: number
  z: number
}

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 8

/** A screen point (px from the sheet's top-left) on the board. */
export const toWorld = (v: View, sx: number, sy: number) => [v.x + sx / v.z, v.y + sy / v.z] as const
/** A board point on the screen. */
export const toScreen = (v: View, wx: number, wy: number) => [(wx - v.x) * v.z, (wy - v.y) * v.z] as const

/** The view zoomed by `f` around a screen point (that point stays where it is), the zoom kept in its limits. */
export function zoomAround(v: View, f: number, sx: number, sy: number): View {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z * f))
  const [wx, wy] = toWorld(v, sx, sy)
  return { x: wx - sx / z, y: wy - sy / z, z }
}

/** The view whose centre is a board point (the zoom kept), for a w×h sheet. */
export const centredOn = (wx: number, wy: number, z: number, w: number, h: number): View => ({ x: wx - w / 2 / z, y: wy - h / 2 / z, z })

/** A saved view (anything else — undefined). */
export function parseView(raw: string | null): View | undefined {
  try {
    const v = JSON.parse(raw ?? 'null') as View | null
    return v && [v.x, v.y, v.z].every(Number.isFinite) ? v : undefined
  } catch {
    return undefined
  }
}

/** Where the world sits on a small map: its offset (px) and scale (px per world unit). */
export interface MapFit {
  x: number
  y: number
  k: number
}

/** A w×h map (with a margin `pad`) of what is drawn and the view, together, fitted and centred. */
export function mapLayout(viewBox: Box, content: Box | undefined, w: number, h: number, pad: number): { box: Box; map: MapFit } {
  const box = content ? { x0: Math.min(content.x0, viewBox.x0), y0: Math.min(content.y0, viewBox.y0), x1: Math.max(content.x1, viewBox.x1), y1: Math.max(content.y1, viewBox.y1) } : viewBox
  const k = Math.min((w - pad * 2) / Math.max(1, box.x1 - box.x0), (h - pad * 2) / Math.max(1, box.y1 - box.y0))
  const x = (w - (box.x1 - box.x0) * k) / 2 - box.x0 * k
  const y = (h - (box.y1 - box.y0) * k) / 2 - box.y0 * k
  return { box, map: { x, y, k } }
}

/** A point on the map (px from its top-left) on the board. */
export const mapToWorld = (m: MapFit, px: number, py: number) => [(px - m.x) / m.k, (py - m.y) / m.k] as const
