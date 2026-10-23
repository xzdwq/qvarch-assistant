import { computed, type Ref } from 'vue'
import { visibleNotes } from '@shared/notes'
import type { Entry } from '@shared/types'
import { kinds } from '../../lib/palette'
import { clusterize, useFan } from '../../lib/pinfan'
import { dayKey, dayLabel as dayLabelFor, monthBands, rangeTitle } from '@shared/tracker/calendarDays'
import { dayStats } from '@shared/tracker/calendarItems'
import { eventBox, layoutDay, type DayColumn } from '@shared/tracker/calendarLayout'
import type { CalendarGesture } from '@shared/tracker/calendarGesture'
import type { CalendarData } from './useCalendarData'
import type { CalendarViewport } from './useCalendarViewport'

/** An event as drawn on the strip. */
export interface PlacedEvent {
  e: Entry
  day: string
  x: number
  y: number
  w: number
  h: number
  lines: number
  time: boolean
  dragging: boolean
}

/**
 * Where everything stands on the strip: days (a day with parallel events is wider), events, note pins (fanned out
 * when close), month bands, the footer's per-day totals.
 */
export function useCalendarLayout(view: CalendarViewport, data: CalendarData, g: Ref<CalendarGesture | undefined>) {
  const { visibleNums, colW, roomy, start, firstDay, lastDay, GUT, hourPx, yOf } = view

  /** The day's events as drawn — a dragged / resized one where it is being put. */
  const shownEntries = (day: string): Entry[] => {
    const x = g.value
    let list = data.days.value.get(day)?.entries ?? []
    if (x?.kind === 'move' && x.moved) {
      list = list.filter((e) => e.id !== x.id)
      if (dayKey(x.toDay) === day) list = [...list, { ...x.orig, start: x.start, end: x.start + (x.orig.end - x.orig.start) }]
    } else if (x?.kind === 'resize' && x.moved && x.day === day) list = list.map((e) => (e.id === x.id ? { ...e, start: x.start, end: x.end } : e))
    return list.filter(data.visibleEntry).sort((a, b) => a.start - b.start || (a.lane ?? 0) - (b.lane ?? 0))
  }
  /** The events of each visible day laid out in columns (computed once per change). */
  const layouts = computed(() => {
    const m = new Map<number, Array<DayColumn<Entry>>>()
    for (const n of visibleNums.value) m.set(n, layoutDay(shownEntries(dayKey(n))))
    return m
  })
  /** A day with parallel events gets wider (up to 3×) so each stays readable — at the day / week zoom. */
  const factorOf = (n: number) => (roomy.value ? Math.min(3, Math.max(1, ...(layouts.value.get(n) ?? []).map((x) => x.cols))) : 1)
  const widthOf = (n: number) => colW.value * factorOf(n)
  /** Extra width of the widened days before each visible day. */
  const extra = computed(() => {
    const m = new Map<number, number>()
    let acc = 0
    for (const n of visibleNums.value) {
      m.set(n, acc)
      acc += (factorOf(n) - 1) * colW.value
    }
    m.set(lastDay.value + 1, acc)
    return m
  })
  /** A day's left edge on the strip (px). */
  const xOf = (n: number) => (n - start.value) * colW.value + (n < firstDay.value ? 0 : (extra.value.get(Math.min(n, lastDay.value + 1)) ?? 0))

  const placed = computed(() => {
    const out: PlacedEvent[] = []
    const gx = g.value
    const dragId = gx && (gx.kind === 'move' || gx.kind === 'resize') && gx.moved ? gx.id : undefined
    for (const n of visibleNums.value) {
      const day = dayKey(n)
      const cw = widthOf(n)
      const gut = GUT.value
      const inner = cw - 2 * gut
      const gap = roomy.value ? 4 : cw > 12 ? 2 : 0.5
      for (const { e, col, cols } of layouts.value.get(n) ?? []) {
        const x = xOf(n) + gut + (inner * col) / cols
        const w = Math.max(2, inner / cols - (cols > 1 ? gap : 0))
        // text only where it fits (else — the tooltip)
        const { h, time, lines } = eventBox(e.end - e.start, hourPx.value)
        out.push({ e, day, x, y: yOf(e.start, day), w, h, lines, time, dragging: e.id === dragId })
      }
    }
    return out
  })

  const notePins = computed(() =>
    colW.value < 24
      ? []
      : visibleNums.value.flatMap((n) => {
          const day = dayKey(n)
          // at the right edge of the day — clear of the events' text
          return visibleNotes(data.days.value.get(day)?.notes).map((note) => ({ note, day, x: xOf(n) + widthOf(n) - 17, y: yOf(note.at, day) }))
        }),
  )
  const fan = useFan()
  const pinPlaces = computed(() => clusterize(notePins.value.map((p) => ({ ...p, id: p.note.id })), (p) => p.y, 16, (p) => p.day))
  /** The area of the open group: the pointer stays "inside" while it moves between the fanned notes. */
  const fanZone = computed(() => {
    const k = fan.open.value
    const p = k && notePins.value.find((x) => x.note.id === k)
    const n = k ? (pinPlaces.value.get(k)?.n ?? 1) : 1
    return p && n > 1 ? { left: p.x - (n - 1) * 18 - 5, top: p.y - 12, width: (n - 1) * 18 + 25, height: 25 } : undefined
  })

  const months = computed(() => monthBands(firstDay.value, lastDay.value, xOf, view.W.value))
  const dayLabel = (n: number) => dayLabelFor(n, colW.value)
  /** Per day: done (what already happened, parallel counted once), of it productive, still planned, events. */
  const stats = computed(() =>
    visibleNums.value.map((n) => {
      const day = dayKey(n)
      const d = data.days.value.get(day)
      return { n, day, ...dayStats((d?.entries ?? []).filter(data.visibleEntry), d?.plan ?? [], visibleNotes(d?.notes).length, data.nowMs.value, kinds.value) }
    }),
  )
  const nowY = computed(() => yOf(data.nowMs.value, view.today.value))
  const rangeText = computed(() => rangeTitle(start.value, view.span.value))

  return { widthOf, xOf, placed, notePins, fan, pinPlaces, fanZone, months, dayLabel, stats, nowY, rangeText }
}

export type CalendarLayout = ReturnType<typeof useCalendarLayout>
