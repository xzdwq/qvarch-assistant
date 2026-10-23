import { computed, ref, useTemplateRef } from 'vue'
import { layoutLanes } from '@shared/timeline'
import type { Entry, Ms } from '@shared/types'

/** A block's geometry as shown right now (a drag preview may override the saved one). */
export type BlockView = { start: Ms; end: Ms; lane?: number }

/** Height of one lane of the «Работа» row, px. */
export const LANE_H = 36
/** Gap between lanes, px. */
export const LANE_GAP = 4
/** Lanes visible at most; more scroll (Ctrl + the wheel). */
export const MAX_LANES = 8

/**
 * The «Работа» row's lanes: parallel blocks get their own lanes, the row grows with them (up to MAX_LANES)
 * plus one empty lane below as a drop target. The dragged block yields its lane to the others.
 */
export function useTimelineLanes(entries: () => Entry[], preview: (e: Entry) => BlockView | Entry, movingId: () => string | undefined) {
  /** Entries as shown right now (drag preview applied). */
  const viewEntries = computed(() =>
    entries().map((e) => {
      const p = preview(e)
      return p === e ? e : { ...e, ...p }
    }),
  )
  const lanes = computed(() => layoutLanes(viewEntries.value, movingId()))
  const laneOf = (id: string) => lanes.value.get(id)?.lane ?? 0
  /** The «Работа» row element (template ref "mainLane"). */
  const mainLane = useTemplateRef<HTMLElement>('mainLane')
  const laneH = computed(() => LANE_H)
  const totalLanes = computed(() => Math.max(1, ...[...lanes.value.values()].map((l) => l.lanes)))
  const shownLanes = computed(() => totalLanes.value + 1)
  const mainH = computed(() => 10 + Math.min(shownLanes.value, MAX_LANES) * (laneH.value + LANE_GAP) - LANE_GAP)
  const mainInnerH = computed(() => 10 + shownLanes.value * (laneH.value + LANE_GAP) - LANE_GAP)
  /** More lanes than fit: the row's scroll and how many lanes are out of sight below / above. */
  const laneScroll = ref(0)
  const hiddenBelow = computed(() => Math.max(0, Math.ceil((mainInnerH.value - mainH.value - laneScroll.value) / (laneH.value + LANE_GAP))))
  const hiddenAbove = computed(() => Math.floor(laneScroll.value / (laneH.value + LANE_GAP)))

  /** Vertical placement of a block on its lane. */
  function laneStyle(e: Entry): Record<string, string> {
    const l = lanes.value.get(e.id)
    return { top: `${5 + (l?.lane ?? 0) * (laneH.value + LANE_GAP)}px`, bottom: 'auto', height: `${laneH.value}px` }
  }

  /** Ctrl + the wheel over the row with more lanes than fit scrolls them; true when it did. */
  function scrollLanes(e: WheelEvent): boolean {
    const ml = mainLane.value
    if (!e.ctrlKey || !ml || !ml.contains(e.target as Node) || ml.scrollHeight <= ml.clientHeight + 1) return false
    ml.scrollTop += e.deltaY
    laneScroll.value = ml.scrollTop
    return true
  }

  return { lanes, laneOf, mainLane, laneH, totalLanes, shownLanes, mainH, mainInnerH, laneScroll, hiddenBelow, hiddenAbove, laneStyle, scrollLanes }
}

export type TimelineLanes = ReturnType<typeof useTimelineLanes>
