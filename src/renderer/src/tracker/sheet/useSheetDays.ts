import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { RangeDay } from '@shared/report'
import { kinds } from '../../lib/palette'
import { readStored, storedRef } from './sheetStorage'

/**
 * The sheet's days: loaded for the columns (again on window focus), today's blocks come live (the island,
 * a call, another window) with no reload; the kind filter (remembered under `suffix`) narrows what counts.
 */
export function useSheetDays(cols: Ref<string[]>, suffix: string) {
  const days = ref<RangeDay[]>([])
  const busy = ref(false)
  async function load(): Promise<void> {
    const from = cols.value[0]
    const r = await window.qa.rangeDays(from, cols.value[cols.value.length - 1])
    // a reply for a period left meanwhile is dropped
    if (from === cols.value[0]) days.value = r
  }
  watch(cols, () => void load(), { immediate: true })
  const onFocus = () => void load()
  onMounted(() => window.addEventListener('focus', onFocus))
  onBeforeUnmount(() => window.removeEventListener('focus', onFocus))
  const dayOf = (d: string) => days.value.find((x) => x.day === d)
  const offDay = window.qa.onDayState((msg) => {
    const d = msg.day
    if (!cols.value.includes(d.day)) return
    const cur = dayOf(d.day)
    if (cur && cur.entries === d.entries) return
    const next = { day: d.day, entries: d.entries }
    days.value = cur ? days.value.map((x) => (x.day === d.day ? next : x)) : [...days.value, next]
  })
  onBeforeUnmount(offDay)

  const KINDS_KEY = `qa.sheet.kinds${suffix}`
  const kindFilter = storedRef<string[]>(KINDS_KEY, readStored<string[]>(KINDS_KEY, [], (v): v is string[] => Array.isArray(v)))
  const kindOpts = computed(() => kinds.value.map((k) => ({ id: k.id, label: k.label, color: k.color })))
  const shownKind = (k: string) => !kindFilter.value.length || kindFilter.value.includes(k)
  /** A day's blocks of the kinds shown. */
  const entriesOf = (d: RangeDay | undefined) => (d?.entries ?? []).filter((e) => shownKind(e.kind))
  /** Kinds in the settings' order (unknown ones last). */
  const kindOrder = (k: string) => {
    const i = kinds.value.findIndex((x) => x.id === k)
    return i < 0 ? 99 : i
  }

  return { days, busy, load, dayOf, kindFilter, kindOpts, shownKind, entriesOf, kindOrder }
}
