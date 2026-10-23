import { inject, provide, ref, type InjectionKey } from 'vue'
import { formatDuration, formatHM, HOUR, MINUTE } from '@shared/timeline'
import { entryIcon, kindColor } from '../../lib/palette'
import { capFirst, dayKey, dayNum, fmtDay } from '@shared/tracker/calendarDays'
import type { CalendarGesture } from '@shared/tracker/calendarGesture'
import { useCalendarData } from './useCalendarData'
import { useCalendarGestures } from './useCalendarGestures'
import { useCalendarLayout } from './useCalendarLayout'
import { useCalendarMenu } from './useCalendarMenu'
import { useCalendarPanel } from './useCalendarPanel'
import { useCalendarSideList } from './useCalendarSideList'
import { useCalendarViewport } from './useCalendarViewport'

/** The hours of a day, top to bottom. */
const HOURS = Array.from({ length: 24 }, (_, i) => i)

/**
 * The calendar's state in one place, wired from its parts (view, data, layout, panel, gestures, menu) and shared
 * with the calendar's pieces through provide / inject.
 */
export function useTaskCalendar(props: { workDays?: number[]; fill?: boolean }, openDay: (day: string) => void) {
  const view = useCalendarViewport(() => props.workDays)
  const g = ref<CalendarGesture>()
  const data = useCalendarData(view, () => !!g.value)
  const layout = useCalendarLayout(view, data, g)
  const panel = useCalendarPanel(view, data)
  const side = useCalendarSideList(data, panel)
  const gestures = useCalendarGestures(view, data, layout, panel, g)
  const menu = useCalendarMenu(data, gestures, panel)
  const state = {
    ...view,
    ...data,
    ...layout,
    ...panel,
    ...side,
    ...gestures,
    ...menu,
    g,
    /** The elements the state measures, bound in the pieces' templates as `:ref="els.x"` (a ref object as the target). */
    els: { canvas: view.canvas, body: view.body, head: view.head, curEl: side.curEl },
    openDay,
    toKey: dayKey,
    toNum: dayNum,
    fmt: fmtDay,
    cap: capFirst,
    hours: HOURS,
    formatHM,
    formatDuration,
    kindColor,
    entryIcon,
    HOUR,
    MINUTE,
  }
  provide(calendarKey, state)
  return state
}

export type TaskCalendarState = ReturnType<typeof useTaskCalendar>
const calendarKey: InjectionKey<TaskCalendarState> = Symbol('taskCalendar')

/** The calendar's state in its pieces. */
export function useCalendarState(): TaskCalendarState {
  const s = inject(calendarKey)
  if (!s) throw new Error('useCalendarState() outside TaskCalendar')
  return s
}
