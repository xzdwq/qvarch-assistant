import type { Entry } from '../types'

/**
 * A pointer gesture on the calendar strip: pressed and not decided yet, scrolling the days, drawing a new event,
 * moving an event (also to another day), pulling its edge.
 */
export type CalendarGesture =
  | { kind: 'pending'; x0: number; y0: number; day: number; t0: number; s0: number; pid: number }
  | { kind: 'pan'; x0: number; s0: number }
  | { kind: 'create'; day: number; t0: number; t1: number }
  | { kind: 'move'; id: string; from: string; x0: number; y0: number; orig: Entry; moved: boolean; toDay: number; start: number; dayOff: number }
  | { kind: 'resize'; id: string; day: string; edge: 'start' | 'end'; orig: Entry; moved: boolean; start: number; end: number }

/** The snapping step of every drag (ms). */
export const SNAP = 5 * 60_000
export const snapT = (t: number): number => Math.round(t / SNAP) * SNAP

/** A press that went far enough decides: sideways — the days scroll; down / up — a new event on that day. */
export function decidePending(dx: number, dy: number): 'pan' | 'create' | undefined {
  if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return undefined
  return Math.abs(dx) > Math.abs(dy) ? 'pan' : 'create'
}

/** A press on an event this tall at this offset from its top/bottom grabs an edge (else — the whole event). */
export function edgeAt(height: number, fromTop: number, fromBottom: number): 'start' | 'end' | undefined {
  if (height < 22) return undefined
  return fromTop < 5 ? 'start' : fromBottom < 5 ? 'end' : undefined
}
