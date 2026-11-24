import type { Ms } from '../types'

/** A visible time window [from, to]. */
export type TimeWindow = [Ms, Ms]

/** Keeps a window inside bounds: span at least minSpan and at most the bounds, start moved in. */
export function clampWindow([a, b]: TimeWindow, [lo, hi]: TimeWindow, minSpan: number): TimeWindow {
  const span = Math.min(Math.max(b - a, minSpan), hi - lo)
  const start = Math.min(Math.max(a, lo), hi - span)
  return [start, start + span]
}

/**
 * The bounds moved (another day): the window keeps its offset from the bounds' start and its span,
 * so the same hours at the same scale are shown on the new day.
 */
export function rebaseWindow([a, b]: TimeWindow, oldBounds: TimeWindow, newBounds: TimeWindow, minSpan: number): TimeWindow {
  const delta = newBounds[0] - oldBounds[0]
  return clampWindow([a + delta, b + delta], newBounds, minSpan)
}
