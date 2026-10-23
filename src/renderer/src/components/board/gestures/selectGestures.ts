import { boardBox, handleAt, hitsItem, inBox, inFrame, rotateAbout, scaleAbout, scaleAnchor, selectionCursor, translate, type Box } from '@shared/whiteboard'
import type { BoardCtx } from '../boardContext'
import { commitPreview, previewSelection, type Gesture, type PointerAt } from './gesture'

/** How near (screen px) a click catches an item. */
const HIT_REACH = 6

/** The selection's frame (world), from what is shown. */
export function selectionBox(b: BoardCtx): Box | undefined {
  const sel = b.doc.sel.value
  if (!sel.size) return undefined
  return boardBox(b.doc.shown().filter((i) => sel.has(i.id)))
}

/**
 * The selection tool pressed: a handle — scale / turn; inside the selection — move it; on an item — select it
 * (Shift — add / take away) and move; on nothing — a frame (Shift — adds to the selection).
 */
export function startSelect(b: BoardCtx, at: PointerAt, e: PointerEvent): Gesture | undefined {
  const box = selectionBox(b)
  const h = box && handleAt(box, b.viewport.toScreen, at.sx, at.sy)
  if (box && h) return h === 'rot' ? startRotate(b, at, box) : startScale(b, at, scaleAnchor(h, box))
  if (box && !e.shiftKey && inBox(box, at.wx, at.wy)) return startMove(b, at)
  // what is drawn over a picture is hit before the picture
  const top = [...b.doc.board.value.items].reverse()
  const reach = HIT_REACH / b.viewport.zoom()
  const hit = top.find((i) => i.type !== 'image' && hitsItem(i, at.wx, at.wy, reach)) ?? top.find((i) => i.type === 'image' && hitsItem(i, at.wx, at.wy, reach))
  if (hit) {
    const next = new Set(e.shiftKey ? b.doc.sel.value : [])
    if (e.shiftKey && next.has(hit.id)) next.delete(hit.id)
    else next.add(hit.id)
    b.doc.sel.value = next
    b.frames.schedule()
    return e.shiftKey ? undefined : startMove(b, at)
  }
  const gesture = startFrame(b, at, e.shiftKey)
  b.frames.schedule()
  return gesture
}

/** The selection tool's cursor over the sheet: a handle, the selection, or nothing under the pointer. */
export function hoverSelect(b: BoardCtx, at: PointerAt): void {
  const box = selectionBox(b)
  const h = box && handleAt(box, b.viewport.toScreen, at.sx, at.sy)
  b.scene.selCursor.value = selectionCursor(h, !!box && inBox(box, at.wx, at.wy))
}

/** The selection dragged along. */
function startMove(b: BoardCtx, at: PointerAt): Gesture {
  return {
    kind: 'move',
    move: (_e, p) => previewSelection(b, translate(p.wx - at.wx, p.wy - at.wy)),
    up: () => commitPreview(b),
  }
}

/** The selection scaled from a corner, the opposite corner (ax, ay) staying. */
function startScale(b: BoardCtx, at: PointerAt, [ax, ay]: [number, number]): Gesture {
  const d0 = Math.max(1e-6, Math.hypot(at.wx - ax, at.wy - ay))
  return {
    kind: 'scale',
    move: (_e, p) => previewSelection(b, scaleAbout(Math.max(0.05, Math.hypot(p.wx - ax, p.wy - ay) / d0), ax, ay)),
    up: () => commitPreview(b),
  }
}

/** The selection turned around its centre (Shift — by 15°); its frame turns with it. */
function startRotate(b: BoardCtx, at: PointerAt, box: Box): Gesture {
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const a0 = Math.atan2(at.wy - cy, at.wx - cx)
  return {
    kind: 'rotate',
    move(e, p) {
      let deg = ((Math.atan2(p.wy - cy, p.wx - cx) - a0) * 180) / Math.PI
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      const xf = rotateAbout(deg, cx, cy)
      b.scene.turning = { xf, box }
      previewSelection(b, xf)
    },
    up: () => commitPreview(b),
  }
}

/** A frame dragged: what it catches is selected (`add` — on top of what was). */
function startFrame(b: BoardCtx, at: PointerAt, add: boolean): Gesture {
  const base = add ? b.doc.sel.value : new Set<string>()
  if (!add) b.doc.sel.value = new Set()
  return {
    kind: 'frame',
    move(_e, p) {
      const f: Box = { x0: Math.min(at.wx, p.wx), y0: Math.min(at.wy, p.wy), x1: Math.max(at.wx, p.wx), y1: Math.max(at.wy, p.wy) }
      b.scene.frameRect = f
      const next = new Set(base)
      for (const i of b.doc.board.value.items) if (inFrame(i, f)) next.add(i.id)
      b.doc.sel.value = next
      b.frames.schedule()
    },
    up: () => commitPreview(b),
  }
}
