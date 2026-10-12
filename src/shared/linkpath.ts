/**
 * Geometry of link lines (timelines and the task board): every block offers its four corners, a note
 * pin its top and bottom; a link takes the closest pair, and is drawn in the style chosen in settings.
 */
export type LinkStyle = 'curve' | 'straight' | 'elbow' | 'rounded'
export const LINK_STYLES: Array<{ id: LinkStyle; label: string }> = [
  { id: 'curve', label: 'Дуга' },
  { id: 'straight', label: 'Прямая' },
  { id: 'elbow', label: 'С углами' },
  { id: 'rounded', label: 'Скруглённая' },
]
export const isLinkStyle = (v: unknown): v is LinkStyle => LINK_STYLES.some((s) => s.id === v)

/**
 * A point a line may start from; `dir` is where it leaves: up (-1) from a top edge, down (+1) from a bottom
 * one — or, with `h`, left (-1) from a left edge, right (+1) from a right one.
 */
export interface Anchor {
  x: number
  y: number
  dir: -1 | 1
  h?: boolean
}
type Rect = { left: number; top: number; right: number; bottom: number }

/** The four corners of a block, on its top / bottom edge (the line leaves outward — never across the text). */
export function cornerAnchors(r: Rect, insetX = 8, insetY = 0): Anchor[] {
  const ix = Math.min(insetX, (r.right - r.left) / 2)
  const iy = Math.min(insetY, (r.bottom - r.top) / 2)
  return [
    { x: r.left + ix, y: r.top + iy, dir: -1 },
    { x: r.right - ix, y: r.top + iy, dir: -1 },
    { x: r.left + ix, y: r.bottom - iy, dir: 1 },
    { x: r.right - ix, y: r.bottom - iy, dir: 1 },
  ]
}
/**
 * The sides of a block (a calendar's vertical events): near the top and the bottom of the left and right
 * edges — the line leaves sideways into the gap between the days, not across the text.
 */
export function sideAnchors(r: Rect, inset = 10): Anchor[] {
  const top = r.top + Math.min(inset, (r.bottom - r.top) / 2)
  const bottom = r.bottom - Math.min(inset, (r.bottom - r.top) / 2)
  const ys = bottom - top > 12 ? [top, bottom] : [top]
  return ys.flatMap((y) => [
    { x: r.left, y, dir: -1 as const, h: true },
    { x: r.right, y, dir: 1 as const, h: true },
  ])
}
/** A small pin (a note): its top and bottom centre. */
export function pinAnchors(r: Rect): Anchor[] {
  const x = (r.left + r.right) / 2
  return [
    { x, y: r.top, dir: -1 },
    { x, y: r.bottom, dir: 1 },
  ]
}

/** The closest pair of anchors — the line goes the short way. */
export function closestPair(as: Anchor[], bs: Anchor[]): [Anchor, Anchor] | undefined {
  let best: [Anchor, Anchor] | undefined
  let bestD = Infinity
  for (const a of as)
    for (const b of bs) {
      const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2
      if (d < bestD - 0.01) {
        bestD = d
        best = [a, b]
      }
    }
  return best
}

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0)

/** Lines between side anchors: they run in the gap beside the blocks. */
function sidePath(a: Anchor, b: Anchor, style: LinkStyle): { d: string; mid: { x: number; y: number } } {
  const dx = Math.abs(b.x - a.x)
  if (style === 'curve') {
    // across days — a wide S; within a column — a small bulge into the gap
    const k = dx > 30 ? Math.min(90, dx * 0.45) : 9 + Math.min(9, Math.abs(b.y - a.y) * 0.03)
    const ctrl = (p: Anchor) => (p.h ? { x: p.x + p.dir * k, y: p.y } : { x: p.x, y: p.y + p.dir * k })
    const c1 = ctrl(a)
    const c2 = ctrl(b)
    const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 }
    return { d: `M${r1(a.x)},${r1(a.y)} C${r1(c1.x)},${r1(c1.y)} ${r1(c2.x)},${r1(c2.y)} ${r1(b.x)},${r1(b.y)}`, mid }
  }
  // elbow / rounded: sideways out, along the gap, sideways in
  const OUT = 8
  const xa = a.x + (a.h ? a.dir : 0) * OUT
  const xb = b.x + (b.h ? b.dir : 0) * OUT
  const x = a.dir === b.dir ? (a.dir < 0 ? Math.min(xa, xb) : Math.max(xa, xb)) : (xa + xb) / 2
  const mid = { x, y: (a.y + b.y) / 2 }
  if (style === 'elbow') return { d: `M${r1(a.x)},${r1(a.y)} H${r1(x)} V${r1(b.y)} H${r1(b.x)}`, mid }
  const sy = sign(b.y - a.y)
  const s1 = sign(x - a.x)
  const s2 = sign(b.x - x)
  const r = Math.max(0, Math.min(8, Math.abs(b.y - a.y) / 2, Math.abs(x - a.x), Math.abs(b.x - x)))
  if (!r || !sy) return { d: `M${r1(a.x)},${r1(a.y)} H${r1(x)} V${r1(b.y)} H${r1(b.x)}`, mid }
  return {
    d:
      `M${r1(a.x)},${r1(a.y)} H${r1(x - s1 * r)} Q${r1(x)},${r1(a.y)} ${r1(x)},${r1(a.y + sy * r)}` +
      ` V${r1(b.y - sy * r)} Q${r1(x)},${r1(b.y)} ${r1(x + s2 * r)},${r1(b.y)} H${r1(b.x)}`,
    mid,
  }
}
const r1 = (v: number) => Math.round(v * 10) / 10

/** The path of a line from a to b in a style, and its middle (where the "unlink" button goes). */
export function linkPath(a: Anchor, b: Anchor, style: LinkStyle): { d: string; mid: { x: number; y: number } } {
  if (style === 'straight') return { d: `M${r1(a.x)},${r1(a.y)} L${r1(b.x)},${r1(b.y)}`, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  if (a.h || b.h) return sidePath(a, b, style)

  if (style === 'curve') {
    const k = 14 + Math.min(36, Math.abs(b.x - a.x) * 0.22)
    const c1 = { x: a.x, y: a.y + a.dir * k }
    const c2 = { x: b.x, y: b.y + b.dir * k }
    const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 }
    return { d: `M${r1(a.x)},${r1(a.y)} C${r1(c1.x)},${r1(c1.y)} ${r1(c2.x)},${r1(c2.y)} ${r1(b.x)},${r1(b.y)}`, mid }
  }

  // elbow / rounded: out of each end vertically, joined by one horizontal run
  const OUT = 10
  const ya = a.y + a.dir * OUT
  const yb = b.y + b.dir * OUT
  const y = a.dir === b.dir ? (a.dir < 0 ? Math.min(ya, yb) : Math.max(ya, yb)) : (ya + yb) / 2
  const mid = { x: (a.x + b.x) / 2, y }
  if (style === 'elbow') return { d: `M${r1(a.x)},${r1(a.y)} V${r1(y)} H${r1(b.x)} V${r1(b.y)}`, mid }

  const sx = sign(b.x - a.x)
  const s1 = sign(y - a.y)
  const s2 = sign(b.y - y)
  const r = Math.max(0, Math.min(8, Math.abs(b.x - a.x) / 2, Math.abs(y - a.y), Math.abs(b.y - y)))
  if (!r || !sx) return { d: `M${r1(a.x)},${r1(a.y)} V${r1(y)} H${r1(b.x)} V${r1(b.y)}`, mid }
  return {
    d:
      `M${r1(a.x)},${r1(a.y)} V${r1(y - s1 * r)} Q${r1(a.x)},${r1(y)} ${r1(a.x + sx * r)},${r1(y)}` +
      ` H${r1(b.x - sx * r)} Q${r1(b.x)},${r1(y)} ${r1(b.x)},${r1(y + s2 * r)} V${r1(b.y)}`,
    mid,
  }
}
