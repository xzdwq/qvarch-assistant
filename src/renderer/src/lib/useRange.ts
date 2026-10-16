import { onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'
import { shiftDay } from '@shared/timeline'
import type { DayData } from '@shared/types'

export type RangeDay = Pick<DayData, 'day' | 'entries' | 'notes'> & { plan: NonNullable<DayData['plan']>; dayTasks: NonNullable<DayData['dayTasks']> }

/** Monday of a day's week. */
export function mondayOf(day: string): string {
  const wd = new Date(`${day}T12:00:00`).getDay()
  return shiftDay(day, -((wd + 6) % 7))
}

/**
 * Every day of a range (`from`…`to`, both included) — days without data come empty. A day changed anywhere
 * (pushed by the main process) is replaced in place; `reload()` after own edits.
 */
export function useRange(from: Ref<string>, to: Ref<string>) {
  const days = shallowRef<RangeDay[]>([])
  async function reload(): Promise<void> {
    const a = from.value
    const b = to.value
    if (!a || !b || a > b) return void (days.value = [])
    const got = new Map((await window.qa.calendarRange(a, b)).map((d) => [d.day, d]))
    if (a !== from.value || b !== to.value) return
    const out: RangeDay[] = []
    for (let d = a; d <= b; d = shiftDay(d, 1)) {
      const x = got.get(d)
      out.push({ day: d, entries: x?.entries ?? [], notes: x?.notes ?? [], plan: x?.plan ?? [], dayTasks: x?.dayTasks ?? [] })
    }
    days.value = out
  }
  watch([from, to], () => void reload(), { immediate: true })
  const off = window.qa.onDayState((msg) => {
    const i = days.value.findIndex((d) => d.day === msg.day.day)
    if (i < 0) return
    const next = [...days.value]
    next[i] = { day: msg.day.day, entries: msg.day.entries, notes: msg.day.notes, plan: msg.day.plan ?? [], dayTasks: msg.day.dayTasks ?? [] }
    days.value = next
  })
  onBeforeUnmount(off)
  return { days, reload }
}
