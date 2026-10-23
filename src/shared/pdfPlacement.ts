/**
 * A signature placed on a PDF page and its geometry (pure): in PDF points from the page's top-left (independent
 * of the zoom), the box before turning; turned around its centre.
 */
export interface Placed {
  id: string
  page: number
  x: number
  y: number
  w: number
  h: number
  url: string
  /** Turn, degrees clockwise (around the centre). */
  rot: number
  /** 0…1 */
  opacity: number
  /** Repaint in this colour (the drawing's shape, one colour). */
  tint?: string
}

/** A page's size in points and its crop box (where drawings go on save). */
export interface PageBox {
  w: number
  h: number
  view: number[]
}

/** The width a new drawing takes (points; at most 40% of the page). */
const NEW_WIDTH = 170
/** The smallest width a drawing is resized to (points). */
const MIN_WIDTH = 20

/** A box's corner coordinate kept so its centre stays on the page (0…pw). */
export const clampCentre = (x: number, w: number, pw: number) => Math.max(-w / 2, Math.min(pw - w / 2, x))

/** A new drawing's box on a page: proportional to the picture, centred at (cx, cy) (default — the middle, ¾ down), inside the page. */
export function newPlacement(pg: PageBox, img: { w: number; h: number }, cx?: number, cy?: number): { x: number; y: number; w: number; h: number } {
  const w = Math.min(NEW_WIDTH, pg.w * 0.4)
  const h = (w * img.h) / img.w
  const x = Math.max(0, Math.min(pg.w - w, (cx ?? pg.w / 2) - w / 2))
  const y = Math.max(0, Math.min(pg.h - h, (cy ?? pg.h * 0.75) - h / 2))
  return { x, y, w, h }
}

/**
 * Resized from a corner (sx, sy = ±1) by the pointer's shift (dx, dy, points), keeping the proportions; the
 * opposite corner stays put (in the drawing's own turned frame).
 */
export function resizeFromCorner(s: Pick<Placed, 'x' | 'y' | 'w' | 'h' | 'rot'>, sx: number, sy: number, dx: number, dy: number): { x: number; y: number; w: number; h: number } {
  const a = (s.rot * Math.PI) / 180
  const ratio = s.h / s.w
  // the pointer's shift in the drawing's own (turned) frame
  const lx = dx * Math.cos(a) + dy * Math.sin(a)
  const ly = -dx * Math.sin(a) + dy * Math.cos(a)
  const w = Math.max(MIN_WIDTH, s.w + Math.max(sx * lx, (sy * ly) / ratio))
  const h = w * ratio
  // the centre moves by half the growth toward the dragged corner
  const ox = (sx * (w - s.w)) / 2
  const oy = (sy * (h - s.h)) / 2
  const cx = s.x + s.w / 2 + ox * Math.cos(a) - oy * Math.sin(a)
  const cy = s.y + s.h / 2 + ox * Math.sin(a) + oy * Math.cos(a)
  return { w, h, x: cx - w / 2, y: cy - h / 2 }
}

/** The turn after the pointer turned by `deltaRad` from `rot0`: in −180…180, Shift — by 15°, near straight — straight; to 0.1°. */
export function turnedBy(rot0: number, deltaRad: number, shift: boolean): number {
  let d = rot0 + (deltaRad * 180) / Math.PI
  d = ((d % 360) + 540) % 360 - 180
  if (shift) d = Math.round(d / 15) * 15
  else if (Math.abs(d) < 3) d = 0
  return Math.round(d * 10) / 10
}

/** Where the selected drawing's toolbar sits (px at the zoom): above the turned drawing's bounds, centred. */
export function barPosition(it: Pick<Placed, 'x' | 'y' | 'w' | 'h' | 'rot'>, zoom: number): { left: string; top: string } {
  const a = (it.rot * Math.PI) / 180
  const bh = Math.abs(it.w * Math.sin(a)) + Math.abs(it.h * Math.cos(a))
  const top = (it.y + it.h / 2 - bh / 2) * zoom
  return { left: `${(it.x + it.w / 2) * zoom}px`, top: `${top - 46}px` }
}

/**
 * Where pdf-lib draws the image: pdf.js measures from the crop box's top-left (y down), PDF draws from its
 * bottom-left (y up) and turns an image around its bottom-left corner, counter-clockwise — that corner placed
 * so the centre stays. `view` — the page's crop box [x0, y0, x1, y1].
 */
export function pdfImageBox(it: Pick<Placed, 'x' | 'y' | 'w' | 'h' | 'rot'>, view: number[]): { x: number; y: number; width: number; height: number; rotateDeg: number } {
  const a = (-it.rot * Math.PI) / 180
  const cx = view[0] + it.x + it.w / 2
  const cy = view[3] - it.y - it.h / 2
  return {
    x: cx - (it.w / 2) * Math.cos(a) + (it.h / 2) * Math.sin(a),
    y: cy - (it.w / 2) * Math.sin(a) - (it.h / 2) * Math.cos(a),
    width: it.w,
    height: it.h,
    rotateDeg: -it.rot,
  }
}
