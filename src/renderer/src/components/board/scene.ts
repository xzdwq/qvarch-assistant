import { markRaw, ref, type Ref } from 'vue'
import type { Affine, BoardItem, Box, ShapeItem } from '@shared/whiteboard'
import type { InkStyle } from '../../lib/ink'

/** The ink style of a stroke being drawn (what the tool and the tablet give at the press). */
export type StrokeStyle = InkStyle & { opacity: number; marker: boolean; gradient?: string; nib?: number }

/** The stroke being drawn: its points (world x, y, pressure), its style, real pressure or not. */
export interface LiveStroke {
  pts: number[][]
  style: StrokeStyle
  pen: boolean
}

/** A stroke held still became a shape (drawn instead of it) or straight pieces; the drawn points kept to go back. */
export interface SnappedStroke {
  shape?: ShapeItem
  orig: number[][]
  /** Where the pointer rested (screen). */
  at: [number, number]
}

/**
 * What is in progress on the sheet: read by the painter every frame, written by the gestures. Plain (not
 * reactive) fields — a stroke changes every pointer event; only what the template shows is a ref.
 */
export interface BoardScene {
  /** The items while something is being done to them (the eraser, a move…) — committed on release. */
  preview?: BoardItem[]
  live?: LiveStroke
  /** The shape being drawn (the shape tool, a snapped stroke). */
  drawing?: ShapeItem
  snapped?: SnappedStroke
  /** The selection frame being dragged (world). */
  frameRect?: Box
  /** The selection being turned: its map and its frame before the turn (the frame is drawn turned). */
  turning?: { xf: Affine; box: Box }
  /** The pointer over the sheet (screen). */
  hover?: [number, number]
  /** The view being dragged (the cursor grabs). */
  panning: Ref<boolean>
  /** Space held: the pointer pans. */
  space: Ref<boolean>
  /** The selection tool's cursor: what the pointer is over (a handle, the selection, nothing). */
  selCursor: Ref<string>
}

export function createBoardScene(): BoardScene {
  return markRaw({ panning: ref(false), space: ref(false), selCursor: ref('default') })
}
