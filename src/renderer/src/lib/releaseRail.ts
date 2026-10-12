import type { CommitInfo, PlanItem } from '@shared/release'

/**
 * The branch rail left of the release chronology (ported from the VS Code panel): lane 0 is the dev trunk;
 * every selected branch gets a lane from its first commit to its merge back into dev (or the bottom edge when
 * not merged yet — a dashed tail). Lanes are reused once a branch has merged (greedy interval packing).
 */
export type Row =
  | { kind: 'item'; date: string; item: PlanItem }
  | { kind: 'context' | 'anchor'; date: string; commit: CommitInfo }
  | { kind: 'mergeMarker'; date: string; branch: string; commit: CommitInfo & { prUrl?: string | null; prNumber?: number | null } }

interface Range {
  start: number | null
  end: number | null
  mergedAtRow: number | null
  intermediateMergeRows: number[]
  absorbedAtRow: number | null
}
export interface Rail {
  laneOf: Map<string, number>
  ranges: Map<string, Range>
}

export function computeRail(merged: Row[], absorbed: string[]): Rail {
  const absorbedBranches = new Set(absorbed)
  const branchOrder: string[] = []
  const seen = new Set<string>()
  merged.forEach((row) => {
    if (row.kind === 'item' && !seen.has(row.item.branch)) {
      seen.add(row.item.branch)
      branchOrder.push(row.item.branch)
    }
  })
  const mergeRowsByBranch = new Map<string, number[]>()
  merged.forEach((row, idx) => {
    if (row.kind !== 'mergeMarker' || !seen.has(row.branch)) return
    if (!mergeRowsByBranch.has(row.branch)) mergeRowsByBranch.set(row.branch, [])
    mergeRowsByBranch.get(row.branch)!.push(idx)
  })
  const ranges = new Map<string, Range>()
  for (const branch of branchOrder) {
    let start: number | null = null
    let lastOwnRow: number | null = null
    merged.forEach((row, idx) => {
      if (row.kind === 'item' && row.item.branch === branch) {
        if (start === null) start = idx
        lastOwnRow = idx
      }
    })
    const mergeRows = mergeRowsByBranch.get(branch) ?? []
    // only a merge not earlier than the branch's last own commit closes its lane
    const mergedAtRow = mergeRows.find((idx) => lastOwnRow !== null && idx >= lastOwnRow) ?? null
    const intermediateMergeRows = mergeRows.filter((idx) => idx !== mergedAtRow)
    const absorbedAtRow = mergedAtRow === null && absorbedBranches.has(branch) ? lastOwnRow : null
    ranges.set(branch, { start, end: lastOwnRow, mergedAtRow, intermediateMergeRows, absorbedAtRow })
  }
  const total = merged.length
  const closeRowOf = (b: string) => {
    const r = ranges.get(b)!
    return r.mergedAtRow ?? r.absorbedAtRow ?? total - 1
  }
  const byStart = [...branchOrder].sort((a, b) => (ranges.get(a)!.start ?? 0) - (ranges.get(b)!.start ?? 0))
  const laneOf = new Map<string, number>()
  const laneClosedAt: number[] = []
  for (const branch of byStart) {
    const start = ranges.get(branch)!.start ?? 0
    let lane = laneClosedAt.findIndex((closedAt) => closedAt < start)
    if (lane === -1) {
      lane = laneClosedAt.length
      laneClosedAt.push(-1)
    }
    laneClosedAt[lane] = closeRowOf(branch)
    laneOf.set(branch, lane + 1)
  }
  return { laneOf, ranges }
}

export const LANE_W = 16
const DOT_R = 4
export const laneX = (lane: number) => lane * LANE_W + LANE_W / 2
export function railWidth(rail: Rail): number {
  let max = 0
  for (const l of rail.laneOf.values()) max = Math.max(max, l)
  return (max + 1) * LANE_W
}
const curve = (x0: number, y0: number, x1: number, y1: number) => {
  const ym = (y0 + y1) / 2
  return `M ${x0},${y0} C ${x0},${ym} ${x1},${ym} ${x1},${y1}`
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
function dot(x: number, y: number, color: string, branch: string | null): string {
  const data = branch ? ` data-branch="${esc(branch)}"` : ''
  return `<circle cx="${x}" cy="${y}" r="${DOT_R + 2}" class="rh"${data} /><circle cx="${x}" cy="${y}" r="${DOT_R}" fill="${color}"${data} />`
}

/** The SVG inside: lines first, then the dots over them. */
export function drawRail(rail: Rail, merged: Row[], centers: number[], height: number, colorFor: (b: string) => string, trunk = '#6b7387'): string {
  const total = merged.length
  if (!total) return ''
  const tx = laneX(0)
  const lastY = centers[total - 1]
  const lines: string[] = []
  const dots: string[] = []
  lines.push(`<path d="M ${tx},-2 L ${tx},${centers[0]}" stroke="${trunk}" stroke-dasharray="3 3" class="rl" />`)
  lines.push(`<path d="M ${tx},${centers[0]} L ${tx},${lastY}" stroke="${trunk}" class="rl" />`)
  const offAnchor = new Map<number, string>()
  for (const [b, r] of rail.ranges) if (r.start !== null && r.start > 0) offAnchor.set(r.start - 1, b)
  merged.forEach((row, idx) => {
    let color = trunk
    let dotBranch: string | null = null
    for (const [b, r] of rail.ranges)
      if (r.mergedAtRow === idx || r.intermediateMergeRows.includes(idx)) {
        color = colorFor(b)
        dotBranch = b
        break
      }
    if (!dotBranch && offAnchor.has(idx)) dotBranch = offAnchor.get(idx)!
    if (row.kind === 'item' && !dotBranch) return
    dots.push(dot(tx, centers[idx], color, dotBranch))
  })
  for (const [b, lane] of [...rail.laneOf].sort((a, c) => a[1] - c[1])) {
    const r = rail.ranges.get(b)!
    if (r.start === null) continue
    const x = laneX(lane)
    const color = colorFor(b)
    const data = ` data-branch="${esc(b)}"`
    const merged_ = r.mergedAtRow !== null
    const absorbed = !merged_ && r.absorbedAtRow !== null
    const vertEnd = merged_ ? Math.max(r.start, r.mergedAtRow! - 1) : absorbed ? r.absorbedAtRow! : total - 1
    if (r.start > 0) lines.push(`<path d="${curve(tx, centers[r.start - 1], x, centers[r.start])}" stroke="${trunk}" class="rl"${data} />`)
    else lines.push(`<path d="M ${x},-2 L ${x},${centers[r.start]}" stroke="${color}" stroke-dasharray="3 3" class="rl"${data} />`)
    if (vertEnd > r.start) lines.push(`<path d="M ${x},${centers[r.start]} L ${x},${centers[vertEnd]}" stroke="${color}" class="rl"${data} />`)
    for (const mi of r.intermediateMergeRows) {
      const from = Math.max(r.start, mi - 1)
      if (from !== mi) lines.push(`<path d="${curve(x, centers[from], tx, centers[mi])}" stroke="${color}" class="rl"${data} />`)
    }
    if (merged_) lines.push(`<path d="${curve(x, centers[vertEnd], tx, centers[r.mergedAtRow!])}" stroke="${color}" class="rl"${data} />`)
    else if (absorbed) {
      const ai = r.absorbedAtRow!
      const gap = centers[ai] - centers[Math.max(0, ai - 1)]
      const endY = ai + 1 < total ? centers[ai + 1] : centers[ai] + (gap || 24)
      lines.push(`<path d="${curve(x, centers[ai], tx, endY)}" stroke="${color}" class="rl"${data} />`)
    } else lines.push(`<path d="M ${x},${lastY} L ${x},${height + 4}" stroke="${color}" stroke-dasharray="3 3" class="rl"${data} />`)
    merged.forEach((row, idx) => {
      if (row.kind === 'item' && row.item.branch === b) dots.push(dot(x, centers[idx], color, b))
    })
  }
  return lines.join('') + dots.join('')
}

/** Colours given in order of first use, a golden-angle step apart — neighbours look different. */
export function makeColors(): { colorFor: (name: string) => string; reset: () => void } {
  const assigned = new Map<string, number>()
  let next = 0
  return {
    colorFor(name: string) {
      if (!assigned.has(name)) assigned.set(name, next++)
      return `hsl(${((assigned.get(name)! * 137.508) % 360).toFixed(1)}, 68%, 60%)`
    },
    reset() {
      assigned.clear()
      next = 0
    },
  }
}
