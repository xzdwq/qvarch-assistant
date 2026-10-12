import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { cutCursor, dayKey } from '@shared/timeline'
import type { DayData, LiveStatus } from '@shared/types'

const empty = (day: string): DayData => ({ day, spans: [], activity: [], calls: [], entries: [], notes: [] })

/** A ticking clock shared by components (1s resolution). */
export function useNow(intervalMs = 1000): Ref<number> {
  const now = ref(Date.now())
  const t = setInterval(() => (now.value = Date.now()), intervalMs)
  onBeforeUnmount(() => clearInterval(t))
  return now
}

/**
 * Reactive data of one day. Today's data is pushed live from the main process;
 * other days are fetched on demand and refreshed after own edits via `reload()`.
 */
export function useDay(day: Ref<string>) {
  const data = shallowRef<DayData>(empty(day.value))
  const live = ref<LiveStatus>({ now: Date.now(), idle: false, inCall: false })
  const now = useNow()
  const isToday = computed(() => day.value === dayKey(now.value))

  async function reload(): Promise<void> {
    const requested = day.value
    const d = await window.qa.getDay(requested)
    if (requested === day.value) data.value = d
  }

  const off = window.qa.onDayState((msg) => {
    live.value = msg.live
    if (msg.day.day === day.value) data.value = msg.day
  })
  onBeforeUnmount(off)
  watch(day, () => void reload(), { immediate: true })
  void window.qa.getLive().then((l) => (live.value = l))

  /** End of the visible timeline: "now" for today, end of last span otherwise. */
  const end = computed(() => {
    if (isToday.value) return now.value
    const spans = data.value.spans
    return spans.length ? Math.max(...spans.map((s) => s.end)) : 0
  })

  const cursor = computed(() => cutCursor(data.value.entries, data.value.spans, end.value))

  return { data, live, now, isToday, end, cursor, reload }
}
