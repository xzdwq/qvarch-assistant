import { computed, ref, watch } from 'vue'
import { ISLAND_PANEL_WIDTH } from '@shared/island'
import { visibleNotes } from '@shared/notes'
import { dayEnd, dayStart, flattenForDisplay, formatHM, HOUR, MINUTE } from '@shared/timeline'
import { islandAxis } from '@shared/tracker/islandAxis'
import { hiddenSides } from '@shared/tracker/timelineRanges'
import type { Ms } from '@shared/types'
import { kindLabel } from '../lib/palette'
import { clusterize, useFan } from '../lib/pinfan'
import { pctOf, segBox, ticks, useViewport, visible } from '../lib/viewport'
import type { IslandDay } from './useIslandDay'

/** Track width in px (panel minus paddings) — decides whether icons/labels fit into a block. */
export const TRACK_W = ISLAND_PANEL_WIDTH - 32
/** Parallel blocks get their own lanes; the row grows up to 3 lanes, more lanes scroll. */
export const LANE_H = 30
export const LANE_GAP = 3

/** A block being dragged (move / edge / lane change), shown before the saved state comes back. */
export type ResizedEntry = { id: string; start: Ms; end: Ms; lane?: number }

/**
 * The expanded island's timeline as it is drawn: the visible window (zoom / pan), blocks on lanes (with a drag in
 * progress applied), the axis, blocks scrolled out of view per side, note pins fanning out, the hover line's text.
 */
export function useIslandTrack(day: IslandDay) {
  const { today, data, now, schedule } = day

  /** The window first shown: from the first block (or the work start) to just past now (or the work end). */
  const initial = computed<[Ms, Ms]>(() => {
    const starts = data.value.entries.map((e) => e.start)
    const ends = [now.value + 10 * MINUTE]
    if (schedule.value.work) {
      starts.push(schedule.value.work[0])
      ends.push(schedule.value.work[1])
    }
    const a = starts.length ? Math.min(...starts) : now.value - 4 * HOUR
    return [Math.floor(a / HOUR) * HOUR, Math.ceil(Math.max(...ends) / HOUR) * HOUR]
  })
  const vp = useViewport({ bounds: () => [dayStart(today.value), dayEnd(today.value)], initial: () => initial.value, minSpan: 15 * MINUTE })
  const { from, to } = vp
  const box = (a: Ms, b: Ms, gap = 1) => segBox(a, b, from.value, to.value, gap)
  const pct = (t: Ms) => pctOf(t, from.value, to.value)
  /** Width in px of [a, b] on a track of `trackPx` pixels — decides whether an icon fits. */
  const px = (a: Ms, b: Ms, trackPx: number) => ((Math.min(b, to.value) - Math.max(a, from.value)) / (to.value - from.value)) * trackPx

  /** Entries with an in-progress drag (move / edge / lane change) applied. */
  const resized = ref<ResizedEntry>()
  const entries = computed(() => {
    const r = resized.value
    return r ? data.value.entries.map((e) => (e.id === r.id ? { ...e, start: r.start, end: r.end, lane: r.lane ?? e.lane } : e)) : data.value.entries
  })
  // the saved state caught up with the dragged geometry → drop the local preview
  watch(
    () => data.value.entries,
    (list) => {
      const r = resized.value
      if (r && list.some((e) => e.id === r.id && e.start === r.start && e.end === r.end && (r.lane === undefined || e.lane === r.lane))) resized.value = undefined
    },
  )
  /** All segments (not clipped to the view) — lanes are a property of the whole day. */
  const allSegs = computed(() => flattenForDisplay(entries.value, resized.value?.id))
  const segs = computed(() => visible(allSegs.value, from.value, to.value))
  /** Lane each main-line entry is displayed on. */
  const laneOf = (id: string) => allSegs.value.find((x) => x.entry.id === id)?.lane ?? 0

  /** Lanes in use; one more empty lane is always shown below so a block can be dropped there. */
  const totalLanes = computed(() => Math.max(1, ...allSegs.value.map((x) => x.lanes)))
  const shownLanes = computed(() => totalLanes.value + 1)
  const rowStyle = computed(() => ({ height: `${Math.min(shownLanes.value, 3) * (LANE_H + LANE_GAP) - LANE_GAP}px` }))
  const rowInnerStyle = computed(() => ({ height: `${shownLanes.value * (LANE_H + LANE_GAP) - LANE_GAP}px` }))
  function laneStyle(s: { lane: number; lanes: number }): Record<string, string> {
    return { top: `${s.lane * (LANE_H + LANE_GAP)}px`, height: `${LANE_H}px`, bottom: 'auto' }
  }

  /** Axis labels: ticks + official start/lunch/end markers + "Сейчас"; the more important label wins on overlap. */
  const axis = computed(() => islandAxis({ from: from.value, to: to.value, now: now.value, schedule: schedule.value, ticks: ticks(from.value, to.value, 18) }))

  /** Blocks scrolled/zoomed out of view, per side — shown as "<N" / ">N"; a click brings the outermost one back. */
  const hidden = computed(() => hiddenSides(entries.value, from.value, to.value))
  function revealSide(side: 'left' | 'right'): void {
    const pad = (to.value - from.value) * 0.03
    if (side === 'left') vp.panBy(hidden.value.first - pad - from.value)
    else vp.panBy(hidden.value.last + pad - to.value)
  }

  /** Note pins on the expanded timeline. */
  const notePins = computed(() => visibleNotes(data.value.notes).filter((n) => n.at >= from.value && n.at <= to.value))
  /** Notes at (almost) the same moment spread apart on hover. */
  const fan = useFan()
  const pinPlaces = computed(() => clusterize(notePins.value, (n) => (pct(n.at) / 100) * TRACK_W, 13))
  /** Under a fanned-out group: the pointer may cross it without the group folding back. */
  const fanZone = computed(() => {
    const k = fan.open.value
    const n = k ? (pinPlaces.value.get(k)?.n ?? 1) : 1
    const p = k && notePins.value.find((x) => x.id === k)
    return p && n > 1 ? { pct: pct(p.at), width: (n - 1) * 16 + 22 } : undefined
  })

  /** The moment under the pointer and what runs then. */
  const hoverT = ref<Ms>()
  const hoverInfo = computed(() => {
    if (hoverT.value === undefined) return undefined
    const t = hoverT.value
    const at = entries.value.filter((e) => e.start <= t && e.end > t)
    const call = data.value.calls.find((c) => c.start <= t && c.end >= t)
    const parts = [formatHM(t), ...at.map((e) => `${kindLabel(e.kind)}: ${e.label}`)]
    if (call) parts.push(`созвон ${call.app}`)
    return parts.join(' · ')
  })

  return {
    vp,
    from,
    to,
    box,
    pct,
    px,
    resized,
    segs,
    laneOf,
    totalLanes,
    shownLanes,
    rowStyle,
    rowInnerStyle,
    laneStyle,
    axis,
    hidden,
    revealSide,
    notePins,
    fan,
    pinPlaces,
    fanZone,
    hoverT,
    hoverInfo,
  }
}

export type IslandTrack = ReturnType<typeof useIslandTrack>
