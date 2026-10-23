import { computed, ref, watch } from 'vue'
import { laneIsFree, MINUTE } from '@shared/timeline'
import type { DayData, Entry, Ms, Selection } from '@shared/types'
import { snap } from '../../lib/viewport'
import { laneAtOffset } from '@shared/tracker/timelineRanges'
import { LANE_GAP, useTimelineLanes, type BlockView } from './useTimelineLanes'
import type { TimelineScale } from './useTimelineScale'

/** What the pointer handling reads from the timeline's props. */
export interface TimelineDragProps {
  data: DayData
  now?: Ms
  bounds: [Ms, Ms]
  selection: Selection | null
  selectedId?: string
}

/** The timeline's events the pointer raises. */
export interface TimelineDragEmit {
  (e: 'selection', sel: Selection | null, commit: boolean): void
  (e: 'select', id: string): void
  (e: 'move', change: { id: string; start: Ms; end: Ms; lane: number }): void
  (e: 'resize', change: { id: string; start: Ms; end: Ms }): void
  (e: 'pin', t: Ms | undefined): void
}

/** A pointer gesture in progress on the timeline. */
type Drag =
  | { type: 'create'; x0: number; t0: Ms; t1: Ms; moved: boolean; hitId?: string; ctrl: boolean }
  | { type: 'sel'; edge: 'start' | 'end' }
  | { type: 'resize'; id: string; edge: 'start' | 'end'; start: Ms; end: Ms; x0: number; moved: boolean }
  | { type: 'move'; id: string; x0: number; y0: number; t0: Ms; offset: Ms; dur: Ms; start: Ms; lane: number; moved: boolean }
  | { type: 'pin'; x0: number; t0: Ms; moved: boolean }
  | { type: 'pan'; x0: number; from0: Ms; span: number; moved: boolean; middle?: boolean }

/** How long a released drag keeps its geometry on screen while the saved state comes back. */
const PENDING_MS = 2000
/** ← / → move the selection's edge a step back / forward. */
const SEL_KEYS: Partial<Record<string, 1 | -1>> = { ArrowLeft: -1, ArrowRight: 1 }

/**
 * The timeline's pointer: click → divider; press + drag on empty space (or Shift + drag anywhere) → range;
 * drag a block → move it (vertically into a free lane); its edge → resize; Ctrl + click → multi-select;
 * the axis or the middle button → pan. Pointer capture keeps the gesture on the canvas.
 */
export function useTimelineDrag(props: TimelineDragProps, scale: TimelineScale, emit: TimelineDragEmit, markManual: () => void) {
  const { vp, from, to, canvas, width, rawTimeAt, timeAt, snapPoints, makeSel, selEnd } = scale
  const drag = ref<Drag>()
  const hoverT = ref<Ms>()
  const hoverX = ref(0)
  /** Ctrl+click multi-selection. */
  const multi = ref<Set<string>>(new Set())
  /** The time divider placed by a click. */
  const pinT = ref<Ms>()
  watch(pinT, (t) => emit('pin', t))
  /** A released move / resize shown until the saved state catches up — no snap-back flicker. */
  const pending = ref<{ id: string; start: Ms; end: Ms; lane?: number }>()
  watch(
    () => props.data.entries,
    (list) => {
      const p = pending.value
      if (p && list.some((e) => e.id === p.id && e.start === p.start && e.end === p.end && (p.lane === undefined || e.lane === p.lane))) pending.value = undefined
    },
  )

  /** A block's geometry with the drag in progress (or the pending one) applied. */
  function preview(e: Entry): BlockView | Entry {
    const d = drag.value
    if (d?.type === 'resize' && d.id === e.id && d.moved) return { start: d.start, end: d.end }
    if (d?.type === 'move' && d.id === e.id && d.moved) return { start: d.start, end: d.start + d.dur, lane: d.lane }
    const p = pending.value
    return p && p.id === e.id ? { start: p.start, end: p.end, lane: p.lane ?? e.lane } : e
  }
  const movingId = computed(() => (drag.value?.type === 'move' || drag.value?.type === 'resize' ? drag.value.id : pending.value?.id))
  const lanes = useTimelineLanes(() => props.data.entries, preview, () => movingId.value)
  /** Resize handles only where there is room — otherwise the whole block is a click target. */
  const wide = (e: Entry) => ((preview(e).end - preview(e).start) / (to.value - from.value)) * width.value >= 26

  function capture(e: PointerEvent): void {
    canvas.value?.setPointerCapture(e.pointerId)
  }

  /** Press on a lane: a block starts a move (not Outlook's, not with Shift / Ctrl), elsewhere a range. */
  function onLaneDown(e: PointerEvent): void {
    if (e.button !== 0) return
    const t = timeAt(e.clientX)
    const id = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-entry]')?.dataset.entry
    const hit = id ? props.data.entries.find((x) => x.id === id) : undefined
    if (hit && !hit.outlook && !e.shiftKey && !e.ctrlKey) {
      const raw = rawTimeAt(e.clientX)
      drag.value = { type: 'move', id: hit.id, x0: e.clientX, y0: e.clientY, t0: raw, offset: raw - hit.start, dur: hit.end - hit.start, start: hit.start, lane: lanes.laneOf(hit.id), moved: false }
    } else drag.value = { type: 'create', x0: e.clientX, t0: t, t1: t, moved: false, hitId: hit?.id, ctrl: e.ctrlKey }
    capture(e)
  }

  /** The time chip of the divider: drag left/right to select from that moment (works over blocks too). */
  function onPinDown(e: PointerEvent): void {
    if (e.button !== 0 || pinT.value === undefined) return
    e.stopPropagation()
    drag.value = { type: 'pin', x0: e.clientX, t0: pinT.value, moved: false }
    capture(e)
  }

  /** A selection edge handle. */
  function onSelHandle(e: PointerEvent, edge: 'start' | 'end'): void {
    e.stopPropagation()
    drag.value = { type: 'sel', edge }
    capture(e)
  }

  /** A block's edge (an Outlook meeting is Outlook's). */
  function onResizeDown(e: PointerEvent, entry: Entry, edge: 'start' | 'end'): void {
    e.stopPropagation()
    if (entry.outlook) return
    drag.value = { type: 'resize', id: entry.id, edge, start: entry.start, end: entry.end, x0: e.clientX, moved: false }
    capture(e)
  }

  /** Middle button held anywhere on the timeline: scroll horizontally. */
  function onMiddleDown(e: PointerEvent): void {
    if (e.button !== 1) return
    e.preventDefault()
    e.stopPropagation()
    drag.value = { type: 'pan', x0: e.clientX, from0: from.value, span: to.value - from.value, moved: false, middle: true }
    capture(e)
  }

  /** The axis drags the window. */
  function onAxisDown(e: PointerEvent): void {
    drag.value = { type: 'pan', x0: e.clientX, from0: from.value, span: to.value - from.value, moved: false }
    capture(e)
  }

  /** No gesture: the hover time line (not between fanned-out notes). */
  function trackHover(e: PointerEvent): void {
    if (!canvas.value) return
    const r = canvas.value.getBoundingClientRect()
    if (e.clientX < r.left || e.clientX > r.right) return void (hoverT.value = undefined)
    if ((e.target as HTMLElement | null)?.closest?.('.fanzone, [data-note]')) return void (hoverT.value = undefined)
    hoverT.value = rawTimeAt(e.clientX)
    hoverX.value = e.clientX - r.left
  }

  /** A moved block: snapped start, and the lane under the pointer (incl. the empty one) if that slot is free. */
  function dragBlock(d: Extract<Drag, { type: 'move' }>, e: PointerEvent): void {
    const raw = rawTimeAt(e.clientX) - d.offset
    const snapped = snap(raw, snapPoints.value.filter((p) => p !== d.start), (to.value - from.value) / width.value)
    d.start = Math.max(props.bounds[0], Math.min(snapped, props.bounds[1] - d.dur))
    const el = lanes.mainLane.value
    if (!el) return
    const r = el.getBoundingClientRect()
    if (e.clientY < r.top || e.clientY > r.bottom) return
    const want = laneAtOffset(e.clientY - r.top + el.scrollTop - 5, lanes.laneH.value, LANE_GAP, lanes.totalLanes.value)
    if (want !== d.lane && laneIsFree(props.data.entries, want, d.start, d.start + d.dur, d.id)) d.lane = want
  }

  function onMove(e: PointerEvent): void {
    const d = drag.value
    if (!d) return trackHover(e)
    hoverT.value = undefined
    if (d.type === 'pan') {
      d.moved ||= Math.abs(e.clientX - d.x0) > 3
      const r = canvas.value!.getBoundingClientRect()
      const a = d.from0 + ((d.x0 - e.clientX) / r.width) * d.span
      markManual()
      vp.setRange([a, a + d.span])
      return
    }
    const t = timeAt(e.clientX)
    switch (d.type) {
      case 'create':
        d.t1 = t
        d.moved ||= Math.abs(e.clientX - d.x0) > 4
        if (d.moved) emit('selection', makeSel(Math.min(d.t0, d.t1), Math.max(d.t0, d.t1)), false)
        return
      case 'sel': {
        const s = props.selection
        if (!s) return
        if (d.edge === 'start') emit('selection', { ...s, start: Math.min(t, selEnd.value - MINUTE) }, false)
        else emit('selection', makeSel(s.start, Math.max(t, s.start + MINUTE)), false)
        return
      }
      case 'resize':
        d.moved ||= Math.abs(e.clientX - d.x0) > 3
        if (!d.moved) return
        if (d.edge === 'start') d.start = Math.min(t, d.end - MINUTE)
        else d.end = Math.max(t, d.start + MINUTE)
        return
      case 'pin':
        d.moved ||= Math.abs(e.clientX - d.x0) > 3
        if (d.moved) emit('selection', makeSel(Math.min(d.t0, t), Math.max(d.t0, t)), false)
        return
      case 'move':
        d.moved ||= Math.abs(e.clientX - d.x0) > 4 || Math.abs(e.clientY - d.y0) > 6
        if (d.moved) dragBlock(d, e)
        return
    }
  }

  /** Keeps a released geometry on screen for a while (see `pending`). */
  function hold(p: { id: string; start: Ms; end: Ms; lane?: number }): void {
    pending.value = p
    setTimeout(() => pending.value?.id === p.id && (pending.value = undefined), PENDING_MS)
  }

  function onUp(): void {
    const d = drag.value
    // the lane a moved block is shown on comes from the live preview — read it before the drag is cleared
    const dropLane = d?.type === 'move' ? lanes.laneOf(d.id) : 0
    drag.value = undefined
    if (!d) return
    switch (d.type) {
      case 'pin':
        if (!d.moved) return
        pinT.value = undefined
        if (props.selection) emit('selection', props.selection, true)
        return
      case 'move': {
        if (!d.moved) return clickBlock(d.id, d.t0)
        const change = { id: d.id, start: d.start, end: d.start + d.dur, lane: dropLane } // the lane it is shown on is the lane it keeps
        hold({ ...change })
        return emit('move', change)
      }
      case 'resize':
        // a click on the edge of a narrow block still selects it
        if (!d.moved) return clickBlock(d.id, d.edge === 'start' ? d.start : d.end)
        hold({ id: d.id, start: d.start, end: d.end })
        return emit('resize', { id: d.id, start: d.start, end: d.end })
      case 'pan':
        // a plain (left) click on the time axis drops the marker
        if (!d.moved && !d.middle) emit('selection', null, true)
        return
      case 'sel':
        if (props.selection) emit('selection', props.selection, true)
        return
      case 'create':
        return releaseCreate(d)
    }
  }

  /** A drag on empty space ends a range; a plain click: Ctrl → multi-select, a block → highlight, empty → divider. */
  function releaseCreate(d: Extract<Drag, { type: 'create' }>): void {
    if (d.moved) {
      pinT.value = undefined
      multi.value = new Set()
      return emit('selection', makeSel(Math.min(d.t0, d.t1), Math.max(d.t0, d.t1)), true)
    }
    if (d.hitId && d.ctrl) return toggleMulti(d.hitId)
    if (d.hitId) return clickBlock(d.hitId, d.t0)
    multi.value = new Set()
    pinT.value = d.t0
    emit('selection', null, true)
  }

  /** A block clicked: highlighted, the divider at the moment (unless a range is selected). */
  function clickBlock(id: string, t: Ms): void {
    multi.value = new Set()
    if (!props.selection) pinT.value = t
    emit('select', id)
  }

  /** Ctrl + click: the block joins / leaves the multi-selection (the highlighted one joins first). */
  function toggleMulti(id: string): void {
    const s = new Set(multi.value)
    if (props.selectedId && !s.size) s.add(props.selectedId)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    multi.value = s
  }

  /** Esc drops everything; ←/→ move the selection's end (Shift — its start; Alt — by 5 minutes). */
  function onKey(e: KeyboardEvent): void {
    const s = props.selection
    if (e.key === 'Escape') {
      multi.value = new Set()
      pinT.value = undefined
      return emit('selection', null, true)
    }
    const dir = SEL_KEYS[e.key]
    if (!s || !dir) return
    e.preventDefault()
    const delta = dir * (e.altKey ? 5 : 1) * MINUTE
    if (e.shiftKey) emit('selection', { ...s, start: Math.min(s.start + delta, selEnd.value - MINUTE) }, true)
    else emit('selection', makeSel(s.start, Math.min(Math.max(selEnd.value + delta, s.start + MINUTE), props.bounds[1])), true)
  }

  return { drag, hoverT, hoverX, multi, pinT, preview, wide, lanes, onLaneDown, onPinDown, onSelHandle, onResizeDown, onMiddleDown, onAxisDown, onMove, onUp, onKey }
}
