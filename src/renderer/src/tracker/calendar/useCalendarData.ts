import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { isProductive } from '@shared/kinds'
import { OWN_PREFIX } from '@shared/board'
import type { DayData, Entry } from '@shared/types'
import { kindLabel, kinds } from '../../lib/palette'
import { useLocalTasks } from '../../lib/tasks'
import { dayKey } from '@shared/tracker/calendarDays'
import type { CalendarViewport } from './useCalendarViewport'

/** What a calendar day needs of the stored day. */
export type CalendarDay = Pick<DayData, 'day' | 'entries' | 'notes' | 'plan'>

const CHUNK = 30

/**
 * The calendar's data: days loaded in 30-day chunks around the view, reloaded on a change elsewhere (not while the
 * user drags here — `busy`), the search / productive filter, the time per task.
 */
export function useCalendarData(view: CalendarViewport, busy: () => boolean) {
  const own = useLocalTasks()
  const nowMs = ref(Date.now())
  const days = shallowRef(new Map<string, CalendarDay>())
  const loaded = new Set<number>()
  /** Time per task over all days. */
  const totals = ref<Record<string, number>>({})
  let loading = false
  async function ensure(): Promise<void> {
    if (loading) return
    const want: number[] = []
    for (let c = Math.floor((view.firstDay.value - CHUNK) / CHUNK); c <= Math.floor((view.lastDay.value + CHUNK) / CHUNK); c++) if (!loaded.has(c)) want.push(c)
    if (!want.length) return
    loading = true
    try {
      const from = dayKey(Math.min(...want) * CHUNK)
      const to = dayKey((Math.max(...want) + 1) * CHUNK - 1)
      const list = await window.qa.calendarRange(from, to)
      const m = new Map(days.value)
      for (const [k] of m) if (k >= from && k <= to) m.delete(k)
      for (const d of list) m.set(d.day, d)
      for (const c of want) loaded.add(c)
      days.value = m
    } finally {
      loading = false
    }
    void ensure()
  }
  /** The days in view read again (after a change made here). */
  async function reloadVisible(): Promise<void> {
    for (let c = Math.floor((view.firstDay.value - 1) / CHUNK); c <= Math.floor((view.lastDay.value + 1) / CHUNK); c++) loaded.delete(c)
    await ensure()
    totals.value = await window.qa.jiraTracked()
  }
  let ensureTimer: ReturnType<typeof setTimeout> | undefined
  watch([view.firstDay, view.lastDay], () => {
    clearTimeout(ensureTimer)
    ensureTimer = setTimeout(() => void ensure(), 60)
  })
  void ensure().then(async () => (totals.value = await window.qa.jiraTracked()))
  let last = 0
  const off = window.qa.onDayState(() => {
    nowMs.value = Date.now()
    // a change elsewhere (island, sync) — but not while the user drags here
    if (Date.now() - last > 15_000 && !busy()) {
      last = Date.now()
      void reloadVisible()
    }
  })
  onBeforeUnmount(() => {
    off()
    clearTimeout(ensureTimer)
  })

  const search = computed(() => view.q.value.trim().toLowerCase())
  /** The filters: only productive kinds, the search in the title / task / description. */
  const visibleEntry = (e: Entry) =>
    (!view.onlyProductive.value || isProductive(kinds.value, e.kind)) &&
    (!search.value || e.label.toLowerCase().includes(search.value) || (e.task?.key.toLowerCase().includes(search.value) ?? false) || (e.description ?? '').toLowerCase().includes(search.value))
  /** An event's title: its own task's title, its label, its kind. */
  const titleOf = (e: Entry) => {
    const t = e.task && e.task.key.startsWith(OWN_PREFIX) ? own.value.find((x) => x.key === e.task!.key) : undefined
    return (t?.title ?? e.label) || kindLabel(e.kind)
  }
  /** An event and its day among the loaded ones. */
  const findEntry = (id: string): { e: Entry; day: string } | undefined => {
    for (const [day, d] of days.value) {
      const e = d.entries.find((x) => x.id === id)
      if (e) return { e, day }
    }
    return undefined
  }

  return { nowMs, days, totals, reloadVisible, visibleEntry, titleOf, findEntry }
}

export type CalendarData = ReturnType<typeof useCalendarData>
