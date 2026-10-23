import { isDarkPaper, type BoardBg, type GridKind, type View } from '@shared/whiteboard'
import { cssColor } from '../../../lib/cssColor'

/** What one grid kind draws: the view's grid lines / dots in screen pixels (the transform — the device's). */
interface GridPass {
  g: CanvasRenderingContext2D
  bg: BoardBg
  v: View
  w: number
  h: number
  /** The step drawn (coarser when zoomed out). */
  step: number
  minor: string
  major: string
  isMajor: (n: number) => boolean
}

/** Each grid kind's drawing ('none' draws nothing). */
const GRID_PAINTERS: Record<GridKind, (p: GridPass) => void> = {
  none: () => {},
  dots: drawDots,
  lines: (p) => drawRuled(p, false),
  squares: (p) => drawRuled(p, true),
  iso: drawIso,
}

/** The paper's grid over the view (w×h screen px). */
export function drawGrid(g: CanvasRenderingContext2D, bg: BoardBg, v: View, w: number, h: number): void {
  if (bg.grid === 'none' || bg.opacity <= 0) return
  let step = bg.step
  // too dense when zoomed out: coarser
  while (step * v.z < 9) step *= bg.major > 1 ? bg.major : 2
  // the grid's colour (r g b), light on dark paper
  const base = cssColor(isDarkPaper(bg.color) ? '--board-grid-on-dark-rgb' : '--board-grid-on-light-rgb')
  const isMajor = (n: number) => bg.major > 1 && step === bg.step && Math.round(n) % bg.major === 0
  g.lineWidth = 1
  GRID_PAINTERS[bg.grid]({ g, bg, v, w, h, step, minor: `rgb(${base} / ${0.22 * bg.opacity})`, major: `rgb(${base} / ${0.45 * bg.opacity})`, isMajor })
}

/** The grid lines' indexes in view and their screen positions (crisp: on half pixels). */
function gridSpan({ v, w, h, step }: GridPass) {
  return {
    i0: Math.floor(v.x / step),
    i1: Math.ceil((v.x + w / v.z) / step),
    j0: Math.floor(v.y / step),
    j1: Math.ceil((v.y + h / v.z) / step),
    sx: (i: number) => Math.round((i * step - v.x) * v.z) + 0.5,
    sy: (j: number) => Math.round((j * step - v.y) * v.z) + 0.5,
  }
}

function drawDots(p: GridPass): void {
  const { g } = p
  const { i0, i1, j0, j1, sx, sy } = gridSpan(p)
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const m = p.isMajor(i) && p.isMajor(j)
      g.fillStyle = m ? p.major : p.minor
      g.beginPath()
      g.arc(sx(i) - 0.5, sy(j) - 0.5, m ? 1.7 : 1.15, 0, Math.PI * 2)
      g.fill()
    }
}

/** Horizontal lines (a ruled sheet), with the vertical ones too — squares. */
function drawRuled(p: GridPass, squares: boolean): void {
  const { g, w, h } = p
  const { i0, i1, j0, j1, sx, sy } = gridSpan(p)
  for (const m of [false, true]) {
    g.strokeStyle = m ? p.major : p.minor
    g.beginPath()
    if (squares)
      for (let i = i0; i <= i1; i++) {
        if (p.isMajor(i) !== m) continue
        g.moveTo(sx(i), 0)
        g.lineTo(sx(i), h)
      }
    for (let j = j0; j <= j1; j++) {
      if (p.isMajor(j) !== m) continue
      g.moveTo(0, sy(j))
      g.lineTo(w, sy(j))
    }
    g.stroke()
  }
}

/** Three families: vertical and ±30° — a triangular grid for isometric sketches. */
function drawIso({ g, v, w, h, step, minor }: GridPass): void {
  g.strokeStyle = minor
  const dirs = [
    [0, 1],
    [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)],
    [Math.cos((5 * Math.PI) / 6), Math.sin((5 * Math.PI) / 6)],
  ]
  const corners = [
    [v.x, v.y],
    [v.x + w / v.z, v.y],
    [v.x, v.y + h / v.z],
    [v.x + w / v.z, v.y + h / v.z],
  ]
  const len = (w + h) / v.z
  const cx = v.x + w / v.z / 2
  const cy = v.y + h / v.z / 2
  g.beginPath()
  for (const [dx, dy] of dirs) {
    const nx = -dy
    const ny = dx
    const ds = corners.map(([x, y]) => x * nx + y * ny)
    const k0 = Math.floor(Math.min(...ds) / step)
    const k1 = Math.ceil(Math.max(...ds) / step)
    for (let k = k0; k <= k1; k++) {
      const px = nx * k * step
      const py = ny * k * step
      const t = (cx - px) * dx + (cy - py) * dy
      g.moveTo((px + dx * (t - len) - v.x) * v.z, (py + dy * (t - len) - v.y) * v.z)
      g.lineTo((px + dx * (t + len) - v.x) * v.z, (py + dy * (t + len) - v.y) * v.z)
    }
  }
  g.stroke()
}
