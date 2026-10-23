import { itemBox, isLineKind, shapeD, type Board, type BoardItem, type ImageItem, type InkItem, type ShapeItem, type TextItem, type View } from '@shared/whiteboard'
import { drawGradientStroke, drawNibGradient, nibPath, strokePath } from '../../../lib/ink'
import { FONT, LINE } from '../textMeasure'
import { cssColor } from '../../../lib/cssColor'
import { drawGrid } from './drawGrid'
import { PaperTexture, TOOTH } from './paperTexture'
import type { PictureCache } from './pictureCache'

/** An ink item's flat points as [x, y, pressure] triples. */
export const inkPoints = (i: InkItem): number[][] => {
  const pts: number[][] = []
  for (let k = 0; k < i.pts.length; k += 3) pts.push([i.pts[k], i.pts[k + 1], i.pts[k + 2]])
  return pts
}

/**
 * Draws boards onto canvases: the paper (its tone, its grid), then the pictures, then the ink, texts and shapes in
 * their order. On textured paper the ink goes through a layer the paper's tooth is cut out of.
 */
export class BoardPainter {
  /** Each ink item's outline (items never change — a changed one is a new object). */
  private readonly paths = new WeakMap<InkItem, Path2D>()
  readonly paper = new PaperTexture()

  constructor(private readonly pictures: PictureCache) {}

  /** The whole board in a w×h view (screen px; `k` — device pixels per px); `hideId` — an item not drawn (being typed). */
  paintBoard(g: CanvasRenderingContext2D, b: Board, items: BoardItem[], v: View, w: number, h: number, k: number, hideId?: string): void {
    g.setTransform(k, 0, 0, k, 0, 0)
    g.fillStyle = b.bg.color
    g.fillRect(0, 0, w, h)
    const textured = b.bg.texture === 'paper'
    if (textured) {
      // the paper's tone, in world units (it zooms with the board)
      g.setTransform(k * v.z, 0, 0, k * v.z, -v.x * v.z * k, -v.y * v.z * k)
      const tone = this.paper.toneOf(g, b.bg.color)
      if (tone) {
        g.fillStyle = tone
        g.fillRect(v.x, v.y, w / v.z, h / v.z)
      }
      g.setTransform(k, 0, 0, k, 0, 0)
    }
    drawGrid(g, b.bg, v, w, h)
    g.setTransform(k * v.z, 0, 0, k * v.z, -v.x * v.z * k, -v.y * v.z * k)
    this.drawItems(g, items, v, w, h, hideId, textured ? b.bg.color : undefined)
  }

  /** The items in view (world transform set); `paper` — the textured paper's colour (its tooth cut out of the ink). */
  drawItems(g: CanvasRenderingContext2D, items: BoardItem[], v: View, w: number, h: number, hideId?: string, paper?: string): void {
    const vx1 = v.x + w / v.z
    const vy1 = v.y + h / v.z
    const inView = (i: BoardItem) => {
      const bx = itemBox(i)
      return !(bx.x1 < v.x || bx.x0 > vx1 || bx.y1 < v.y || bx.y0 > vy1)
    }
    // the pictures first: whatever is drawn goes over them
    for (const i of items) if (i.type === 'image' && inView(i)) this.drawImage(g, i)
    const tooth = paper ? this.paper.toothOf(g, paper) : undefined
    // the ink drawn since the last text / shape: laid down (with the tooth cut out) before the next one
    let lg: CanvasRenderingContext2D | undefined
    const flush = () => {
      if (!lg || !tooth) return
      lg.save()
      lg.globalCompositeOperation = 'destination-out'
      lg.globalAlpha = TOOTH
      lg.fillStyle = tooth
      lg.fillRect(v.x, v.y, w / v.z, h / v.z)
      lg.restore()
      g.save()
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.globalAlpha = 1
      g.drawImage(lg.canvas, 0, 0)
      g.restore()
      lg = undefined
    }
    for (const i of items) {
      if (i.id === hideId || i.type === 'image' || !inView(i)) continue
      switch (i.type) {
        case 'text':
          flush()
          this.drawText(g, i)
          break
        case 'shape':
          flush()
          this.drawShape(g, i)
          break
        case 'ink': {
          const t = tooth && !i.marker ? (lg ??= this.paper.layerFor(g)) : g
          this.drawInk(t, i)
          break
        }
      }
    }
    flush()
    g.globalAlpha = 1
  }

  /** A shape: its outline (dashed or not), its fill, its inner strokes and arrow heads. */
  drawShape(g: CanvasRenderingContext2D, i: ShapeItem): void {
    g.save()
    if (isLineKind(i.kind)) g.translate(i.x, i.y)
    else {
      g.translate(i.x + i.w / 2, i.y + i.h / 2)
      if (i.rot) g.rotate((i.rot * Math.PI) / 180)
      g.translate(-i.w / 2, -i.h / 2)
    }
    const s = shapeD(i.kind, i.w, i.h, i.width)
    g.globalAlpha = 1
    g.lineWidth = i.width
    g.lineJoin = 'round'
    g.lineCap = 'round'
    g.strokeStyle = i.color
    if (i.dash) g.setLineDash([i.width * 4, i.width * 3])
    const body = new Path2D(s.d)
    if (i.fill && s.fillable) {
      g.fillStyle = i.fill
      g.fill(body)
    }
    g.stroke(body)
    if (s.extra) g.stroke(new Path2D(s.extra))
    g.setLineDash([])
    if (s.head) g.stroke(new Path2D(s.head))
    g.restore()
  }

  private drawText(g: CanvasRenderingContext2D, i: TextItem): void {
    g.save()
    g.globalAlpha = 1
    g.fillStyle = i.color
    g.font = `${i.size}px ${FONT}`
    g.textBaseline = 'top'
    g.translate(i.x, i.y)
    if (i.rot) g.rotate((i.rot * Math.PI) / 180)
    i.text.split('\n').forEach((l, n) => g.fillText(l, 0, n * i.size * LINE + i.size * 0.1))
    g.restore()
  }

  private drawInk(t: CanvasRenderingContext2D, i: InkItem): void {
    t.globalAlpha = i.opacity
    if (i.gradient) {
      if (i.nib !== undefined) drawNibGradient(t, inkPoints(i), i, i.nib, i.gradient, true)
      else drawGradientStroke(t, inkPoints(i), i, i.gradient, true)
    } else {
      t.fillStyle = i.color
      t.fill(this.pathOf(i))
    }
    t.globalAlpha = 1
  }

  private pathOf(i: InkItem): Path2D {
    let p = this.paths.get(i)
    if (!p) {
      const pts = inkPoints(i)
      p = i.nib !== undefined ? nibPath(pts, i, i.nib, true) : strokePath(pts, i, i.pen, true)
      this.paths.set(i, p)
    }
    return p
  }

  /** A picture: loaded — drawn; loading — a light box; the file gone — a crossed one. */
  private drawImage(g: CanvasRenderingContext2D, i: ImageItem): void {
    const p = this.pictures.get(i.src)
    g.save()
    g.translate(i.x + i.w / 2, i.y + i.h / 2)
    if (i.rot) g.rotate((i.rot * Math.PI) / 180)
    g.translate(-i.w / 2, -i.h / 2)
    g.globalAlpha = 1
    if (p.img) {
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.drawImage(p.img, 0, 0, i.w, i.h)
    } else {
      const lw = Math.max(i.w, i.h) / 240
      g.fillStyle = cssColor('--board-picture-wait-fill')
      g.fillRect(0, 0, i.w, i.h)
      g.strokeStyle = cssColor('--board-picture-wait-line')
      g.lineWidth = lw
      g.setLineDash([lw * 4, lw * 3])
      g.strokeRect(0, 0, i.w, i.h)
      g.setLineDash([])
      if (p.failed) {
        g.beginPath()
        g.moveTo(0, 0)
        g.lineTo(i.w, i.h)
        g.moveTo(i.w, 0)
        g.lineTo(0, i.h)
        g.stroke()
      }
    }
    g.restore()
  }
}
