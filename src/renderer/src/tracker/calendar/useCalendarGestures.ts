import { nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { dayEnd, dayStart, HOUR } from '@shared/timeline'
import type { Entry } from '@shared/types'
import { ZY_MAX, ZY_MIN } from '@shared/tracker/calendarLayout'
import { dayKey, dayNum } from '@shared/tracker/calendarDays'
import { decidePending, edgeAt, SNAP, snapT, type CalendarGesture } from '@shared/tracker/calendarGesture'
import type { CalendarData } from './useCalendarData'
import type { CalendarLayout } from './useCalendarLayout'
import type { CalendarPanelState } from './useCalendarPanel'
import type { CalendarViewport } from './useCalendarViewport'

/** Elements a press there is theirs (links, labels, notes, buttons) — not a gesture of the strip. */
const OWN_PRESS = '.lk-corner, .unlink, .dlabel, [data-note], .fanzone, .xlink, .hplus, .lbadge'

/**
 * The strip under the pointer: press and drag down — a new event, sideways — the days scroll; drag an event to
 * another time or day, pull its edge; double click — a note. Wheel: the hours scroll (natively), over the hours —
 * their scale; Shift / a horizontal wheel — the days; Ctrl — zoom around the pointer.
 */
export function useCalendarGestures(view: CalendarViewport, data: CalendarData, layout: CalendarLayout, panelState: CalendarPanelState, g: Ref<CalendarGesture | undefined>) {
  const { canvas, body, head, start, colW, hourPx, zf, visibleNums } = view
  const { xOf, widthOf } = layout
  const { openDraft, openEntry, openNote, selectedId, followEntry } = panelState

  /** The day under a pointer x. */
  function dayAt(clientX: number): number {
    const r = canvas.value!.getBoundingClientRect()
    const x = (clientX - r.left) / zf()
    for (const n of visibleNums.value) if (x >= xOf(n) && x < xOf(n) + widthOf(n)) return n
    return Math.floor(start.value + x / colW.value)
  }
  /** The (snapped) moment under a pointer y on that day. */
  function timeAt(clientY: number, n: number): number {
    const r = canvas.value!.getBoundingClientRect()
    const d = dayKey(n)
    return Math.max(dayStart(d), Math.min(dayEnd(d), snapT(dayStart(d) + ((clientY - r.top) / zf() / hourPx.value) * HOUR)))
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest(OWN_PRESS)) return
    const evEl = t.closest<HTMLElement>('[data-entry]')
    if (evEl) {
      const f = data.findEntry(evEl.dataset.entry!)
      if (!f) return
      const r = evEl.getBoundingClientRect()
      const edge = edgeAt(r.height, e.clientY - r.top, r.bottom - e.clientY)
      g.value = edge
        ? { kind: 'resize', id: f.e.id, day: f.day, edge, orig: f.e, moved: false, start: f.e.start, end: f.e.end }
        : { kind: 'move', id: f.e.id, from: f.day, x0: e.clientX, y0: e.clientY, orig: f.e, moved: false, toDay: dayNum(f.day), start: f.e.start, dayOff: dayAt(e.clientX) - dayNum(f.day) }
    } else {
      const day = dayAt(e.clientX)
      g.value = { kind: 'pending', x0: e.clientX, y0: e.clientY, day, t0: timeAt(e.clientY, day), s0: start.value, pid: e.pointerId }
    }
    canvas.value?.setPointerCapture(e.pointerId)
  }

  /** Where the pointer is over an empty spot: the day and the (snapped) moment — a line + a "+" there. */
  const hover = ref<{ n: number; t: number }>()
  function onMove(e: PointerEvent): void {
    const x = g.value
    if (!x) return trackHover(e)
    switch (x.kind) {
      case 'pending': {
        const way = decidePending(e.clientX - x.x0, e.clientY - x.y0)
        if (way === 'pan') g.value = { kind: 'pan', x0: x.x0, s0: x.s0 }
        else if (way === 'create') g.value = { kind: 'create', day: x.day, t0: x.t0, t1: timeAt(e.clientY, x.day) }
        return
      }
      case 'pan':
        start.value = x.s0 - (e.clientX - x.x0) / zf() / colW.value
        return
      case 'create':
        x.t1 = timeAt(e.clientY, x.day)
        return
      case 'move': {
        if (x.orig.outlook) return
        x.moved ||= Math.abs(e.clientX - x.x0) + Math.abs(e.clientY - x.y0) > 5
        if (!x.moved) return
        const dur = x.orig.end - x.orig.start
        x.toDay = dayAt(e.clientX) - x.dayOff
        const d = dayKey(x.toDay)
        const shifted = snapT(x.orig.start - dayStart(x.from) + ((e.clientY - x.y0) / zf() / hourPx.value) * HOUR)
        x.start = Math.max(dayStart(d), Math.min(dayEnd(d) - dur, dayStart(d) + shifted))
        return
      }
      case 'resize': {
        if (x.orig.outlook) return
        x.moved = true
        const t = timeAt(e.clientY, dayNum(x.day))
        if (x.edge === 'start') x.start = Math.min(t, x.end - SNAP)
        else x.end = Math.max(t, x.start + SNAP)
        return
      }
    }
  }
  /** No gesture: the hover line follows the pointer (not over a note, or between the fanned-out notes). */
  function trackHover(e: PointerEvent): void {
    const over = (e.target as HTMLElement).closest('[data-entry], [data-note], .fanzone, .lk-corner, .unlink, .hplus')
    if (over && !(over as HTMLElement).classList.contains('hplus')) hover.value = undefined
    else if (!over) {
      const n = dayAt(e.clientX)
      hover.value = { n, t: timeAt(e.clientY, n) }
    }
  }

  async function onUp(): Promise<void> {
    const x = g.value
    g.value = undefined
    if (!x) return
    switch (x.kind) {
      case 'create': {
        const a = Math.min(x.t0, x.t1)
        const b = Math.max(x.t0, x.t1)
        if (b - a >= SNAP) openDraft(dayKey(x.day), a, b)
        return
      }
      case 'move': {
        if (!x.moved) return openEntry(x.orig, x.from)
        const to = dayKey(x.toDay)
        if (to === x.from && x.start === x.orig.start) return
        try {
          await window.qa.moveEntry(x.from, to, x.id, x.start, x.start + (x.orig.end - x.orig.start))
        } finally {
          await data.reloadVisible()
          // the open panel follows the moved event (its new day and times)
          if (selectedId.value === x.id) followEntry(x.id)
        }
        return
      }
      case 'resize': {
        if (!x.moved) return openEntry(x.orig, x.day)
        const { followsNow: _f, ...plain } = JSON.parse(JSON.stringify(x.orig)) as Entry & { followsNow?: boolean }
        await window.qa.saveEntry(x.day, { ...plain, start: x.start, end: x.end }, { overlap: true })
        await data.reloadVisible()
        return
      }
      case 'pending':
      case 'pan':
        return
    }
  }
  // double click on an empty spot: a note at that moment
  function onDbl(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('[data-entry], [data-note], .fanzone')) return
    const day = dayAt(e.clientX)
    openNote(dayKey(day), { id: crypto.randomUUID(), at: timeAt(e.clientY, day), text: '', isNew: true })
  }

  function onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.shiftKey && (e.target as HTMLElement).closest('.hours')) return zoomHours(e)
    const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)
    if (!e.ctrlKey && !horizontal) return
    e.preventDefault()
    const r = canvas.value!.getBoundingClientRect()
    if (e.ctrlKey) return view.zoomAround(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), e.deltaY)
    start.value += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / colW.value
  }
  /** Where the hours should be scrolled once the new scale is drawn (several wheel steps may come first). */
  let wantTop: number | undefined
  function zoomHours(e: WheelEvent): void {
    e.preventDefault()
    const b = body.value
    if (!b || !e.deltaY) return
    // not in the middle of a drag: its maths uses the scale
    if (g.value && g.value.kind !== 'pending') return
    const py = (e.clientY - b.getBoundingClientRect().top) / zf()
    const top = wantTop ?? b.scrollTop
    const at = (top + py) / hourPx.value // the hour under the pointer stays under it
    const dy = Math.max(-120, Math.min(120, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY))
    view.zy.value = Math.min(ZY_MAX, Math.max(ZY_MIN, view.zy.value * Math.exp(-dy * 0.0022)))
    wantTop = Math.max(0, at * hourPx.value - py)
    void nextTick(() => {
      if (wantTop === undefined) return
      b.scrollTop = wantTop
      wantTop = undefined
    })
  }
  function onHeadWheel(e: WheelEvent): void {
    if (e.ctrlKey) return onWheel(e)
    e.preventDefault()
    start.value += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / colW.value
  }
  onMounted(() => {
    body.value?.addEventListener('wheel', onWheel, { passive: false })
    head.value?.addEventListener('wheel', onHeadWheel, { passive: false })
  })
  onBeforeUnmount(() => {
    body.value?.removeEventListener('wheel', onWheel)
    head.value?.removeEventListener('wheel', onHeadWheel)
  })

  return { hover, dayAt, timeAt, onDown, onMove, onUp, onDbl }
}

export type CalendarGestures = ReturnType<typeof useCalendarGestures>
