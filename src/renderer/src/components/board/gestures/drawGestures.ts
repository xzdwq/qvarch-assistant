import { clickedShape, draftShape, eraseInk, hitsItem, type BoardItem, type TextItem } from '@shared/whiteboard'
import { penNow } from '../../../lib/tablet'
import type { BoardCtx } from '../boardContext'
import { LINE } from '../textMeasure'
import { coalesced, commitPreview, type Gesture, type PointerAt } from './gesture'

/** How far (screen px) a text must be dragged to move rather than open for editing. */
const TEXT_DRAG_PX = 4

/** The eraser pressed: what it touches goes (a preview, committed on release). */
export function startErase(b: BoardCtx, at: PointerAt): Gesture {
  b.scene.preview = b.doc.board.value.items
  eraseAt(b, at.sx, at.sy)
  return {
    kind: 'erase',
    move(e) {
      for (const ev of coalesced(e)) eraseAt(b, ...b.local(ev))
    },
    up: () => commitPreview(b),
  }
}

/** The eraser at a screen point: cuts the lines it touches (or takes them whole), takes texts / shapes it touches. */
function eraseAt(b: BoardCtx, sx: number, sy: number): void {
  const items = b.scene.preview
  if (!items) return
  const tp = b.tools.tp.value
  const [wx, wy] = b.viewport.toWorld(sx, sy)
  // with "by pressure" the eraser grows with the pen's pressure
  const pen = tp.eraserPressure ? penNow() : undefined
  const r = (tp.eraserSize / 2 / b.viewport.zoom()) * (pen ? 0.35 + pen.pressure * 1.1 : 1)
  let changed = false
  const out: BoardItem[] = []
  for (const i of items) {
    // a picture is not erased (one erases the ink over it); it goes with Delete
    if (i.type === 'image') {
      out.push(i)
      continue
    }
    if (i.type !== 'ink' || tp.eraseWhole) {
      if (hitsItem(i, wx, wy, r, false)) changed = true
      else out.push(i)
      continue
    }
    const parts = eraseInk(i, wx, wy, r)
    if (parts.length !== 1 || parts[0] !== i) changed = true
    out.push(...parts)
  }
  if (changed) {
    b.scene.preview = out
    b.frames.schedule()
  } else b.frames.paintLive()
}

/** The shape tool pressed: a shape from here to the pointer (Shift — even); a click — one of the usual size. */
export function startShape(b: BoardCtx, at: PointerAt): Gesture {
  const draft = (x: number, y: number, square: boolean) => draftShape(at.wx, at.wy, x, y, square, b.tools.shapeStyle())
  b.scene.drawing = draft(at.wx, at.wy, false)
  b.frames.paintLive()
  return {
    kind: 'shape',
    move(e, p) {
      b.scene.drawing = draft(p.wx, p.wy, e.shiftKey)
      b.frames.paintLive()
    },
    up() {
      const sh = b.scene.drawing
      b.scene.drawing = undefined
      if (!sh) return commitPreview(b)
      b.doc.addItems([clickedShape(sh, b.viewport.zoom())])
    },
  }
}

/** The text tool pressed: on a text — drag it, or (a click) edit it; elsewhere — a new text, its first line centred there. */
export function startTextTool(b: BoardCtx, at: PointerAt): Gesture | undefined {
  const hit = b.text.textAt(at.wx, at.wy)
  if (!hit) {
    void b.text.start(at.wx, at.wy - (b.tools.tp.value.textSize * LINE) / 2)
    return undefined
  }
  return startTextDrag(b, at, hit)
}

function startTextDrag(b: BoardCtx, at: PointerAt, item: TextItem): Gesture {
  let moved = false
  return {
    kind: 'text',
    move(_e, p) {
      if (!moved && Math.hypot(p.sx - at.sx, p.sy - at.sy) < TEXT_DRAG_PX) return
      moved = true
      const z = b.viewport.zoom()
      const next: TextItem = { ...item, x: item.x + (p.sx - at.sx) / z, y: item.y + (p.sy - at.sy) / z }
      b.scene.preview = b.doc.board.value.items.map((i) => (i.id === item.id ? next : i))
      b.frames.schedule()
    },
    up() {
      if (moved) return commitPreview(b)
      b.scene.preview = undefined
      void b.text.start(item.x, item.y, item)
    },
  }
}
