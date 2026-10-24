<script setup lang="ts">
import { isProductive } from '@shared/kinds'
import { isCall, isMeeting } from '@shared/work'
import NoteLinks from '../components/NoteLinks.vue'
import AttrChips from '../components/AttrChips.vue'
import { computed, reactive, ref, watch } from 'vue'
import { formatDuration, formatHM, shiftDay } from '@shared/timeline'
import type { Entry, Note, PlanBlock } from '@shared/types'
import Icon from '../components/Icon.vue'
import FilterMenu from '../components/FilterMenu.vue'
import EntryModal from '../components/EntryModal.vue'
import DateRangePicker from '../components/DateRangePicker.vue'
import { entryIcon, kindColor, kindLabel, kinds } from '../lib/palette'
import { todayKey } from '../lib/today'
import { mondayOf, useRange } from '../lib/useRange'
import { useNow } from '../lib/useDay'

/**
 * «Моя работа» · Список: everything of a period as one list — blocks, meetings, calls, notes, the day plans —
 * filtered by type, kind, task and text, grouped by day with the day's time. A row opens its day.
 */
const emit = defineEmits<{ openDay: [day: string, entryId?: string] }>()

type Period = 'today' | 'week' | 'month' | 'd30' | 'custom'
type Kind = 'event' | 'meeting' | 'call' | 'note' | 'plan'
const KEY = 'qa.work.list'
/** The list's filters (kept between visits); `task` — any block, only with a task, only without. */
const DEFAULT_FILTER = { period: 'week' as Period, from: '', to: '', types: [] as Kind[], kinds: [] as string[], task: 'any' as 'any' | 'with' | 'without', q: '', desc: true, onlyProd: true }
type ListFilter = typeof DEFAULT_FILTER
const TASK_FILTERS: Record<ListFilter['task'], (task?: { key: string }) => boolean> = {
  any: () => true,
  with: (task) => !!task,
  without: (task) => !task,
}
const st = reactive(read())
function read(): ListFilter {
  try {
    return { ...DEFAULT_FILTER, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ListFilter>) }
  } catch {
    return { ...DEFAULT_FILTER }
  }
}
watch(st, (v) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    // fine
  }
})

/** The last day of a month (YYYY-MM-DD of any day in it). */
const monthEnd = (d: string) => shiftDay(`${shiftDay(`${d.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1)
// the old presets (Сегодня, Неделя…) become their dates — the period is always dates now
{
  const t = todayKey.value
  const old = st.period as Period
  if (old !== 'custom' || !st.from || !st.to) {
    const PRESET_DATES: Record<Period, () => [string, string]> = {
      today: () => [t, t],
      week: () => [mondayOf(t), shiftDay(mondayOf(t), 6)],
      month: () => [`${t.slice(0, 7)}-01`, monthEnd(t)],
      d30: () => [shiftDay(t, -29), t],
      custom: () => [st.from || t, st.to || t],
    }
    // anything else stored (an unknown old preset) — this week
    const r = (Object.hasOwn(PRESET_DATES, old) ? PRESET_DATES[old] : PRESET_DATES.week)()
    st.from = r[0]
    st.to = r[1]
    st.period = 'custom'
  }
}
const range = computed<[string, string]>(() => [st.from || todayKey.value, st.to || todayKey.value])
const spanDays = () => Math.round((new Date(`${st.to}T12:00:00`).getTime() - new Date(`${st.from}T12:00:00`).getTime()) / 86_400_000) + 1
/** The period is a whole month (the 1st to its last day). */
const wholeMonth = () => st.from.endsWith('-01') && st.to === monthEnd(st.from)
/** ‹ › and the wheel: a day by a day, a month by a month, any range by its length. */
function shift(dir: 1 | -1): void {
  if (wholeMonth()) {
    const d = new Date(`${st.from}T12:00:00`)
    d.setMonth(d.getMonth() + dir)
    const a = d.toLocaleDateString('sv-SE').slice(0, 7) + '-01'
    st.from = a
    st.to = monthEnd(a)
    return
  }
  const n = spanDays() * dir
  st.from = shiftDay(st.from, n)
  st.to = shiftDay(st.to, n)
}
let wheelAt = 0
function onWheel(e: WheelEvent): void {
  if (!e.deltaY || performance.now() - wheelAt < 90) return
  wheelAt = performance.now()
  shift(e.deltaY < 0 ? 1 : -1)
}
const hasToday = computed(() => st.from <= todayKey.value && todayKey.value <= st.to)
/** «Сегодня»: the same kind of period, around today (a day — today, a week — this week, a month — this month). */
function goToday(): void {
  const t = todayKey.value
  const n = spanDays()
  if (wholeMonth()) [st.from, st.to] = [`${t.slice(0, 7)}-01`, monthEnd(t)]
  else if (n === 7 && new Date(`${st.from}T12:00:00`).getDay() === 1) [st.from, st.to] = [mondayOf(t), shiftDay(mondayOf(t), 6)]
  else [st.from, st.to] = [shiftDay(t, -(n - 1)), t]
}
const from = computed(() => range.value[0])
const to = computed(() => range.value[1])
const { days, reload } = useRange(from, to)
/** The event opened in the window. */
const editing = ref<{ day: string; entry: Entry }>()
const now = useNow(5_000)
const isLive = (e: Entry) => e.start <= now.value && e.end >= now.value - 90_000 && (e.source === 'detected' || e.end > now.value)
const TYPES = [
  { id: 'event', label: 'События' },
  { id: 'meeting', label: 'Встречи' },
  { id: 'call', label: 'Созвоны' },
  { id: 'note', label: 'Заметки' },
  { id: 'plan', label: 'План дня' },
]
const kindOpts = computed(() => kinds.value.map((k) => ({ id: k.id, label: k.label, color: k.color })))
const rangeOpen = ref(false)
const rangeEl = ref<HTMLElement>()
const rangeText = computed(() => {
  const f = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  return from.value === to.value ? f(from.value) : `${f(from.value)} – ${f(to.value)}`
})

type Item =
  | { t: 'entry'; type: Kind; day: string; id: string; at: number; e: Entry }
  | { t: 'note'; type: 'note'; day: string; id: string; at: number; n: Note }
  | { t: 'plan'; type: 'plan'; day: string; id: string; at: number; p: PlanBlock }
const typeOf = (e: Entry): Kind => (isMeeting(e) ? 'meeting' : isCall(e) ? 'call' : 'event')
const items = computed<Item[]>(() => {
  const s = st.q.trim().toLowerCase()
  const out: Item[] = []
  const typeOk = (t: Kind) => !st.types.length || st.types.includes(t)
  const kindOk = (k: string) => (!st.onlyProd || isProductive(kinds.value, k)) && (!st.kinds.length || st.kinds.includes(k))
  const taskOk = TASK_FILTERS[st.task] ?? TASK_FILTERS.without
  const textOk = (...xs: Array<string | undefined>) => !s || xs.some((x) => x?.toLowerCase().includes(s))
  for (const d of days.value) {
    for (const e of d.entries)
      if (typeOk(typeOf(e)) && kindOk(e.kind) && taskOk(e.task) && textOk(e.label, e.description, e.task?.key, e.task?.summary, kindLabel(e.kind)))
        out.push({ t: 'entry', type: typeOf(e), day: d.day, id: e.id, at: e.start, e })
    if (typeOk('note') && !st.kinds.length && st.task !== 'with') for (const n of d.notes) if (textOk(n.text)) out.push({ t: 'note', type: 'note', day: d.day, id: n.id, at: n.at, n })
    if (typeOk('plan')) for (const p of d.plan) if (!p.doneEntryId && kindOk(p.kind) && taskOk(p.task) && textOk(p.label, p.task?.key, p.task?.summary)) out.push({ t: 'plan', type: 'plan', day: d.day, id: p.id, at: p.start, p })
  }
  return out.sort((a, b) => (st.desc ? b.at - a.at : a.at - b.at))
})
/** Union length (parallel blocks counted once). */
function union(list: Array<{ start: number; end: number }>): number {
  const s = [...list].sort((a, b) => a.start - b.start)
  let sum = 0
  let cs = -Infinity
  let ce = -Infinity
  for (const x of s) {
    if (x.start > ce) {
      if (ce > cs) sum += ce - cs
      cs = x.start
      ce = x.end
    } else ce = Math.max(ce, x.end)
  }
  return sum + (ce > cs ? ce - cs : 0)
}
const groups = computed(() => {
  const map = new Map<string, Item[]>()
  for (const it of items.value) map.set(it.day, [...(map.get(it.day) ?? []), it])
  return [...map].map(([day, list]) => ({
    day,
    list,
    ms: union(list.flatMap((i) => (i.t === 'entry' ? [i.e] : []))),
    title: (() => {
      const s = new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
      return s.charAt(0).toUpperCase() + s.slice(1)
    })(),
  }))
})
const total = computed(() => groups.value.reduce((s, g) => s + g.ms, 0))
const counts = computed(() => ({ entries: items.value.filter((i) => i.t === 'entry').length, notes: items.value.filter((i) => i.t === 'note').length }))
const anyFilter = computed(() => !!(st.types.length || st.kinds.length || st.task !== 'any' || st.q))
function reset(): void {
  st.types = []
  st.kinds = []
  st.task = 'any'
  st.q = ''
}

/** The list as CSV (Excel opens it: ; separated, UTF-8 with a BOM). */
function exportCsv(): void {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`
  const rows = [['Дата', 'Начало', 'Конец', 'Минут', 'Тип', 'Вид', 'Задача', 'Название', 'Описание'].join(';')]
  for (const it of [...items.value].sort((a, b) => a.at - b.at)) {
    if (it.t === 'note') rows.push([it.day, formatHM(it.n.at), '', '', 'Заметка', '', '', q(it.n.text.split('\n')[0]), q(it.n.text)].join(';'))
    else {
      const x = it.t === 'entry' ? it.e : it.p
      rows.push([it.day, formatHM(x.start), formatHM(x.end), String(Math.round((x.end - x.start) / 60_000)), TYPES.find((t) => t.id === it.type)?.label ?? '', q(kindLabel(x.kind)), x.task?.key ?? '', q(x.label), q(it.t === 'entry' ? (it.e.description ?? '') : '')].join(';'))
    }
  }
  const url = URL.createObjectURL(new Blob([`﻿${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `qvarch-${from.value}_${to.value}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="wl tw:flex tw:flex-col tw:h-full tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-0 tw:pl-14 tw:gap-8">
    <div class="bar tw:flex tw:items-center tw:gap-8 tw:flex-none tw:whitespace-nowrap tw:overflow-hidden">
      <span class="pnav tw:inline-flex tw:flex-none tw:items-center tw:gap-2" title="Колесо мыши — на день / период вперёд или назад" @wheel.prevent="onWheel">
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Назад" @click="shift(-1)"><Icon name="chevronLeft" :size="14" /></button>
        <button ref="rangeEl" class="pl tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-text tw:font-data tw:text-[12.5px] tw:whitespace-nowrap tw:[&.on]:border-accent/60" :class="{ on: rangeOpen }" title="Выбрать день или период" @click="rangeOpen = !rangeOpen"><Icon name="calendar" :size="12" />{{ rangeText }}</button>
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Вперёд" @click="shift(1)"><Icon name="chevronRight" :size="14" /></button>
        <button v-if="!hasToday" class="today tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-[12.5px] tw:whitespace-nowrap tw:ml-4 tw:text-accent-fg tw:font-[inherit]" title="К сегодняшнему дню (тот же вид периода)" @click="goToday">Сегодня</button>
      </span>
      <DateRangePicker v-if="rangeOpen" :from="from" :to="to" :anchor="rangeEl" @apply="(a, b) => ((st.from = a), (st.to = b), (st.period = 'custom'), (rangeOpen = false))" @close="rangeOpen = false" />
      <button class="tog tw:[.seg_button+&]:not-[&.on]:border-l tw:[.seg_button+&]:not-[&.on]:border-l-border-2 tw:inline-flex tw:items-center tw:h-28 tw:py-0 tw:px-10 tw:rounded-r2 tw:border tw:border-border tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-text tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:not-[.seg_button+&]:not-[&.on]:border-border-3" :class="{ on: st.onlyProd }" title="Только продуктивные виды (без обеда, перерыва…)" @click="st.onlyProd = !st.onlyProd">Продуктивные</button>
      <FilterMenu v-model="st.types" label="Тип" icon="layers" :options="TYPES" />
      <FilterMenu v-model="st.kinds" label="Вид" icon="tag" :options="kindOpts" />
      <span class="seg tw:inline-flex tw:flex-none tw:border tw:border-border-2 tw:rounded-r2 tw:overflow-hidden">
        <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:py-0 tw:px-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12px] tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:[&.on]:bg-accent-soft tw:[&.on]:text-accent-fg" :class="{ on: st.task === 'any' }" @click="st.task = 'any'">Все</button>
        <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:py-0 tw:px-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12px] tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:[&.on]:bg-accent-soft tw:[&.on]:text-accent-fg" :class="{ on: st.task === 'with' }" @click="st.task = 'with'">С задачей</button>
        <button class="tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:py-0 tw:px-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12px] tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:[&.on]:bg-accent-soft tw:[&.on]:text-accent-fg" :class="{ on: st.task === 'without' }" @click="st.task = 'without'">Без задачи</button>
      </span>
      <label class="search tw:inline-flex tw:items-center tw:gap-6 tw:flex-[0_1_220px] tw:min-w-120 tw:h-28 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-field tw:text-muted"><Icon name="search" :size="13" /><input class="tw:flex-1 tw:min-w-0 tw:p-0 tw:border-0 tw:bg-transparent tw:text-[12.5px]" v-model="st.q" placeholder="Текст, ABC-123…" spellcheck="false" /></label>
      <button v-if="anyFilter" class="ghost tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:inline-flex tw:items-center tw:gap-5 tw:flex-none tw:h-28 tw:py-0 tw:px-9 tw:text-[12px] tw:text-text-2" title="Сбросить фильтры" @click="reset"><Icon name="x" :size="12" />фильтры</button>
      <span class="grow tw:flex-1"></span>
      <button class="ghost tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:inline-flex tw:items-center tw:gap-5 tw:flex-none tw:h-28 tw:py-0 tw:px-9 tw:text-[12px] tw:text-text-2" :title="st.desc ? 'Сначала новые' : 'Сначала старые'" @click="st.desc = !st.desc"><Icon name="sort" :size="13" />{{ st.desc ? 'новые' : 'старые' }}</button>
      <button class="ghost tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:inline-flex tw:items-center tw:gap-5 tw:flex-none tw:h-28 tw:py-0 tw:px-9 tw:text-[12px] tw:text-text-2" title="Выгрузить список в CSV" @click="exportCsv"><Icon name="download" :size="13" />CSV</button>
    </div>
    <div class="sum cap tw:flex tw:gap-18 tw:flex-none tw:pt-2 tw:pr-2 tw:pb-0 tw:pl-2">
      <span>{{ rangeText }}</span>
      <span>Записей <b class="tw:text-text-hi tw:text-[12px]">{{ counts.entries }}</b></span>
      <span>Время <b class="tw:text-text-hi tw:text-[12px]">{{ formatDuration(total) }}</b></span>
      <span v-if="counts.notes">Заметок <b class="tw:text-text-hi tw:text-[12px]">{{ counts.notes }}</b></span>
    </div>
    <div class="list tw:flex-1 tw:min-h-0 tw:overflow-auto tw:pb-14">
      <section v-for="g in groups" :key="g.day" class="grp tw:mb-10 tw:border tw:border-border tw:rounded-r3 tw:bg-panel">
        <div class="gh tw:sticky tw:top-0 tw:z-1 tw:flex tw:items-center tw:gap-10 tw:h-32 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-12 tw:border-b tw:border-b-border tw:rounded-[var(--r3)_var(--r3)_0_0] tw:bg-panel-2">
          <span class="gt tw:text-[12.5px] tw:font-semibold tw:text-text-hi tw:[&.today]:text-accent-fg" :class="{ today: g.day === todayKey }">{{ g.title }}</span>
          <span class="gm num tw:font-data tw:tabular-nums tw:text-muted tw:text-[11.5px]">{{ g.list.length }} · {{ formatDuration(g.ms) }}</span>
          <button class="lnk tw:[.seg_button+&]:border-l tw:[.seg_button+&]:border-l-border-2 tw:inline-flex tw:ml-auto tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-accent-fg tw:hover:enabled:bg-hover tw:hover:enabled:not-[.seg_button+&]:border-border-3" title="Открыть день" @click="emit('openDay', g.day)"><Icon name="timeline" :size="12" /></button>
        </div>
        <template v-for="it in g.list" :key="it.id">
          <div v-if="it.t === 'note'" class="row note tw:flex tw:items-center tw:gap-10 tw:min-h-36 tw:my-0 tw:mx-6 tw:pt-3 tw:pr-8 tw:pb-3 tw:pl-6 tw:border-l-3 tw:border-l-(--c,var(--border-3)) tw:border-b tw:border-b-border tw:whitespace-nowrap tw:cursor-default tw:last:border-b-0 tw:hover:bg-hover tw:[--c:var(--warn)]" @click="emit('openDay', it.day)">
            <span class="tm num tw:font-data tw:tabular-nums tw:flex-none tw:w-92 tw:text-text-2 tw:text-[12px]">{{ formatHM(it.n.at) }}</span>
            <span class="kic tw:inline-flex tw:flex-none tw:text-(--c)"><Icon name="note" :size="13" /></span>
            <span class="tt tw:flex-1 tw:min-w-0 tw:flex tw:flex-col"><span class="ttl tw:overflow-hidden tw:text-ellipsis tw:text-[13px]">{{ it.n.text.split('\n')[0] || 'Заметка' }}</span><span v-if="it.n.text.includes('\n')" class="sub tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-[11.5px]">{{ it.n.text.split('\n').slice(1).join(' ') }}</span></span>
            <span class="badge nt tw:flex-none tw:py-0 tw:px-6 tw:rounded-r2 tw:text-[10.5px] tw:bg-warn/14 tw:text-warn-fg">заметка</span>
          </div>
          <div v-else-if="it.t === 'plan'" class="row plan tw:flex tw:items-center tw:gap-10 tw:min-h-36 tw:my-0 tw:mx-6 tw:pt-3 tw:pr-8 tw:pb-3 tw:pl-6 tw:border-l-3 tw:border-l-(--c,var(--border-3)) tw:border-b tw:border-b-border tw:whitespace-nowrap tw:cursor-default tw:last:border-b-0 tw:hover:bg-hover tw:[&&]:[border-left-style:dashed]" :style="{ '--c': kindColor(it.p.kind) }" @click="emit('openDay', it.day)">
            <span class="tm num tw:font-data tw:tabular-nums tw:flex-none tw:w-92 tw:text-text-2 tw:text-[12px]">{{ formatHM(it.p.start) }}–{{ formatHM(it.p.end) }}</span>
            <span class="kic tw:inline-flex tw:flex-none tw:text-(--c)"><Icon :name="entryIcon(it.p)" :size="13" /></span>
            <span class="tt tw:flex-1 tw:min-w-0 tw:flex tw:flex-col"><span class="ttl tw:overflow-hidden tw:text-ellipsis tw:text-[13px]">{{ it.p.label || kindLabel(it.p.kind) }}</span></span>
            <span v-if="it.p.task" class="tchip tw:flex-none tw:py-0 tw:px-7 tw:rounded-r2 tw:bg-info/16 tw:text-info-fg tw:font-data tw:text-[11px]">{{ it.p.task.key }}</span>
            <span class="badge pl tw:flex-none tw:py-0 tw:px-6 tw:rounded-r2 tw:text-[10.5px] tw:bg-accent-soft tw:text-accent-fg">план</span>
            <span class="du num tw:font-data tw:tabular-nums tw:flex-none tw:min-w-52 tw:text-right tw:text-text-2 tw:text-[12px]">{{ formatDuration(it.p.end - it.p.start) }}</span>
          </div>
          <div v-else class="row tw:group/row tw:flex tw:items-center tw:gap-10 tw:min-h-36 tw:my-0 tw:mx-6 tw:pt-3 tw:pr-8 tw:pb-3 tw:pl-6 tw:border-l-3 tw:border-l-(--c,var(--border-3)) tw:border-b tw:border-b-border tw:whitespace-nowrap tw:cursor-default tw:last:border-b-0 tw:hover:not-[&.live]:bg-hover tw:[&.live]:relative tw:[&.live]:overflow-hidden tw:[&.live]:[background:linear-gradient(90deg,color-mix(in_srgb,var(--c)_16%,transparent),transparent_70%)] tw:[&.live]:after:content-[''] tw:[&.live]:after:absolute tw:[&.live]:after:top-0 tw:[&.live]:after:bottom-0 tw:[&.live]:after:left-0 tw:[&.live]:after:w-[35%] tw:[&.live]:after:[background:linear-gradient(90deg,transparent,color-mix(in_srgb,var(--c)_22%,transparent),transparent)] tw:[&.live]:after:animate-[WorkList-live-sweep_2.6s_linear_infinite] tw:[&.live]:after:pointer-events-none" :class="{ live: isLive(it.e) }" :style="{ '--c': kindColor(it.e.kind) }" title="Открыть событие" @click="editing = { day: it.day, entry: it.e }">
            <span class="tm num tw:font-data tw:tabular-nums tw:flex-none tw:w-92 tw:text-text-2 tw:text-[12px]">{{ formatHM(it.e.start) }}–{{ formatHM(it.e.end) }}</span>
            <span class="kic tw:inline-flex tw:flex-none tw:text-(--c) tw:group-[.live]/row:animate-[WorkList-live-pulse_1.4s_ease-in-out_infinite]" :title="kindLabel(it.e.kind)"><Icon :name="entryIcon(it.e)" :size="13" /></span>
            <span class="tt tw:flex-1 tw:min-w-0 tw:flex tw:flex-col">
              <span class="ttl tw:overflow-hidden tw:text-ellipsis tw:text-[13px]">{{ it.e.label || kindLabel(it.e.kind) }}</span>
              <span v-if="it.e.description" class="sub tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-[11.5px]">{{ it.e.description.split('\n')[0] }}</span>
            </span>
            <span v-if="isLive(it.e)" class="lv tw:inline-flex tw:items-center tw:gap-5 tw:flex-none tw:py-0 tw:px-7 tw:rounded-r2 tw:bg-[color-mix(in_srgb,var(--c)_20%,transparent)] tw:text-text-hi tw:font-data tw:text-[10.5px] tw:tracking-[0.04em] tw:uppercase"><i class="tw:w-6 tw:h-6 tw:rounded-[50%] tw:[background:var(--c)] tw:[box-shadow:0_0_6px_var(--c)] tw:animate-[WorkList-live-blink_1s_steps(2)_infinite]"></i>идёт</span>
            <span v-if="it.e.task" class="tchip tw:flex-none tw:py-0 tw:px-7 tw:rounded-r2 tw:bg-info/16 tw:text-info-fg tw:font-data tw:text-[11px]" :title="it.e.task.summary">{{ it.e.task.key }}</span>
            <AttrChips :attrs="it.e.attrs" />
            <NoteLinks :id="it.e.id" />
            <span v-if="it.e.outlook" class="badge tw:flex-none tw:py-0 tw:px-6 tw:rounded-r2 tw:bg-info/16 tw:text-info-fg tw:text-[10.5px]">Outlook</span>
            <span class="kl tw:flex-none tw:w-90 tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-[11.5px] tw:text-right">{{ kindLabel(it.e.kind) }}</span>
            <span class="du num tw:font-data tw:tabular-nums tw:flex-none tw:min-w-52 tw:text-right tw:text-text-2 tw:text-[12px]">{{ formatDuration(it.e.end - it.e.start) }}</span>
          </div>
        </template>
      </section>
      <EntryModal v-if="editing" :day="editing.day" :entry="editing.entry" @close="editing = undefined" @changed="reload" />
      <p v-if="!groups.length" class="none tw:text-muted tw:text-[12.5px]">Ничего не найдено{{ anyFilter ? ' — попробуйте сбросить фильтры' : '' }}.</p>
    </div>
  </div>
</template>
