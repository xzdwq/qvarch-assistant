import { itemId, snapStroke, type InkItem } from '@shared/whiteboard'
import { recognize } from '@shared/shapeRecognize'
import { penNow } from '../../../lib/tablet'
import type { BoardCtx } from '../boardContext'
import type { StrokeStyle } from '../scene'
import { coalesced, commitPreview, type Gesture, type PointerAt } from './gesture'

/** How long the pen rests at a stroke's end before the stroke becomes the shape it means (ms). */
const HOLD_MS = 500
/** A move farther than this (screen px) starts the wait again. */
const HOLD_SLOP_PX = 4
/** A move farther than this from where the shape came (screen px) gives the stroke back as drawn. */
const UNSNAP_PX = 10
/** How long the snapped shape's name is shown (ms). */
const SNAP_HINT_MS = 1100

/** The pressure of a pointer event: the tablet run by Qvarch, else a real pen's, else an even one. */
function pressureOf(e: PointerEvent): number {
  const p = penNow()
  return p ? Math.max(0.02, p.pressure) : e.pointerType === 'pen' ? e.pressure : 0.5
}

/**
 * A stroke of the pen / nib / marker. Alt held — a straight line from where Alt was pressed. Held still at its
 * end (with "snap shapes" on) — it becomes the shape it means; moved on — it goes on as drawn.
 */
export class InkGesture implements Gesture {
  readonly kind = 'ink'
  /** Alt held while drawing: the line goes straight from this point. */
  private altFrom: number | undefined
  private holdTimer: ReturnType<typeof setTimeout> | undefined
  /** Where the pointer rests (screen). */
  private holdAt: [number, number] | undefined

  constructor(
    private readonly b: BoardCtx,
    at: PointerAt,
    e: PointerEvent,
    style: StrokeStyle,
  ) {
    const pen = style.marker ? true : !!penNow() || e.pointerType === 'pen'
    b.scene.live = { pts: [[at.wx, at.wy, style.marker ? 0.5 : pressureOf(e)]], style, pen }
    b.scene.snapped = undefined
    this.holdStart(at.sx, at.sy)
    b.frames.paintLive()
  }

  move(e: PointerEvent, at: PointerAt): void {
    const { scene } = this.b
    const live = scene.live
    if (!live) return
    if (scene.snapped) {
      // resting on the shape; a real move — back to the stroke as drawn
      if (Math.hypot(at.sx - scene.snapped.at[0], at.sy - scene.snapped.at[1]) < UNSNAP_PX) return
      this.unsnap()
    }
    if (!this.holdAt || Math.hypot(at.sx - this.holdAt[0], at.sy - this.holdAt[1]) > HOLD_SLOP_PX) this.holdStart(at.sx, at.sy)
    if (e.altKey) this.straightTo(e, at)
    else {
      this.altFrom = undefined
      for (const ev of coalesced(e)) {
        const [px, py] = this.b.viewport.toWorld(...this.b.local(ev))
        live.pts.push([px, py, live.style.marker ? 0.5 : pressureOf(ev)])
      }
    }
    this.b.frames.scheduleLive()
  }

  up(): void {
    this.holdStop()
    const { scene, doc } = this.b
    const snappedShape = scene.snapped?.shape
    if (snappedShape) {
      scene.snapped = undefined
      scene.drawing = undefined
      scene.live = undefined
      return doc.addItems([snappedShape])
    }
    const live = scene.live
    if (!live) return commitPreview(this.b)
    const s = live.style
    const item: InkItem = {
      id: itemId(),
      type: 'ink',
      marker: s.marker || undefined,
      pts: live.pts.flat(),
      color: s.color,
      size: s.size,
      opacity: s.opacity,
      streamline: s.streamline,
      smoothing: s.smoothing,
      thinning: s.thinning,
      pen: live.pen,
      // straightened pieces: sharp corners, an even width
      ...(scene.snapped ? { pen: true, streamline: 0, smoothing: 0 } : {}),
      ...(s.gradient ? { gradient: s.gradient } : {}),
      ...(s.nib !== undefined ? { nib: s.nib } : {}),
    }
    scene.live = undefined
    scene.snapped = undefined
    doc.addItems([item])
  }

  dispose(): void {
    this.holdStop()
  }

  /** Alt held: a straight line from where Alt was pressed to the pointer (the brush's own width / pressure). */
  private straightTo(e: PointerEvent, at: PointerAt): void {
    const live = this.b.scene.live!
    this.altFrom ??= live.pts.length - 1
    const a = live.pts[this.altFrom]
    const { wx: px, wy: py } = at
    const p = live.style.marker ? 0.5 : pressureOf(e)
    live.pts.length = this.altFrom + 1
    const n = Math.max(1, Math.ceil(Math.hypot(px - a[0], py - a[1]) / (2 / this.b.viewport.zoom())))
    for (let k = 1; k <= n; k++) live.pts.push([a[0] + ((px - a[0]) * k) / n, a[1] + ((py - a[1]) * k) / n, a[2] + ((p - a[2]) * k) / n])
  }

  private holdStart(sx: number, sy: number): void {
    clearTimeout(this.holdTimer)
    this.holdAt = [sx, sy]
    if (this.b.tools.tp.value.snapShapes) this.holdTimer = setTimeout(() => this.trySnap(), HOLD_MS)
  }

  private holdStop(): void {
    clearTimeout(this.holdTimer)
    this.holdTimer = undefined
    this.holdAt = undefined
  }

  /** The pen rested: the stroke recognized becomes a shape (drawn instead of it) or straight pieces. */
  private trySnap(): void {
    const { scene, viewport, hint, frames } = this.b
    const live = scene.live
    if (!live || scene.snapped || this.altFrom !== undefined) return
    const z = viewport.zoom()
    const rec = recognize(live.pts.map((p) => [p[0], p[1]]), 14 / z)
    if (!rec) return
    const orig = live.pts
    const at = this.holdAt ?? [0, 0]
    const snap = snapStroke(rec, orig, live.style, 2 / z)
    if ('shape' in snap) {
      scene.snapped = { shape: snap.shape, orig, at }
      scene.drawing = snap.shape
    } else {
      scene.snapped = { orig, at }
      live.pts = snap.pts
    }
    hint.flash(snap.hint, SNAP_HINT_MS)
    frames.paintLive()
  }

  /** Moved on after the shape came: the stroke goes on as drawn. */
  private unsnap(): void {
    const { scene, hint } = this.b
    if (!scene.snapped || !scene.live) return
    scene.live.pts = scene.snapped.orig
    scene.drawing = undefined
    scene.snapped = undefined
    hint.hide()
  }
}
