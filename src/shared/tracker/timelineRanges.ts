import type { Ms } from '../types'

type Span = { start: Ms; end: Ms }

/**
 * The free stretch around a moment: from the block before it to the block after it (or `lo` / `hi`).
 * Inside a block there is no gap: an empty range at the moment.
 */
export function gapAround(blocks: Span[], t: Ms, lo: Ms, hi: Ms): Span {
  let start = lo
  let end = hi
  for (const e of blocks) {
    if (e.end <= t && e.end > start) start = e.end
    if (e.start >= t && e.start < end) end = e.start
    if (e.start < t && e.end > t) return { start: t, end: t }
  }
  return { start, end: Math.max(start, end) }
}

/** Blocks scrolled / zoomed out of view, per side: their counts, the earliest start left, the latest end right. */
export interface HiddenSides {
  left: number
  right: number
  first: Ms
  last: Ms
}

/** Counts the blocks wholly before / after the window [from, to]. */
export function hiddenSides(blocks: Span[], from: Ms, to: Ms): HiddenSides {
  const left = blocks.filter((e) => e.end <= from)
  const right = blocks.filter((e) => e.start >= to)
  return {
    left: left.length,
    right: right.length,
    first: left.length ? Math.min(...left.map((e) => e.start)) : 0,
    last: right.length ? Math.max(...right.map((e) => e.end)) : 0,
  }
}

/** The lane row under a vertical offset (px from the first lane's top), capped at `maxLane` (the empty lane). */
export function laneAtOffset(y: number, laneH: number, gap: number, maxLane: number): number {
  return Math.max(0, Math.min(Math.floor(y / (laneH + gap)), maxLane))
}
