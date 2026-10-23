import { computed, ref } from 'vue'
import { MINUTE } from '@shared/timeline'
import type { DayData, Ms, Selection } from '@shared/types'
import { pctOf, segBox, snap, useViewport } from '../../lib/viewport'
import type { DaySchedule } from '@shared/tracker/timelineAxis'

/** What the scale reads from the timeline's props. */
export interface TimelineScaleProps {
  data: DayData
  now?: Ms
  schedule: DaySchedule
  bounds: [Ms, Ms]
  initial: [Ms, Ms]
  selection: Selection | null
}

/**
 * The timeline's time ↔ pixel mapping: the visible window (pan / zoom), the canvas and its width,
 * pointer → time with snapping to block edges, calls, now and the schedule; the selection's live end.
 */
export function useTimelineScale(props: TimelineScaleProps) {
  const vp = useViewport({ bounds: () => props.bounds, initial: () => props.initial })
  const from = vp.from
  const to = vp.to
  const canvas = ref<HTMLElement>()
  /** The canvas width in px (refreshed on every pointer → time conversion). */
  const width = ref(1000)
  const box = (a: Ms, b: Ms, gap = 1) => segBox(a, b, from.value, to.value, gap)
  const pct = (t: Ms) => pctOf(t, from.value, to.value)
  /** The last moment with something in it: now (today) or the latest block's end. */
  const limit = computed(() => props.now ?? Math.max(props.bounds[0], ...props.data.entries.map((e) => e.end)))
  /** The selection's end; an open one follows now. */
  const selEnd = computed(() => (props.selection ? (props.selection.end ?? props.now ?? limit.value) : 0))

  /** Time under a screen x, unsnapped. */
  function rawTimeAt(clientX: number): Ms {
    const r = canvas.value!.getBoundingClientRect()
    width.value = r.width
    return from.value + ((clientX - r.left) / r.width) * (to.value - from.value)
  }

  /** Moments a pointer sticks to: block edges, calls, now, the schedule. */
  const snapPoints = computed(() => {
    const pts: Ms[] = []
    for (const e of props.data.entries) pts.push(e.start, e.end)
    for (const c of props.data.calls) pts.push(c.start, c.end)
    if (props.now) pts.push(props.now)
    if (props.schedule.work) pts.push(...props.schedule.work)
    if (props.schedule.lunch) pts.push(...props.schedule.lunch)
    return pts
  })

  /** Time under a screen x, snapped and kept inside the day (planned blocks may lie ahead). */
  function timeAt(clientX: number, snapIt = true): Ms {
    const t = rawTimeAt(clientX)
    const v = snapIt ? snap(t, snapPoints.value, (to.value - from.value) / width.value) : t
    return Math.max(props.bounds[0], Math.min(v, props.bounds[1]))
  }

  /** A selection [start, end]; an end right at now keeps following it. */
  function makeSel(start: Ms, end: Ms): Selection {
    const followNow = !!props.now && Math.abs(props.now - end) < MINUTE
    return { day: props.data.day, start, end: followNow ? undefined : end }
  }

  return { vp, from, to, canvas, width, box, pct, limit, selEnd, rawTimeAt, snapPoints, timeAt, makeSel }
}

export type TimelineScale = ReturnType<typeof useTimelineScale>
