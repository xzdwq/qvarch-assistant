import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { dayStart, HOUR } from '@shared/timeline'
import { todayKey } from '../../lib/today'
import { dayNum, leadOf, weekdayOf } from '@shared/tracker/calendarDays'
import { hourPxFor, subLinesFor, ZY_MAX, ZY_MIN } from '@shared/tracker/calendarLayout'

const MIN_SPAN = 1
const MAX_SPAN = 366
const STORE_KEY = 'qa.tcal2'

/** Zoom presets of the toolbar. */
export const ZOOM_PRESETS: Array<{ label: string; days: number }> = [
  { label: 'День', days: 1 },
  { label: 'Неделя', days: 7 },
  { label: 'Месяц', days: 31 },
  { label: 'Квартал', days: 92 },
  { label: 'Год', days: 365 },
]

function readSaved(): { span?: number; productive?: boolean; zy?: number } {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as { span?: number; productive?: boolean; zy?: number }
  } catch {
    return {}
  }
}

/**
 * What the calendar shows: `span` days starting at day `start` (fractional), the hour scale, the filters (remembered),
 * the strip's elements and their sizes.
 */
export function useCalendarViewport(workDays: () => number[] | undefined) {
  const today = todayKey
  const todayNum = computed(() => dayNum(today.value))
  const isOff = (n: number) => !(workDays() ?? [1, 2, 3, 4, 5]).includes(weekdayOf(n))

  const saved = readSaved()
  const span = ref(Math.min(MAX_SPAN, Math.max(MIN_SPAN, saved.span ?? 7)))
  // opens with today in the middle (the saved zoom kept)
  const start = ref(todayNum.value + 0.5 - span.value / 2)
  const onlyProductive = ref(saved.productive ?? false)
  /** The vertical scale (the time step): the wheel over the hours changes it. */
  const zy = ref(Math.min(ZY_MAX, Math.max(ZY_MIN, saved.zy ?? 1)))
  const q = ref('')
  watch([span, onlyProductive, zy], () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ span: Math.round(span.value * 100) / 100, productive: onlyProductive.value, zy: Math.round(zy.value * 1000) / 1000 }))
    } catch {
      // not remembered — fine
    }
  })

  const canvas = ref<HTMLElement>()
  const body = ref<HTMLElement>()
  const head = ref<HTMLElement>()
  const W = ref(1000)
  const H = ref(600)
  const hourPx = computed(() => hourPxFor(H.value, zy.value))
  const subLines = computed(() => subLinesFor(hourPx.value))
  const yOf = (t: number, day: string) => ((t - dayStart(day)) / HOUR) * hourPx.value
  let ro: ResizeObserver | undefined
  onMounted(() => {
    ro = new ResizeObserver(() => {
      if (canvas.value) W.value = canvas.value.clientWidth
      if (body.value) H.value = body.value.clientHeight
    })
    if (canvas.value) ro.observe(canvas.value)
    if (body.value) ro.observe(body.value)
    // the current time in the middle of the view (once the sizes are known)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const b = body.value
        if (!b) return
        const d = new Date()
        const h = d.getHours() + d.getMinutes() / 60
        b.scrollTop = Math.max(0, h * hourPx.value - b.clientHeight / 2)
      }),
    )
  })
  onBeforeUnmount(() => ro?.disconnect())

  /** The width of one day at this zoom; a day with parallel events is wider (see widthOf). */
  const colW = computed(() => W.value / span.value)
  const firstDay = computed(() => Math.floor(start.value))
  const lastDay = computed(() => Math.ceil(start.value + span.value))
  const visibleNums = computed(() => Array.from({ length: lastDay.value - firstDay.value + 1 }, (_, i) => firstDay.value + i))
  /** Day / week zoom: days are cards with gaps between them. */
  const roomy = computed(() => colW.value >= 90)
  const GUT = computed(() => (roomy.value ? 8 : colW.value > 12 ? 1 : 0))
  /**
   * The window's scale (CSS zoom on <main>): pointer coordinates and rects come scaled, the layout (hourPx, colW) does not —
   * pointer distances are divided by it before they meet the layout.
   */
  const zf = () => (canvas.value as (HTMLElement & { currentCSSZoom?: number }) | undefined)?.currentCSSZoom || 1

  /** `days` in view, around today when it is shown (else around the middle). */
  function zoomTo(days: number): void {
    const centre = todayNum.value >= start.value && todayNum.value <= start.value + span.value ? todayNum.value + 0.5 : start.value + span.value / 2
    const frac = (centre - start.value) / span.value
    span.value = days
    start.value = days <= 1 ? Math.floor(centre) : centre - frac * days
  }
  /** Ctrl + wheel: zoom around the pointer at `fx` (0..1 across the strip). */
  function zoomAround(fx: number, deltaY: number): void {
    const at = start.value + fx * span.value
    const next = Math.min(MAX_SPAN, Math.max(MIN_SPAN, span.value * Math.exp(deltaY * 0.0016)))
    span.value = next
    start.value = at - fx * next
  }
  function goToday(): void {
    start.value = todayNum.value - leadOf(span.value)
  }
  const nearPreset = computed(() => ZOOM_PRESETS.reduce((a, b) => (Math.abs(Math.log(b.days / span.value)) < Math.abs(Math.log(a.days / span.value)) ? b : a)).days)
  function resetHours(): void {
    zy.value = 1
  }

  return { today, todayNum, isOff, span, start, onlyProductive, zy, q, canvas, body, head, W, H, hourPx, subLines, yOf, colW, firstDay, lastDay, visibleNums, roomy, GUT, zf, zoomTo, zoomAround, goToday, nearPreset, resetHours, PRESETS: ZOOM_PRESETS }
}

export type CalendarViewport = ReturnType<typeof useCalendarViewport>
