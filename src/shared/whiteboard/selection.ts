import type { Box } from './model'

/** The selection's frame handles: four corners (scale) and a knob above (turn). */
export type Handle = 'tl' | 'tr' | 'bl' | 'br' | 'rot'

/** How far above the frame the turning knob sits (screen px). */
export const ROT_OFF = 26
/** How near (screen px) a handle is caught. */
const HANDLE_REACH = 8

type ToScreen = (wx: number, wy: number) => readonly [number, number]

/** The handles of a frame (world) on the screen. */
export function handlesOf(b: Box, toScreen: ToScreen): Array<{ h: Handle; x: number; y: number }> {
  const [x0, y0] = toScreen(b.x0, b.y0)
  const [x1, y1] = toScreen(b.x1, b.y1)
  return [
    { h: 'tl', x: x0, y: y0 },
    { h: 'tr', x: x1, y: y0 },
    { h: 'bl', x: x0, y: y1 },
    { h: 'br', x: x1, y: y1 },
    { h: 'rot', x: (x0 + x1) / 2, y: y0 - ROT_OFF },
  ]
}

/** The handle under a screen point. */
export const handleAt = (b: Box, toScreen: ToScreen, sx: number, sy: number): Handle | undefined =>
  handlesOf(b, toScreen).find((p) => Math.hypot(p.x - sx, p.y - sy) <= HANDLE_REACH)?.h

/** Is a world point inside a box (its edges too)? */
export const inBox = (b: Box, wx: number, wy: number) => wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1

/** The corner that stays while a corner handle scales the frame: the opposite one. */
export function scaleAnchor(h: Exclude<Handle, 'rot'>, b: Box): [number, number] {
  return [h === 'tl' || h === 'bl' ? b.x1 : b.x0, h === 'tl' || h === 'tr' ? b.y1 : b.y0]
}

/** The cursor over each handle. */
export const HANDLE_CURSORS: Record<Handle, string> = { rot: 'grab', tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize' }

/** The selection tool's cursor: over a handle — its own; inside the selection — move; else the arrow. */
export function selectionCursor(handle: Handle | undefined, insideSelection: boolean): string {
  if (handle) return HANDLE_CURSORS[handle]
  return insideSelection ? 'move' : 'default'
}
