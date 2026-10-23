import type { Affine } from '@shared/whiteboard'
import { transformItem } from '@shared/whiteboard'
import type { BoardCtx } from '../boardContext'

/** A pointer's place: on the sheet (screen px) and on the board (world). */
export interface PointerAt {
  sx: number
  sy: number
  wx: number
  wy: number
}

export type GestureKind = 'pan' | 'ink' | 'erase' | 'shape' | 'text' | 'move' | 'scale' | 'rotate' | 'frame'

/** What a press on the sheet started — it follows the pointer until the release. */
export interface Gesture {
  readonly kind: GestureKind
  /** The pointer moved while pressed. */
  move(e: PointerEvent, at: PointerAt): void
  /** The pointer released (or the press cancelled): the result committed. */
  up(): void
  /** The board goes away mid-gesture: its timers stopped. */
  dispose?(): void
}

/** The preview (items being changed) committed — or, nothing changed, the board repainted. */
export function commitPreview(b: BoardCtx): void {
  const next = b.scene.preview
  b.scene.preview = undefined
  if (next && next !== b.doc.board.value.items) b.doc.commit({ ...b.doc.board.value, items: next })
  else b.frames.schedule()
}

/** The selection changed by a map, as a preview (committed on release). */
export function previewSelection(b: BoardCtx, m: Affine): void {
  const sel = b.doc.sel.value
  b.scene.preview = b.doc.board.value.items.map((i) => (sel.has(i.id) ? transformItem(i, m) : i))
  b.frames.schedule()
}

/** The view dragged (the hand, Space, the middle / right button). */
export function startPan(b: BoardCtx, at: PointerAt): Gesture {
  const v0 = b.viewport.view.value!
  b.scene.panning.value = true
  return {
    kind: 'pan',
    move(_e, p) {
      const z = b.viewport.zoom()
      b.viewport.view.value = { x: v0.x - (p.sx - at.sx) / z, y: v0.y - (p.sy - at.sy) / z, z }
    },
    up: () => commitPreview(b),
  }
}

/** The pointer's coalesced events (all the points it passed since the last event), or the event itself. */
export const coalesced = (e: PointerEvent): PointerEvent[] =>
  typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length ? e.getCoalescedEvents() : [e]
