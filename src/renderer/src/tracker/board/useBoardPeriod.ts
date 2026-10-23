import { computed, ref, watch, type Ref } from 'vue'
import { shiftDay } from '@shared/timeline'
import { todayKey } from '../../lib/today'
import { mondayOf } from '../../lib/useRange'

/** The shown period: the week of the chosen day, or any picked range (up to 62 days). */
export type BoardPeriod = { mode: 'week' } | { mode: 'range'; from: string; to: string }
const DAY_KEY = 'qa.work.day'
const PER_KEY = 'qa.work.period'

function readDay(): string {
  try {
    const v = localStorage.getItem(DAY_KEY)
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayKey.value
  } catch {
    return todayKey.value
  }
}
function readPeriod(): BoardPeriod {
  try {
    const v = JSON.parse(localStorage.getItem(PER_KEY) ?? 'null') as BoardPeriod | null
    return v?.mode === 'range' && v.from && v.to ? v : { mode: 'week' }
  } catch {
    return { mode: 'week' }
  }
}
function store(key: string, v: string): void {
  try {
    localStorage.setItem(key, v)
  } catch {
    // fine
  }
}

/** A choice kept in localStorage under `key` (one of `values`, `def` otherwise). */
export function rememberedChoice<T extends string>(key: string, values: T[], def: T): Ref<T> {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(key)
  } catch {
    // not remembered
  }
  const r = ref(values.includes(saved as T) ? (saved as T) : def) as Ref<T>
  watch(r, (v) => store(key, v))
  return r
}

/**
 * The board's chosen day and period, both remembered («today» is stored as today: the next day it is the
 * next day); a range keeps the chosen day inside it; ‹ › and the wheel move the whole period.
 */
export function useBoardPeriod() {
  const day = ref(readDay())
  watch(day, (d) => store(DAY_KEY, d === todayKey.value ? 'today' : d))
  watch(todayKey, (now, was) => {
    if (day.value === was) day.value = now
  })
  const per = ref<BoardPeriod>(readPeriod())
  watch(per, (v) => store(PER_KEY, JSON.stringify(v)))

  const weekStart = computed(() => (per.value.mode === 'range' ? per.value.from : mondayOf(day.value)))
  const weekEnd = computed(() => (per.value.mode === 'range' ? per.value.to : shiftDay(weekStart.value, 6)))
  // a range keeps the chosen day inside it
  watch(
    [weekStart, weekEnd],
    ([a, b]) => {
      if (day.value < a || day.value > b) day.value = todayKey.value >= a && todayKey.value <= b ? todayKey.value : a
    },
    { immediate: true },
  )
  const spanDays = computed(() => Math.round((new Date(`${weekEnd.value}T12:00:00`).getTime() - new Date(`${weekStart.value}T12:00:00`).getTime()) / 86_400_000) + 1)
  /** ‹ › move the whole period. */
  function shiftPeriod(dir: 1 | -1): void {
    const p = per.value
    if (p.mode === 'week') day.value = shiftDay(day.value, dir * 7)
    else {
      const n = spanDays.value * dir
      per.value = { mode: 'range', from: shiftDay(p.from, n), to: shiftDay(p.to, n) }
      day.value = shiftDay(day.value, n)
    }
  }
  /** The wheel over the period: one period per notch, a touchpad not racing. */
  let wheelAt = 0
  function onNavWheel(e: WheelEvent): void {
    if (!e.deltaY || performance.now() - wheelAt < 90) return
    wheelAt = performance.now()
    shiftPeriod(e.deltaY < 0 ? 1 : -1)
  }
  /** Back to the week of the chosen day. */
  const toWeek = () => (per.value = { mode: 'week' })
  const weekTitle = computed(() => {
    const f = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', o)
    return `${f(weekStart.value, { day: 'numeric' })} – ${f(weekEnd.value, { day: 'numeric', month: 'short' })}`
  })
  return { day, per, weekStart, weekEnd, shiftPeriod, onNavWheel, toWeek, weekTitle }
}
