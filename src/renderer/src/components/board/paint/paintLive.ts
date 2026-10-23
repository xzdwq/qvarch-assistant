import { apply, handlesOf, itemBox, ROT_OFF, type View } from '@shared/whiteboard'
import { drawGradientStroke, drawNibGradient, nibPath, strokePath } from '../../../lib/ink'
import type { BoardCtx } from '../boardContext'
import { selectionBox } from '../gestures/selectGestures'
import type { LiveStroke } from '../scene'
import type { BoardPainter } from './boardPainter'
import { TOOTH } from './paperTexture'
import { cssColor } from '../../../lib/cssColor'

/** The theme's accent for the canvas (it follows the user's colour). */
export const accentColor = (a = 1) => `rgb(${cssColor('--accent-rgb')} / ${a})`

/**
 * The live layer over the board: the stroke / shape being drawn, the tool's size circle at the pointer, the
 * selection frame being dragged, the selection with its handles.
 */
export function paintLiveLayer(c: HTMLCanvasElement, b: BoardCtx, painter: BoardPainter): void {
  const v = b.viewport.view.value
  if (!v) return
  const g = c.getContext('2d')!
  const k = devicePixelRatio
  const { scene } = b
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, c.width, c.height)
  if (scene.live && !scene.snapped?.shape) {
    g.setTransform(k * v.z, 0, 0, k * v.z, -v.x * v.z * k, -v.y * v.z * k)
    drawLiveStroke(g, scene.live, b, painter)
  }
  if (scene.drawing) {
    g.setTransform(k * v.z, 0, 0, k * v.z, -v.x * v.z * k, -v.y * v.z * k)
    painter.drawShape(g, scene.drawing)
  }
  g.setTransform(k, 0, 0, k, 0, 0)
  drawSizeRing(g, b, v)
  drawFrameRect(g, b)
  drawSelection(g, b)
}

/** The stroke being drawn (on textured paper the tooth shows in it too — only over the stroke, every frame). */
function drawLiveStroke(g: CanvasRenderingContext2D, live: LiveStroke, b: BoardCtx, painter: BoardPainter): void {
  const st = live.style
  g.globalAlpha = st.opacity
  // as the finished ink is drawn (BoardPainter.drawInk): a gradient — by the pressure, else one fill
  if (st.gradient) {
    if (st.nib !== undefined) drawNibGradient(g, live.pts, st, st.nib, st.gradient, false)
    else drawGradientStroke(g, live.pts, st, st.gradient, false)
  } else {
    g.fillStyle = st.color
    g.fill(st.nib !== undefined ? nibPath(live.pts, st, st.nib, false) : strokePath(live.pts, st, live.pen, false))
  }
  g.globalAlpha = 1
  const bg = b.doc.board.value.bg
  const tooth = bg.texture === 'paper' && !st.marker ? painter.paper.toothOf(g, bg.color) : undefined
  if (!tooth) return
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of live.pts) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  const pad = st.size * 1.5 + 2
  g.save()
  g.globalCompositeOperation = 'destination-out'
  g.globalAlpha = TOOTH
  g.fillStyle = tooth
  g.fillRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2)
  g.restore()
}

/** The size circle at the pointer: the eraser's own size, or the line's width on screen (not while drawing). */
function drawSizeRing(g: CanvasRenderingContext2D, b: BoardCtx, v: View): void {
  const hover = b.scene.hover
  const ring = b.tools.spec.value.ring
  if (!hover || !ring || (ring === 'line' && b.scene.live)) return
  const d = ring === 'screen' ? b.tools.size.value : Math.max(2, b.tools.size.value * v.z)
  g.strokeStyle = cssColor(b.tools.dark.value ? '--board-ring-on-dark' : '--board-ring-on-light')
  g.lineWidth = 1
  g.beginPath()
  g.arc(hover[0], hover[1], d / 2, 0, Math.PI * 2)
  g.stroke()
}

/** The selection frame being dragged. */
function drawFrameRect(g: CanvasRenderingContext2D, b: BoardCtx): void {
  const f = b.scene.frameRect
  if (!f) return
  const [x0, y0] = b.viewport.toScreen(f.x0, f.y0)
  const [x1, y1] = b.viewport.toScreen(f.x1, f.y1)
  g.fillStyle = accentColor(0.1)
  g.strokeStyle = accentColor()
  g.lineWidth = 1
  g.setLineDash([4, 3])
  g.fillRect(x0, y0, x1 - x0, y1 - y0)
  g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0)
  g.setLineDash([])
}

/** The selection: each item lightly, the group with its handles (turning — the frame turned with it). */
function drawSelection(g: CanvasRenderingContext2D, b: BoardCtx): void {
  const sel = b.doc.sel.value
  const sb = selectionBox(b)
  if (!sb || !sel.size) return
  const toScreen = b.viewport.toScreen
  g.strokeStyle = accentColor(0.45)
  g.lineWidth = 1
  g.setLineDash([3, 3])
  for (const i of b.doc.shown()) {
    if (!sel.has(i.id) || sel.size === 1) continue
    const bx = itemBox(i)
    const [x0, y0] = toScreen(bx.x0, bx.y0)
    const [x1, y1] = toScreen(bx.x1, bx.y1)
    g.strokeRect(x0, y0, x1 - x0, y1 - y0)
  }
  g.setLineDash([])
  g.strokeStyle = accentColor()
  g.lineWidth = 1.5
  const turning = b.scene.turning
  if (turning) {
    // the original frame through the turn
    const b0 = turning.box
    const cs = [apply(turning.xf, b0.x0, b0.y0), apply(turning.xf, b0.x1, b0.y0), apply(turning.xf, b0.x1, b0.y1), apply(turning.xf, b0.x0, b0.y1)].map(([x, y]) => toScreen(x, y))
    g.beginPath()
    cs.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.closePath()
    g.stroke()
    return
  }
  const [x0, y0] = toScreen(sb.x0, sb.y0)
  const [x1, y1] = toScreen(sb.x1, sb.y1)
  g.strokeRect(x0, y0, x1 - x0, y1 - y0)
  g.beginPath()
  g.moveTo((x0 + x1) / 2, y0)
  g.lineTo((x0 + x1) / 2, y0 - ROT_OFF + 6)
  g.stroke()
  g.fillStyle = cssColor('--board-handle')
  for (const p of handlesOf(sb, toScreen)) {
    g.beginPath()
    if (p.h === 'rot') g.arc(p.x, p.y, 6, 0, Math.PI * 2)
    else g.rect(p.x - 5, p.y - 5, 10, 10)
    g.fill()
    g.stroke()
  }
}
