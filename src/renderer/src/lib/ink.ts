import { getStroke, getStrokePoints } from 'perfect-freehand'
import { onBeforeUnmount, onMounted } from 'vue'
import { penNow } from './tablet'

/**
 * Smooth ink for Qvarch's drawing surfaces (perfect-freehand — the algorithm behind Excalidraw / tldraw):
 * every point the pointer had (the coalesced events — fast strokes keep their shape, no sharp corners), a lazy
 * follower (streamline), a curved outline (smoothing), the width from the pen's pressure (thinning; a mouse —
 * pressure simulated from the speed).
 *
 * Two canvases: `base` keeps the finished strokes, `live` shows the one being drawn (redrawn each frame).
 */
export interface InkStyle {
  color: string
  /** The base width, CSS px. */
  size: number
  /** 0…1: how lazily the line follows the pen (more — smoother, a bit behind). */
  streamline: number
  /** 0…1: how round the outline is. */
  smoothing: number
  /** 0…0.9: how much the pressure changes the width. */
  thinning: number
}

export const DEFAULT_INK = { streamline: 0.55, smoothing: 0.6, thinning: 0.55 }

/** An outline (perfect-freehand's polygon) → an SVG path, curved between the points. */
export function outlinePath(pts: number[][]): string {
  const n = pts.length
  if (n < 4) {
    if (!n) return ''
    // a dot
    const [x, y] = pts[0]
    return `M${x},${y} m-0.5,0 a0.5,0.5 0 1,0 1,0 a0.5,0.5 0 1,0 -1,0`
  }
  const avg = (a: number, b: number) => ((a + b) / 2).toFixed(2)
  let a = pts[0]
  let b = pts[1]
  const c = pts[2]
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${avg(b[0], c[0])},${avg(b[1], c[1])} T`
  for (let i = 2; i < n - 1; i++) {
    a = pts[i]
    b = pts[i + 1]
    d += `${avg(a[0], b[0])},${avg(a[1], b[1])} `
  }
  return d + 'Z'
}

/** A stroke's points [x, y, pressure] → its filled outline. */
export function strokePath(points: number[][], s: InkStyle, pen: boolean, last: boolean): Path2D {
  const outline = getStroke(points, {
    size: s.size,
    thinning: s.thinning,
    smoothing: s.smoothing,
    streamline: s.streamline,
    simulatePressure: !pen,
    last,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  })
  return new Path2D(outlinePath(outline))
}

export function useInk(opts: {
  base: () => HTMLCanvasElement | undefined
  live: () => HTMLCanvasElement | undefined
  style: () => InkStyle
  /** A stroke finished (to mark the surface as not empty, keep an undo list…). */
  onStroke?: (points: number[][], style: InkStyle, pen: boolean) => void
  /** Undo / redo changed what is drawn (how many steps are left back). */
  onHistory?: (undoLeft: number) => void
  /** Ctrl+Z / Ctrl+Y (also from the tablet's keys) undo here while this is true. */
  keys?: () => boolean
}) {
  // ---------- undo: the base canvas before each change ----------
  const undoStack: ImageData[] = []
  const redoStack: ImageData[] = []
  const MAX = 20
  const grab = (): ImageData | undefined => {
    const b = opts.base()
    return b && b.width && b.height ? b.getContext('2d')!.getImageData(0, 0, b.width, b.height) : undefined
  }
  const put = (img: ImageData): void => {
    const b = opts.base()
    if (!b) return
    const g = b.getContext('2d')!
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, b.width, b.height)
    if (img.width === b.width && img.height === b.height) g.putImageData(img, 0, 0)
  }
  /** Before a change that is not a stroke (clearing): one step back to here. */
  function snapshot(): void {
    const img = grab()
    if (!img) return
    undoStack.push(img)
    if (undoStack.length > MAX) undoStack.shift()
    redoStack.length = 0
  }
  function undo(): void {
    const prev = undoStack.pop()
    const cur = grab()
    if (!prev || !cur) return
    redoStack.push(cur)
    put(prev)
    opts.onHistory?.(undoStack.length)
  }
  function redo(): void {
    const next = redoStack.pop()
    const cur = grab()
    if (!next || !cur) return
    undoStack.push(cur)
    put(next)
    opts.onHistory?.(undoStack.length)
  }
  /** Ctrl+<physical key> → what it does (Shift held or not). */
  const historyKeys = new Map<string, (shift: boolean) => void>([
    ['KeyZ', (shift) => (shift ? redo() : undo())],
    ['KeyY', () => redo()],
  ])
  /** By the physical key — the Russian layout gives "я" for Z. */
  const onKey = (e: KeyboardEvent): void => {
    if (!opts.keys?.() || !(e.ctrlKey || e.metaKey) || e.altKey) return
    const t = e.target
    if (t instanceof HTMLElement && t.closest('input:not([type=range]):not([type=checkbox]):not([type=color]), textarea, [contenteditable="true"], .cm-editor')) return
    const act = historyKeys.get(e.code)
    if (!act) return
    act(e.shiftKey)
    e.preventDefault()
    e.stopPropagation()
  }
  if (opts.keys) {
    onMounted(() => window.addEventListener('keydown', onKey, true))
    onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
  }

  let points: number[][] = []
  let pen = false
  let drawing = false
  let frame = 0
  let style: InkStyle | undefined

  const at = (e: PointerEvent, c: HTMLCanvasElement): number[] => {
    const r = c.getBoundingClientRect()
    const p = penNow()
    // a pen tablet run by Qvarch gives the pressure; a real pen (Windows Ink) has its own; a mouse — none
    const pressure = p ? Math.max(0.02, p.pressure) : e.pointerType === 'pen' ? e.pressure : 0.5
    return [e.clientX - r.left, e.clientY - r.top, pressure]
  }
  function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const g = c.getContext('2d')!
    const k = c.width / Math.max(1, c.getBoundingClientRect().width)
    g.setTransform(k, 0, 0, k, 0, 0)
    return g
  }
  function paintLive(): void {
    frame = 0
    const c = opts.live()
    if (!c || !style) return
    const g = ctxOf(c)
    g.clearRect(0, 0, c.width, c.height)
    g.fillStyle = style.color
    g.fill(strokePath(points, style, pen, false))
  }

  function down(e: PointerEvent): void {
    const c = opts.live()
    if (!c || e.button !== 0) return
    c.setPointerCapture(e.pointerId)
    drawing = true
    style = { ...opts.style() }
    pen = !!penNow() || e.pointerType === 'pen'
    points = [at(e, c)]
    paintLive()
  }
  function move(e: PointerEvent): void {
    const c = opts.live()
    if (!drawing || !c) return
    // every point since the last frame — not just the last one
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    for (const ev of evs.length ? evs : [e]) points.push(at(ev, c))
    if (!frame) frame = requestAnimationFrame(paintLive)
  }
  function up(): void {
    if (!drawing) return
    drawing = false
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    const live = opts.live()
    const base = opts.base()
    if (live) live.getContext('2d')!.clearRect(0, 0, live.width, live.height)
    if (base && style && points.length) {
      snapshot()
      const g = ctxOf(base)
      g.fillStyle = style.color
      g.fill(strokePath(points, style, pen, true))
      opts.onStroke?.(points, style, pen)
    }
    points = []
  }
  return { down, move, up, undo, redo, snapshot }
}

/** #rrggbb → [r, g, b] */
function rgb(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(c)
  const v = m ? parseInt(m[1], 16) : 0
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
/** The colour `t` (0…1) of the way from `a` to `b`, as a canvas colour. */
const mixRgb = (a: readonly number[], b: readonly number[], t: number): string => `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`

/**
 * A gradient line: the colour follows the pressure — light → \`c1\`, firm → \`c2\`. Drawn as short round segments
 * along the smoothed points (the same follower as the plain ink), each as wide as the ink would be there.
 */
export function drawGradientStroke(g: CanvasRenderingContext2D, points: number[][], s: InkStyle, c2: string, last: boolean): void {
  const sp = getStrokePoints(points, { size: s.size, thinning: s.thinning, smoothing: s.smoothing, streamline: s.streamline, last })
  if (!sp.length) return
  const a = rgb(s.color)
  const b = rgb(c2)
  const col = (p: number) => mixRgb(a, b, Math.min(1, Math.max(0, p)))
  // perfect-freehand's radius at a pressure
  const width = (p: number) => Math.max(0.3, 2 * s.size * (0.5 - s.thinning * (0.5 - p)))
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (sp.length === 1) {
    g.fillStyle = col(sp[0].pressure)
    g.beginPath()
    g.arc(sp[0].point[0], sp[0].point[1], width(sp[0].pressure) / 2, 0, Math.PI * 2)
    g.fill()
    return
  }
  for (let k = 1; k < sp.length; k++) {
    const p = (sp[k - 1].pressure + sp[k].pressure) / 2
    g.strokeStyle = col(p)
    g.lineWidth = width(p)
    g.beginPath()
    g.moveTo(sp[k - 1].point[0], sp[k - 1].point[1])
    g.lineTo(sp[k].point[0], sp[k].point[1])
    g.stroke()
  }
}

/**
 * A broad-nib ink pen (a calligraphy / dip pen): a flat nib held at `angleDeg` — a stroke along the nib is a
 * hairline, across it the full width; firmer pressure opens the nib wider. The outline is the union of the
 * quads swept by the nib between the smoothed points.
 */
export function nibPath(points: number[][], s: Pick<InkStyle, 'size' | 'streamline' | 'smoothing'>, angleDeg: number, last: boolean): Path2D {
  const sp = getStrokePoints(points, { size: s.size, streamline: s.streamline, smoothing: s.smoothing, last })
  const path = new Path2D()
  if (!sp.length) return path
  const a = (angleDeg * Math.PI) / 180
  const ux = Math.cos(a)
  const uy = Math.sin(a)
  const half = (p: number) => (s.size * (0.3 + 0.7 * Math.min(1, Math.max(0, p)))) / 2
  // the thinnest a hairline gets
  const tx = -uy * Math.max(0.35, s.size * 0.04)
  const ty = ux * Math.max(0.35, s.size * 0.04)
  const quad = (q: number[][]) => {
    // one winding for all (else overlapping quads cancel out into holes)
    let area = 0
    for (let i = 0; i < 4; i++) area += q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1]
    if (area < 0) q.reverse()
    path.moveTo(q[0][0], q[0][1])
    for (let i = 1; i < 4; i++) path.lineTo(q[i][0], q[i][1])
    path.closePath()
  }
  for (let k = 0; k < sp.length; k++) {
    const [x, y] = sp[k].point
    const h = half(sp[k].pressure)
    // the nib's own mark at every point (a stroke along the nib still shows its hairline)
    quad([
      [x - ux * h - tx, y - uy * h - ty],
      [x + ux * h - tx, y + uy * h - ty],
      [x + ux * h + tx, y + uy * h + ty],
      [x - ux * h + tx, y - uy * h + ty],
    ])
    if (!k) continue
    const [x0, y0] = sp[k - 1].point
    const h0 = half(sp[k - 1].pressure)
    quad([
      [x0 - ux * h0, y0 - uy * h0],
      [x0 + ux * h0, y0 + uy * h0],
      [x + ux * h, y + uy * h],
      [x - ux * h, y - uy * h],
    ])
  }
  return path
}

/** The smoothed points of a stroke with their pressure (for effects along it). */
export function smoothPoints(points: number[][], s: Pick<InkStyle, 'size' | 'streamline' | 'smoothing'>): Array<{ x: number; y: number; p: number }> {
  return getStrokePoints(points, { size: s.size, streamline: s.streamline, smoothing: s.smoothing, last: true }).map((q) => ({ x: q.point[0], y: q.point[1], p: q.pressure }))
}

/**
 * The ink pen with a gradient: the same nib, coloured by the pressure — light → `s.color`, firm → `c2`. The
 * pieces of one shade go into one outline (12 shades), so there are seams only where the colour steps.
 */
export function drawNibGradient(g: CanvasRenderingContext2D, points: number[][], s: InkStyle, angleDeg: number, c2: string, last: boolean): void {
  const sp = getStrokePoints(points, { size: s.size, streamline: s.streamline, smoothing: s.smoothing, last })
  if (!sp.length) return
  const a = rgb(s.color)
  const b = rgb(c2)
  const STEPS = 12
  const shade = (p: number) => Math.round(Math.min(1, Math.max(0, p)) * STEPS)
  const col = (n: number) => `rgb(${a.map((v, k) => Math.round(v + ((b[k] - v) * n) / STEPS)).join(',')})`
  // runs of points of one shade (each run overlaps the next by a point — no gap between them)
  let from = 0
  for (let k = 1; k <= sp.length; k++) {
    if (k < sp.length && shade(sp[k].pressure) === shade(sp[from].pressure)) continue
    const run = sp.slice(from, Math.min(sp.length, k + 1)).map((q) => [q.point[0], q.point[1], q.pressure])
    g.fillStyle = col(shade(sp[from].pressure))
    g.fill(nibPath(run, { size: s.size, streamline: 0, smoothing: 0 }, angleDeg, true))
    from = k
  }
}
