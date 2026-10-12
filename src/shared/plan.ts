import type { Ms, PlanBlock } from './types'

/** Plans snap to 5 minutes. */
export const PLAN_STEP = 5 * 60_000
export const snapPlan = (t: Ms): Ms => Math.round(t / PLAN_STEP) * PLAN_STEP

/** Rows of the plan lane: overlapping plans stack (first free row, in start order). */
export function planRows(blocks: PlanBlock[]): Map<string, number> {
  const rows: Ms[] = [] // end of the last block per row
  const out = new Map<string, number>()
  for (const b of [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)) {
    let r = rows.findIndex((end) => end <= b.start)
    if (r < 0) r = rows.push(0) - 1
    rows[r] = b.end
    out.set(b.id, r)
  }
  return out
}

/** Planned time that falls into [from, to) — e.g. the official work day. */
export function plannedWithin(blocks: PlanBlock[], from: Ms, to: Ms): Ms {
  return blocks.reduce((a, b) => a + Math.max(0, Math.min(b.end, to) - Math.max(b.start, from)), 0)
}
