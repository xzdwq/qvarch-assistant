import { computed, ref } from 'vue'
import { dayEnd, dayStart, laneIsFree, MINUTE } from '@shared/timeline'
import { laneAtOffset } from '@shared/tracker/timelineRanges'
import type { Entry, Ms } from '@shared/types'
import { snap } from '../lib/viewport'
import type { IslandDay } from './useIslandDay'
import type { IslandElements } from './islandElements'
import type { IslandSelection } from './useIslandSelection'
import { LANE_GAP, LANE_H, type IslandTrack } from './useIslandTrack'

/** A gesture on the track, from press to release. */
type TrackDrag =
  | { type: 'create'; x0: number; t0: Ms; t1: Ms; moved: boolean; hitId?: string; ctrl: boolean }
  | { type: 'edge'; edge: 'start' | 'end' }
  | { type: 'resize'; id: string; edge: 'start' | 'end'; start: Ms; end: Ms; x0: number; moved: boolean }
  | { type: 'move'; id: string; x0: number; y0: number; t0: Ms; offset: Ms; dur: Ms; start: Ms; lane: number; moved: boolean }
  | { type: 'pin'; x0: number; t0: Ms; moved: boolean }
  | { type: 'pan'; x0: number; from0: Ms; span: number }

/**
 * The track's pointer (captured on press, so hit-tests go by coordinates):
 * click            → a time divider at that moment; on a block the block is highlighted
 * press + drag     → select a range (from empty space; Shift — from anywhere)
 * drag a block     → move it (also to another free lane); its edge — resize; Outlook meetings stay
 * Ctrl+click block → multi-select (right-click → merge / kind / delete)
 * middle button    → pan; the divider's time chip / the band's caps — drag to select from there
 */
export function useTrackPointer(els: IslandElements, day: IslandDay, view: IslandTrack, pick: IslandSelection) {
  const { today, data, now, schedule } = day
  const { from, to, resized, hoverT } = view
  const { sel, entryId, pinT, multi, makeSel } = pick
  const tdrag = ref<TrackDrag>()

  /** Moments a dragged time sticks to: now, block edges (not the moving block's), calls, the schedule. */
  const snapPoints = computed(() => {
    const moving = tdrag.value?.type === 'move' ? tdrag.value.id : undefined
    const pts: Ms[] = [now.value]
    for (const e of data.value.entries) if (e.id !== moving) pts.push(e.start, e.end)
    for (const c of data.value.calls) pts.push(c.start, c.end)
    const w = schedule.value
    if (w.work) pts.push(...w.work)
    if (w.lunch) pts.push(...w.lunch)
    return pts
  })
  const trackRect = () => els.track.value!.getBoundingClientRect()
  function rawTime(clientX: number): Ms {
    const r = trackRect()
    return from.value + ((clientX - r.left) / r.width) * (to.value - from.value)
  }
  function timeAt(clientX: number, snapIt = true): Ms {
    const t = rawTime(clientX)
    const v = snapIt ? snap(t, snapPoints.value, (to.value - from.value) / trackRect().width) : t
    // planned blocks are allowed: anything up to the end of the day
    return Math.max(from.value, Math.min(v, dayEnd(today.value)))
  }
  /** Pointer capture retargets events to the track — hit-test by coordinates. */
  function entryAt(x: number, y: number): Entry | undefined {
    const id = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-entry]')?.dataset.entry
    return id ? data.value.entries.find((e) => e.id === id) : undefined
  }
  function capture(d: TrackDrag, e: PointerEvent): void {
    tdrag.value = d
    els.track.value!.setPointerCapture(e.pointerId)
  }

  function onTrackDown(e: PointerEvent): void {
    if (e.button === 1) {
      // middle button held: scroll the timeline horizontally
      e.preventDefault()
      return capture({ type: 'pan', x0: e.clientX, from0: from.value, span: to.value - from.value }, e)
    }
    if (e.button !== 0) return
    const t = timeAt(e.clientX)
    const hit = entryAt(e.clientX, e.clientY)
    // an Outlook meeting does not move (Outlook's)
    if (hit && !hit.outlook && !e.shiftKey && !e.ctrlKey) {
      const t0 = rawTime(e.clientX)
      capture({ type: 'move', id: hit.id, x0: e.clientX, y0: e.clientY, t0, offset: t0 - hit.start, dur: hit.end - hit.start, start: hit.start, lane: view.laneOf(hit.id), moved: false }, e)
    } else capture({ type: 'create', x0: e.clientX, t0: t, t1: t, moved: false, hitId: hit?.id, ctrl: e.ctrlKey }, e)
  }
  /** The time chip of the divider: drag left/right to select from that moment (works over blocks too). */
  function onPinDown(e: PointerEvent): void {
    if (e.button !== 0 || pinT.value === undefined) return
    e.stopPropagation()
    entryId.value = undefined // the band is hidden while a block is highlighted
    capture({ type: 'pin', x0: e.clientX, t0: pinT.value, moved: false }, e)
  }
  function onEdgeDown(e: PointerEvent, edge: 'start' | 'end'): void {
    if (e.button !== 0) return
    e.stopPropagation()
    capture({ type: 'edge', edge }, e)
  }
  function onResizeDown(e: PointerEvent, entry: Entry, edge: 'start' | 'end'): void {
    if (e.button !== 0) return
    e.stopPropagation()
    if (entry.outlook) return
    capture({ type: 'resize', id: entry.id, edge, start: entry.start, end: entry.end, x0: e.clientX, moved: false }, e)
  }

  function onTrackMove(e: PointerEvent): void {
    const d = tdrag.value
    if (!d) {
      // between the fanned-out notes: no time line behind them
      hoverT.value = (e.target as HTMLElement | null)?.closest?.('.fanzone, [data-note]') ? undefined : timeAt(e.clientX, false)
      return
    }
    if (e.buttons === 0) return void onTrackUp()
    switch (d.type) {
      case 'pan': {
        const a = d.from0 + ((d.x0 - e.clientX) / trackRect().width) * d.span
        return view.vp.setRange([a, a + d.span])
      }
      case 'create': {
        d.t1 = timeAt(e.clientX)
        d.moved ||= Math.abs(e.clientX - d.x0) > 4
        if (d.moved) {
          pinT.value = undefined
          sel.preview(makeSel(Math.min(d.t0, d.t1), Math.max(d.t0, d.t1)))
        }
        return
      }
      case 'pin': {
        const t = timeAt(e.clientX)
        d.moved ||= Math.abs(e.clientX - d.x0) > 3
        if (d.moved) sel.preview(makeSel(Math.min(d.t0, t), Math.max(d.t0, t)))
        return
      }
      case 'move':
        return moveBlock(d, e)
      case 'resize': {
        const t = timeAt(e.clientX)
        d.moved ||= Math.abs(e.clientX - d.x0) > 3
        if (!d.moved) return
        if (d.edge === 'start') d.start = Math.min(t, d.end - MINUTE)
        else d.end = Math.max(t, d.start + MINUTE)
        resized.value = { id: d.id, start: d.start, end: d.end }
        return
      }
      case 'edge': {
        const t = timeAt(e.clientX)
        const s = sel.selection.value
        if (!s) return
        const end = s.end ?? now.value
        if (d.edge === 'start') sel.preview({ ...s, start: Math.min(t, end - MINUTE) })
        else sel.preview(makeSel(s.start, Math.max(t, s.start + MINUTE)))
        return
      }
      default:
        return d satisfies never
    }
  }
  /** Moves a dragged block: snapped in time, onto the row under the pointer if that slot is free. */
  function moveBlock(d: Extract<TrackDrag, { type: 'move' }>, e: PointerEvent): void {
    d.moved ||= Math.abs(e.clientX - d.x0) > 4 || Math.abs(e.clientY - d.y0) > 6
    if (!d.moved) return
    const raw = rawTime(e.clientX) - d.offset
    const start = Math.min(snap(raw, snapPoints.value, (to.value - from.value) / trackRect().width), dayEnd(today.value) - d.dur)
    d.start = Math.max(dayStart(today.value), start)
    // vertical: the row under the pointer (one empty lane below is allowed), only if that slot is free
    const row = els.rowMain.value?.getBoundingClientRect()
    if (row && e.clientY >= row.top - 4) {
      const want = laneAtOffset(e.clientY - row.top, LANE_H, LANE_GAP, view.totalLanes.value)
      if (want !== d.lane && laneIsFree(data.value.entries, want, d.start, d.start + d.dur, d.id)) d.lane = want
    }
    resized.value = { id: d.id, start: d.start, end: d.start + d.dur, lane: d.lane }
  }

  /** Keep the dragged geometry on screen until the saved state comes back — no snap-back flicker. */
  async function saveGeometry(id: string, start: Ms, end: Ms): Promise<void> {
    const entry = data.value.entries.find((x) => x.id === id)
    // the lane the block is shown on right now is the lane it keeps (what you see is what you get)
    const lane = view.laneOf(id)
    if (!entry || (entry.start === start && entry.end === end && (entry.lane ?? view.laneOf(id)) === lane)) {
      resized.value = undefined
      return
    }
    await window.qa.saveEntry(today.value, { ...entry, start, end, lane }, { overlap: true })
    setTimeout(() => resized.value?.id === id && (resized.value = undefined), 2000)
  }
  /** A press on a block that never moved: a click on it. */
  function clickBlock(id: string, t: Ms): void {
    const entry = data.value.entries.find((x) => x.id === id)
    if (entry) pick.clickEntry(entry, t)
  }

  async function onTrackUp(): Promise<void> {
    const d = tdrag.value
    tdrag.value = undefined
    if (!d) return
    switch (d.type) {
      case 'resize': {
        if (d.moved) return saveGeometry(d.id, d.start, d.end)
        const entry = data.value.entries.find((x) => x.id === d.id)
        if (entry) pick.clickEntry(entry, d.edge === 'start' ? entry.start : entry.end) // tiny block: an edge click still selects
        return
      }
      case 'move':
        if (d.moved) return saveGeometry(d.id, d.start, d.start + d.dur)
        return clickBlock(d.id, Math.min(Math.max(d.t0, from.value), now.value))
      case 'pan':
        return
      case 'edge':
        return sel.commit(sel.selection.value)
      case 'pin':
        if (!d.moved) return
        entryId.value = undefined
        pinT.value = undefined
        return sel.commit(sel.selection.value)
      case 'create':
        return releaseCreate(d)
      default:
        return d satisfies never
    }
  }
  /** Released empty-space press: a range committed, or a click (multi-select / block / divider). */
  function releaseCreate(d: Extract<TrackDrag, { type: 'create' }>): void {
    if (d.moved) {
      entryId.value = undefined
      multi.value = new Set()
      return sel.commit(sel.selection.value)
    }
    const hit = d.hitId ? data.value.entries.find((x) => x.id === d.hitId) : undefined
    if (hit && d.ctrl) return pick.toggleMulti(hit.id)
    if (hit) return pick.clickEntry(hit, d.t0)
    multi.value = new Set()
    entryId.value = undefined
    sel.clear()
    pinT.value = d.t0
  }

  return { timeAt, entryAt, onTrackDown, onPinDown, onEdgeDown, onResizeDown, onTrackMove, onTrackUp }
}

export type TrackPointer = ReturnType<typeof useTrackPointer>
