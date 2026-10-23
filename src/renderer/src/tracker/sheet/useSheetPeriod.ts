import { computed, reactive, ref, watch } from 'vue'
import { daysBetween } from '@shared/report'
import { onNewDay } from '../../lib/today'
import { MAX_DAYS, periodDays, periodKey, periodOfRange, shiftPeriod, type SheetMode, type SheetPeriod } from '@shared/tracker/sheetPeriod'
import { readStored, writeStored } from './sheetStorage'

/** What the period reads from the sheet's props. */
export interface SheetPeriodProps {
  widget?: boolean
  /** The day it follows (the timeline's). */
  day?: string
  /** Embedded: these days, no bar of its own. */
  range?: { from: string; to: string }
}

/** Today as a day key. */
export const sheetToday = () => new Date().toLocaleDateString('sv-SE')
/** A day formatted for the header. */
export const fmtDay = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', o)

/**
 * The sheet's period: a day, a week or any range picked on the calendar — remembered under `suffix`
 * (the dashboard's apart); "today" is remembered as today, so the next day it shows the new day.
 */
export function useSheetPeriod(props: SheetPeriodProps, suffix: string) {
  const VIEW_KEY = `qa.sheet.view${suffix}`
  const saved = readStored<{ mode?: SheetMode; anchor?: string; from?: string; to?: string }>(VIEW_KEY, {})
  // fields change one by one (only a field really changed wakes what reads it — no needless reloads)
  const period = reactive<SheetPeriod>({
    mode: saved.mode ?? (props.widget ? 'day' : 'week'),
    anchor: !saved.anchor || saved.anchor === 'today' ? sheetToday() : saved.anchor,
    from: saved.from ?? sheetToday(),
    to: saved.to ?? sheetToday(),
  })
  const set = (next: Partial<SheetPeriod>) => Object.assign(period, next)
  watch([() => period.mode, () => period.anchor, () => period.from, () => period.to], () =>
    writeStored(VIEW_KEY, { mode: period.mode, anchor: period.anchor === sheetToday() ? 'today' : period.anchor, from: period.from, to: period.to }),
  )
  onNewDay((prev, next) => {
    if (period.anchor === prev) set({ anchor: next })
  })
  // the timeline's day: the period moves to it (a day or the week holding it)
  watch(
    () => props.day,
    (d) => {
      if (!d) return
      if (period.mode === 'range') set({ mode: 'day' })
      set({ anchor: d })
    },
    { immediate: true },
  )

  const mode = computed(() => period.mode)
  const cols = computed(() => (props.range ? daysBetween(props.range.from, props.range.to).slice(0, MAX_DAYS) : periodDays(period)))
  /** Where rows added by hand are remembered. */
  const key = computed(() => periodKey(period))
  const pickerOpen = ref(false)

  /** The calendar's pick. */
  function applyRange(from: string, to: string): void {
    pickerOpen.value = false
    set(periodOfRange(period, from, to))
  }
  /** Day / week switch (from a range: the day it holds today, or its first). */
  function setMode(m: 'day' | 'week'): void {
    if (period.mode === 'range') set({ anchor: cols.value.includes(sheetToday()) ? sheetToday() : cols.value[0] })
    set({ mode: m })
  }
  function goToday(): void {
    if (period.mode === 'range') set({ mode: props.widget ? 'day' : 'week' })
    set({ anchor: sheetToday() })
  }
  function shift(dir: 1 | -1): void {
    set(shiftPeriod(period, dir))
  }
  /** The wheel over the period: up — later, down — earlier (as every date field). */
  function onWheel(e: WheelEvent): void {
    if (e.deltaY) shift(e.deltaY < 0 ? 1 : -1)
  }

  const label = computed(() => {
    const a = cols.value[0]
    const b = cols.value[cols.value.length - 1]
    return cols.value.length === 1 ? fmtDay(a, { weekday: 'short', day: 'numeric', month: 'short' }) : `${fmtDay(a, { day: 'numeric', month: a.slice(5, 7) === b.slice(5, 7) ? undefined : 'short' })} – ${fmtDay(b, { day: 'numeric', month: 'short' })}`
  })
  const isCurrent = computed(() => cols.value.includes(sheetToday()))

  return { mode, cols, key, pickerOpen, applyRange, setMode, goToday, shift, onWheel, label, isCurrent }
}
