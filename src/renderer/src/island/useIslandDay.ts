import { computed, shallowRef } from 'vue'
import { productiveSplit, workDayMs } from '@shared/kinds'
import { noteEntry } from '@shared/notes'
import { clipEntries, dayStart, formatDuration, formatHM, MINUTE, scheduleRanges, shiftDay } from '@shared/timeline'
import type { Entry, Note } from '@shared/types'
import { noteIcon } from '@shared/tracker/constants'
import { countdownText, islandDateText, kindTotals, pillItems, chipText, taskTotals } from '@shared/tracker/islandPill'
import { kindLabel, kinds } from '../lib/palette'
import { recentLabels } from '../lib/recent'
import { todayKey } from '../lib/today'
import { useDay } from '../lib/useDay'
import type { IslandSettings } from './useIslandSettings'

/**
 * Today as the island shows it: the day's data, the schedule, productive time against the work day, totals,
 * the pill's chips, the next meeting, note titles.
 */
export function useIslandDay({ settings, ui }: IslandSettings) {
  const today = todayKey
  const { data, live, now, cursor } = useDay(today)

  const yesterday = shallowRef<Entry[]>([])
  void window.qa.getDay(shiftDay(today.value, -1)).then((d) => (yesterday.value = d.entries))
  const recent = computed(() => recentLabels(data.value.entries, yesterday.value))

  const schedule = computed(() => (settings.value ? scheduleRanges(today.value, settings.value.schedule) : {}))
  /** Kinds offered as buttons (hidden ones stay in settings and on old blocks). */
  const shownKinds = computed(() => kinds.value.filter((k) => !k.hidden))

  /** Official work time of today without lunch; 0 on a day off. */
  const workMs = computed(() => {
    const s = settings.value?.schedule
    return s ? workDayMs(today.value, s, new Date(dayStart(today.value)).getDay()) : 0
  })
  const dayOff = computed(() => !!settings.value && workMs.value === 0)
  /** Blocks so far (planned parts not counted). */
  const doneEntries = computed(() => clipEntries(data.value.entries, now.value))
  /** Productive time inside working hours (the base of "% of the work day") and over time (outside / day off). */
  const split = computed(() => productiveSplit(doneEntries.value, kinds.value, schedule.value.work, schedule.value.lunch))
  const productive = computed(() => split.value.total)
  /** 100% = the whole official work day filled with productive blocks; over time is shown separately. */
  const productivePct = computed(() => (workMs.value ? Math.min(100, Math.round((split.value.within / workMs.value) * 100)) : 0))
  const pctTitle = computed(() =>
    workMs.value
      ? `Полезное время в рабочие часы: ${formatDuration(split.value.within)} из ${formatDuration(workMs.value)} рабочего дня (без перерывов и обеда)`
      : 'Выходной — рабочего дня нет',
  )
  /** Time per kind / per linked task so far today, longest first. */
  const kindTotalsToday = computed(() => kindTotals(doneEntries.value))
  const taskTotalsToday = computed(() => taskTotals(doneEntries.value))

  const status = computed(() => (live.value.inCall ? { text: 'Созвон', cls: 'call' } : { text: 'Работаю', cls: 'work' }))
  const dateText = computed(() => islandDateText(dayStart(today.value)))

  /** The next Outlook meeting today (the countdown on the slim pill). */
  const nextMeeting = computed(() => data.value.entries.filter((e) => e.outlook && e.start > now.value).sort((a, b) => a.start - b.start)[0])
  const nextIn = computed(() => (nextMeeting.value ? countdownText(nextMeeting.value.start - now.value) : ''))

  /** The collapsed pill's chips (all blocks as equal chips, independent of the expanded timeline's zoom). */
  const chips = computed(() =>
    pillItems({ entries: data.value.entries, notes: data.value.notes, plan: data.value.plan, showPlan: ui.value.pill.plan, now: now.value, workMs: workMs.value }),
  )
  const chipLabel = (ms: number) => chipText(ms, workMs.value)
  /** One-line summary for the collapsed pill (the call app and its duration). */
  const pillInfo = computed(() => {
    const l = live.value
    if (!l.inCall) return ''
    const call = [...data.value.calls].reverse().find((c) => now.value - c.end < 2 * MINUTE)
    return `${l.callApp ?? 'Созвон'}${call ? ` · ${formatDuration(now.value - call.start)}` : ''}`
  })

  /** A text note — the note icon; a voice note — a mic; a call recording — a phone. */
  function noteTitle(n: Note): string {
    const e = noteEntry(n, data.value.entries)
    return `Заметка ${formatHM(n.at)}${e ? ` · ${kindLabel(e.kind)}${e.label && e.label !== kindLabel(e.kind) ? ` «${e.label}»` : ''}` : ''}\n${n.text}`
  }

  return {
    today,
    data,
    live,
    now,
    cursor,
    recent,
    schedule,
    shownKinds,
    workMs,
    dayOff,
    split,
    productive,
    productivePct,
    pctTitle,
    kindTotals: kindTotalsToday,
    taskTotals: taskTotalsToday,
    status,
    dateText,
    nextMeeting,
    nextIn,
    chips,
    chipLabel,
    pillInfo,
    noteIcon,
    noteTitle,
  }
}

export type IslandDay = ReturnType<typeof useIslandDay>
