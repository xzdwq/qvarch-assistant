import { computed, inject, onBeforeUnmount, onMounted, provide, ref, watch, type InjectionKey } from 'vue'
import { shiftDay } from '@shared/timeline'
import { daysBetween, matches, unionOf, type RangeDay, type ReportFilter, type ReportGroupBy, type ReportItem } from '@shared/report'
import { isProductive } from '@shared/kinds'
import { eventsOf, heatOf } from '@shared/analytics'
import type { Entry } from '@shared/types'
import { kindColor, kindLabel, kinds } from '../../lib/palette'
import { onNewDay, todayKey } from '../../lib/today'
import { isRecord, readStored, writeStored } from '../../lib/storedRef'
import { periodLabel, periodRange, previousRange, rangeLabel, shiftedPeriod, type Period } from '@shared/tracker/reportPeriod'
import { kpiCards, reportInsights, type KindLook } from '@shared/tracker/reportStats'
import type { ChartColor } from '@shared/tracker/reportChart'

/** What the report shows — remembered between sessions (the anchor is always today on start). */
export interface ReportState {
  period: Period
  anchor: string
  from: string
  to: string
  filter: ReportFilter
  group: ReportGroupBy
  color: ChartColor
  /** Only the productive kinds (no lunch, break…) — as the calendar's button. */
  onlyProd?: boolean
}

const STATE_KEY = 'qa.reports'

/** The palette as pure code wants it. */
export const KIND_LOOK: KindLook = { label: kindLabel, color: kindColor }

/** Loads the days of a range; a newer request wins over a slower older one. */
function useRangeDays(range: () => [string, string]) {
  const days = ref<RangeDay[]>([])
  const loading = ref(false)
  let seq = 0
  async function load(): Promise<void> {
    const my = ++seq
    loading.value = true
    try {
      const [a, b] = range()
      const r = await window.qa.rangeDays(a, b)
      if (my === seq) days.value = r
    } finally {
      if (my === seq) loading.value = false
    }
  }
  return { days, loading, load }
}

/**
 * The report's state shared by its parts: the period, the loaded days, the filtered items and the totals
 * built from them. Created once by ReportsView, read by its parts through `useReports()`.
 */
function createReportsState() {
  const today = todayKey.value
  const DEFAULT: ReportState = { period: 'week', anchor: today, from: shiftDay(today, -6), to: today, filter: {}, group: 'kind', color: 'kind', onlyProd: true }
  const st = ref<ReportState>({ ...DEFAULT, ...readStored<Partial<ReportState>>(STATE_KEY, {}, isRecord), anchor: today })
  watch(st, (v) => writeStored(STATE_KEY, { ...v, anchor: undefined }), { deep: true })
  onNewDay((prev, next) => {
    if (st.value.anchor === prev) st.value.anchor = next
  })

  // ---------- the period ----------
  const range = computed<[string, string]>(() => periodRange(st.value))
  const allDays = computed(() => daysBetween(range.value[0], range.value[1]))
  /** A period forward (1) or back (-1). */
  const shift = (dir: 1 | -1) => Object.assign(st.value, shiftedPeriod(st.value, dir))
  const isCurrent = computed(() => st.value.period !== 'custom' && range.value[0] <= todayKey.value && todayKey.value <= range.value[1])
  const label = computed(() => periodLabel(st.value.period, range.value))
  const customLabel = computed(() => rangeLabel(range.value))

  // ---------- the data ----------
  const { days, loading, load } = useRangeDays(() => range.value)
  watch(range, () => void load(), { immediate: true })
  // back to the window — something may have been added meanwhile
  const onFocus = () => void load()
  onMounted(() => window.addEventListener('focus', onFocus))
  onBeforeUnmount(() => window.removeEventListener('focus', onFocus))

  /** What was spent: the future (meetings ahead) is not counted, a block going on now counts up to now. */
  const all = computed<ReportItem[]>(() => {
    const now = Date.now()
    return days.value.flatMap((d) => d.entries.filter((e) => e.start < now).map((e) => ({ day: d.day, e: e.end > now ? { ...e, end: now } : e })))
  })
  const shownKind = (e: Entry) => !st.value.onlyProd || isProductive(kinds.value, e.kind)
  const items = computed(() => all.value.filter((i) => shownKind(i.e) && matches(i.e, st.value.filter)))

  /** The same length of time right before — to compare with. */
  const prevRange = computed(() => previousRange(range.value))
  const prevDays = ref<RangeDay[]>([])
  watch(
    prevRange,
    async (r) => {
      const got = await window.qa.rangeDays(r[0], r[1])
      if (r === prevRange.value) prevDays.value = got
    },
    { immediate: true },
  )
  const prevItems = computed<ReportItem[]>(() => prevDays.value.flatMap((d) => d.entries.map((e) => ({ day: d.day, e }))).filter((i) => shownKind(i.e) && matches(i.e, st.value.filter)))

  // ---------- filters ----------
  /** One filter field as a v-model (a new filter object on each change — the watcher stores it). */
  const filterField = (k: 'kinds' | 'tasks' | 'taskType' | 'sources') =>
    computed<string[]>({ get: () => st.value.filter[k] ?? [], set: (v) => (st.value.filter = { ...st.value.filter, [k]: v } as ReportFilter) })
  const fKinds = filterField('kinds')
  /** An attribute's filter as a v-model (the values wanted; '' — without a value). */
  const attrField = (id: string) =>
    computed<string[]>({ get: () => st.value.filter.attrs?.[id] ?? [], set: (v) => (st.value.filter = { ...st.value.filter, attrs: { ...st.value.filter.attrs, [id]: v } }) })

  // ---------- totals ----------
  const total = computed(() => unionOf(items.value))
  const kpi = computed(() => kpiCards(items.value, prevItems.value, allDays.value, KIND_LOOK))
  const events = computed(() => eventsOf(items.value, allDays.value))
  const heat = computed(() => heatOf(items.value))
  const insights = computed(() => reportInsights({ items: items.value, total: total.value, events: events.value, kpi: kpi.value, days: allDays.value, heat: heat.value, kindLabel }))

  return { st, range, allDays, shift, isCurrent, label, customLabel, days, loading, load, all, items, filterField, fKinds, attrField, total, kpi, events, heat, insights }
}

export type ReportsState = ReturnType<typeof createReportsState>
const REPORTS: InjectionKey<ReportsState> = Symbol('reports')

/** Creates the report's state and hands it to the parts below. */
export function provideReports(): ReportsState {
  const s = createReportsState()
  provide(REPORTS, s)
  return s
}
/** The report's state (inside ReportsView). */
export function useReports(): ReportsState {
  const s = inject(REPORTS)
  if (!s) throw new Error('useReports() outside ReportsView')
  return s
}
