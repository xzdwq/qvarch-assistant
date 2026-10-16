<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatDuration, formatHM, shiftDay } from '@shared/timeline'
import { bars, daysBetween, groupItems, matches, sourceOf, taskType, unionOf, weekStart, type GroupBy, type RangeDay, type ReportFilter, type ReportItem } from '@shared/report'
import { entryIcon, kindColor, kindLabel, kinds } from '../lib/palette'
import Icon from '../components/Icon.vue'
import FilterMenu from '../components/FilterMenu.vue'
import DateRangePicker from '../components/DateRangePicker.vue'
import { onNewDay } from '../lib/today'
import { dailyByKind, eventsOf, heatOf, type EventStat } from '@shared/analytics'
import Spark from '../components/charts/Spark.vue'
import Treemap, { type TreeItem } from '../components/charts/Treemap.vue'
import Heatmap from '../components/charts/Heatmap.vue'
import Donut from '../components/charts/Donut.vue'
import AreaStack from '../components/charts/AreaStack.vue'

/**
 * Отчёты — where the time went over a period: totals, a chart by day / week / month and a breakdown by
 * kind / task / day / week (two levels deep, down to the blocks). Filters and the view are remembered;
 * a view can be saved under a name.
 */
const emit = defineEmits<{ go: [view: 'day', day?: string, entryId?: string] }>()

type Period = 'day' | 'week' | 'month' | 'year' | 'custom'
interface State {
  period: Period
  anchor: string
  from: string
  to: string
  filter: ReportFilter
  group: GroupBy
  color: 'kind' | 'task'
}
interface Saved {
  name: string
  state: Omit<State, 'anchor' | 'from' | 'to'> & { from?: string; to?: string }
}
const today = () => new Date().toLocaleDateString('sv-SE')
const KEY = 'qa.reports'
const SAVED = 'qa.reports.saved'
function readJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
    return v ?? fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // not remembered — fine
  }
}
const DEFAULT: State = { period: 'week', anchor: today(), from: shiftDay(today(), -6), to: today(), filter: {}, group: 'kind', color: 'kind' }
const st = ref<State>({ ...DEFAULT, ...readJson<Partial<State>>(KEY, {}), anchor: today() })
watch(st, (v) => writeJson(KEY, { ...v, anchor: undefined }), { deep: true })
onNewDay((prev, next) => {
  if (st.value.anchor === prev) st.value.anchor = next
})

// ---------- the period ----------
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'year', label: 'Год' },
  { id: 'custom', label: 'Период' },
]
const range = computed<[string, string]>(() => {
  const a = st.value.anchor
  switch (st.value.period) {
    case 'day':
      return [a, a]
    case 'week':
      return [weekStart(a), shiftDay(weekStart(a), 6)]
    case 'month': {
      const first = `${a.slice(0, 7)}-01`
      const next = new Date(`${first}T12:00:00`)
      next.setMonth(next.getMonth() + 1, 0)
      return [first, next.toLocaleDateString('sv-SE')]
    }
    case 'year':
      return [`${a.slice(0, 4)}-01-01`, `${a.slice(0, 4)}-12-31`]
    default:
      return st.value.from <= st.value.to ? [st.value.from, st.value.to] : [st.value.to, st.value.from]
  }
})
function shift(dir: 1 | -1): void {
  const s = st.value
  if (s.period === 'custom') {
    const len = daysBetween(range.value[0], range.value[1]).length
    s.from = shiftDay(range.value[0], dir * len)
    s.to = shiftDay(range.value[1], dir * len)
    return
  }
  if (s.period === 'day') s.anchor = shiftDay(s.anchor, dir)
  else if (s.period === 'week') s.anchor = shiftDay(s.anchor, dir * 7)
  else {
    const d = new Date(`${s.anchor.slice(0, 7)}-01T12:00:00`)
    if (s.period === 'month') d.setMonth(d.getMonth() + dir)
    else d.setFullYear(d.getFullYear() + dir)
    s.anchor = d.toLocaleDateString('sv-SE')
  }
}
const isCurrent = computed(() => st.value.period !== 'custom' && range.value[0] <= today() && today() <= range.value[1])
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', o)
const periodLabel = computed(() => {
  const [a, b] = range.value
  switch (st.value.period) {
    case 'day':
      return fmt(a, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    case 'week':
      return `${fmt(a, { day: 'numeric', month: a.slice(5, 7) === b.slice(5, 7) ? undefined : 'short' })} – ${fmt(b, { day: 'numeric', month: 'short' })}`
    case 'month': {
      const s = fmt(a, { month: 'long', year: 'numeric' }).replace(' г.', '')
      return s[0].toUpperCase() + s.slice(1)
    }
    case 'year':
      return a.slice(0, 4)
    default:
      return ''
  }
})

const rangeOpen = ref(false)
const rangeEl = ref<HTMLElement>()
const customLabel = computed(() => {
  const [a, b] = range.value
  return a === b ? fmt(a, { day: 'numeric', month: 'short', year: 'numeric' }) : `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`
})

// ---------- the data ----------
const days = ref<RangeDay[]>([])
const loading = ref(false)
let seq = 0
async function load(): Promise<void> {
  const my = ++seq
  loading.value = true
  try {
    const r = await window.qa.rangeDays(range.value[0], range.value[1])
    if (my === seq) days.value = r
  } finally {
    if (my === seq) loading.value = false
  }
}
watch(range, () => void load(), { immediate: true })
// back to the window — something may have been added meanwhile
function onFocus(): void {
  void load()
}
onMounted(() => window.addEventListener('focus', onFocus))
onBeforeUnmount(() => window.removeEventListener('focus', onFocus))

/** What was spent: the future (meetings ahead) is not counted, a block going on now counts up to now. */
const all = computed<ReportItem[]>(() => {
  const now = Date.now()
  return days.value.flatMap((d) => d.entries.filter((e) => e.start < now).map((e) => ({ day: d.day, e: e.end > now ? { ...e, end: now } : e })))
})
const items = computed(() => all.value.filter((i) => matches(i.e, st.value.filter)))

/** The same length of time right before — to compare with. */
const prevRange = computed<[string, string]>(() => {
  const n = daysBetween(range.value[0], range.value[1]).length
  return [shiftDay(range.value[0], -n), shiftDay(range.value[0], -1)]
})
const prevDays = ref<RangeDay[]>([])
watch(prevRange, async (r) => {
  const got = await window.qa.rangeDays(r[0], r[1])
  if (r === prevRange.value) prevDays.value = got
}, { immediate: true })
const prevItems = computed<ReportItem[]>(() => prevDays.value.flatMap((d) => d.entries.map((e) => ({ day: d.day, e }))).filter((i) => matches(i.e, st.value.filter)))

// ---------- filters ----------
const kindOpts = computed(() => kinds.value.map((k) => ({ id: k.id, label: k.label, color: k.color })))
const taskOpts = computed(() => {
  const m = new Map<string, string>()
  for (const i of all.value) if (i.e.task) m.set(i.e.task.key, i.e.task.summary)
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([id, s]) => ({ id, label: id, hint: s }))
})
const TYPE_OPTS = [
  { id: 'jira', label: 'Jira', color: '#3b82f6' },
  { id: 'own', label: 'Свои задачи', color: '#a78bfa' },
  { id: 'none', label: 'Без задачи', color: '#64748b' },
]
const SOURCE_OPTS = [
  { id: 'outlook', label: 'Outlook', color: '#0ea5e9' },
  { id: 'call', label: 'Найденные созвоны', color: '#14b8a6' },
  { id: 'manual', label: 'Вручную', color: '#94a3b8' },
]
const fKinds = computed({ get: () => st.value.filter.kinds ?? [], set: (v) => (st.value.filter = { ...st.value.filter, kinds: v }) })
const fTasks = computed({ get: () => st.value.filter.tasks ?? [], set: (v) => (st.value.filter = { ...st.value.filter, tasks: v }) })
const fType = computed({ get: () => (st.value.filter.taskType ?? []) as string[], set: (v) => (st.value.filter = { ...st.value.filter, taskType: v as ReportFilter['taskType'] }) })
const fSource = computed({ get: () => (st.value.filter.sources ?? []) as string[], set: (v) => (st.value.filter = { ...st.value.filter, sources: v as ReportFilter['sources'] }) })
const anyFilter = computed(() => {
  const x = st.value.filter
  return !!(x.kinds?.length || x.tasks?.length || x.taskType?.length || x.sources?.length || x.text?.trim())
})

// ---------- saved views ----------
const saved = ref<Saved[]>(readJson<Saved[]>(SAVED, []))
watch(saved, (v) => writeJson(SAVED, v), { deep: true })
const savedOpen = ref(false)
const newName = ref('')
function saveView(): void {
  const name = newName.value.trim()
  if (!name) return
  const s = st.value
  const state = { period: s.period, filter: JSON.parse(JSON.stringify(s.filter)) as ReportFilter, group: s.group, color: s.color, ...(s.period === 'custom' ? { from: s.from, to: s.to } : {}) }
  saved.value = [...saved.value.filter((x) => x.name !== name), { name, state }]
  newName.value = ''
}
function applyView(v: Saved): void {
  st.value = { ...st.value, ...v.state, filter: JSON.parse(JSON.stringify(v.state.filter)) as ReportFilter, anchor: today() }
  savedOpen.value = false
}
const savedEl = ref<HTMLElement>()
function onDown(e: MouseEvent): void {
  if (savedOpen.value && !savedEl.value?.contains(e.target as Node)) savedOpen.value = false
}
onMounted(() => window.addEventListener('mousedown', onDown, true))
onBeforeUnmount(() => window.removeEventListener('mousedown', onDown, true))

// ---------- totals ----------
const total = computed(() => unionOf(items.value))
const activeDays = computed(() => new Set(items.value.map((i) => i.day)).size)
const kpi = computed(() => {
  const byDay = new Map<string, ReportItem[]>()
  for (const i of items.value) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i])
  const make = (label: string, pred: (i: ReportItem) => boolean, color?: string, main = false) => {
    const ms = unionOf(items.value.filter(pred))
    const prev = unionOf(prevItems.value.filter(pred))
    return { label, ms, prev, color, main, spark: allDays.value.map((d) => unionOf((byDay.get(d) ?? []).filter(pred))) }
  }
  const prevActive = new Set(prevItems.value.map((i) => i.day)).size
  const avg = { label: 'В среднем за день', ms: activeDays.value ? total.value / activeDays.value : 0, prev: prevActive ? unionOf(prevItems.value) / prevActive : 0, color: undefined as string | undefined, main: false, spark: [] as number[] }
  return [
    make('Всего', () => true, undefined, true),
    avg,
    make('Jira', (i) => taskType(i.e) === 'jira', '#448aff'),
    make('Созвоны', (i) => i.e.kind === 'call', kindColor('call')),
    make('Встречи', (i) => i.e.kind === 'meeting' || !!i.e.outlook, kindColor('meeting')),
  ]
})
/** The change against the previous period, % (none when there was nothing before). */
const delta = (k: { ms: number; prev: number }) => (k.prev > 0 ? Math.round(((k.ms - k.prev) / k.prev) * 100) : undefined)

// ---------- analytics ----------
const events = computed(() => eventsOf(items.value, allDays.value))
const evLabel = (ev: EventStat) => (ev.task ? `${ev.task.key} ${ev.task.summary}`.trim() : ev.label || kindLabel(ev.kind))
const treeItems = computed<TreeItem[]>(() =>
  events.value.slice(0, 30).map((ev) => ({ label: ev.task ? ev.task.key : ev.label || kindLabel(ev.kind), sub: ev.task ? ev.task.summary : kindLabel(ev.kind), value: ev.ms, text: formatDuration(ev.ms), color: kindColor(ev.kind), title: `${evLabel(ev)} — ${formatDuration(ev.ms)} · ${ev.count} раз` })),
)
/** A tile → the report narrows to that event. */
function pickEvent(i: number): void {
  const ev = events.value[i]
  if (!ev) return
  if (ev.task) st.value.filter = { ...st.value.filter, tasks: [ev.task.key] }
  else st.value.filter = { ...st.value.filter, text: ev.label }
}
const donut = computed(() => groupItems(items.value, 'kind').map((g) => ({ key: g.key, label: kindLabel(g.key), value: g.ms, color: kindColor(g.key) })))
const daily = computed(() => dailyByKind(items.value, allDays.value))
const areaSeries = computed(() => daily.value.kinds.map((k) => ({ key: k, label: kindLabel(k), color: kindColor(k) })))
const areaLabels = computed(() => allDays.value.map((d) => fmt(d, { day: 'numeric', month: 'short' }).replace('.', '')))
const heat = computed(() => heatOf(items.value))
const evSort = ref<'ms' | 'count' | 'avg'>('ms')
const evShown = computed(() => [...events.value].sort((a, b) => b[evSort.value] - a[evSort.value]).slice(0, evAll.value ? 200 : 15))
const evAll = ref(false)
const evMax = computed(() => Math.max(1, ...events.value.map((e) => e.ms)))
/** A few plain sentences about the period. */
const insights = computed(() => {
  const out: Array<{ k: string; v: string; tone?: 'up' | 'down' | 'warn' }> = []
  const tot = total.value
  if (!tot) return out
  const top = events.value[0]
  if (top) out.push({ k: 'Больше всего', v: `${evLabel(top)} — ${formatDuration(top.ms)} (${Math.round((top.ms / tot) * 100)}%)` })
  const meet = kpi.value[4].ms + kpi.value[3].ms
  if (meet) out.push({ k: 'Встречи и созвоны', v: `${Math.round((meet / tot) * 100)}% времени`, tone: meet / tot > 0.5 ? 'warn' : undefined })
  const bus = allDays.value.map((d, i) => ({ d, ms: kpi.value[0].spark[i] ?? 0 })).sort((a, b) => b.ms - a.ms)[0]
  if (bus?.ms && allDays.value.length > 1) out.push({ k: 'Самый загруженный', v: `${fmt(bus.d, { weekday: 'short', day: 'numeric', month: 'short' })} — ${formatDuration(bus.ms)}` })
  const hours = heat.value.reduce((acc, row) => row.map((v, h) => v + (acc[h] ?? 0)), [] as number[])
  const ph = hours.indexOf(Math.max(...hours))
  if (hours[ph]) out.push({ k: 'Пик по часам', v: `${ph}:00–${ph + 1}:00` })
  const noTask = unionOf(items.value.filter((i) => !i.e.task && i.e.kind === 'task'))
  if (noTask) out.push({ k: 'Задачи без ключа', v: formatDuration(noTask), tone: 'warn' })
  const d = delta(kpi.value[0])
  if (d !== undefined) out.push({ k: 'К прошлому периоду', v: `${d > 0 ? '+' : ''}${d}%`, tone: d >= 0 ? 'up' : 'down' })
  return out
})

// ---------- the chart ----------
const TASK_COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#0ea5e9', '#84cc16', '#a855f7', '#ef4444', '#22d3ee', '#f97316']
/** The 9 biggest tasks get their colours, the rest are "другое". */
const topTasks = computed(() => groupItems(items.value, 'task').filter((g) => g.key).slice(0, 9).map((g) => g.key))
const seriesOf = (i: ReportItem) => (st.value.color === 'kind' ? i.e.kind : !i.e.task ? '' : topTasks.value.includes(i.e.task.key) ? i.e.task.key : '*')
const seriesColor = (s: string) => (st.value.color === 'kind' ? kindColor(s) : s === '' ? '#64748b' : s === '*' ? '#475569' : TASK_COLORS[topTasks.value.indexOf(s) % TASK_COLORS.length])
const seriesLabel = (s: string) => (st.value.color === 'kind' ? kindLabel(s) : s === '' ? 'Без задачи' : s === '*' ? 'Другие задачи' : s)
const allDays = computed(() => daysBetween(range.value[0], range.value[1]))
const unit = computed<'day' | 'week' | 'month'>(() => (allDays.value.length > 200 ? 'month' : allDays.value.length > 62 ? 'week' : 'day'))
const chart = computed(() => bars(items.value, allDays.value, unit.value, seriesOf))
const series = computed(() => {
  const m = new Map<string, number>()
  for (const b of chart.value) for (const [k, v] of b.parts) m.set(k, (m.get(k) ?? 0) + v)
  return [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k)
})
const HOUR = 3_600_000
const yMax = computed(() => {
  const max = Math.max(HOUR, ...chart.value.map((b) => b.total))
  const step = [1, 2, 4, 5, 10, 20, 25, 50, 100, 200].map((x) => x * HOUR).find((s) => max / s <= 4) ?? 500 * HOUR
  return { top: Math.ceil(max / step) * step, step }
})
const yTicks = computed(() => {
  const out: number[] = []
  for (let v = 0; v <= yMax.value.top; v += yMax.value.step) out.push(v)
  return out
})
/** A bar's parts scaled to its total (parts of different series may overlap in time). */
function segs(b: { parts: Map<string, number>; total: number }): Array<{ s: string; h: number }> {
  const sum = [...b.parts.values()].reduce((a, x) => a + x, 0) || 1
  return series.value.filter((s) => b.parts.get(s)).map((s) => ({ s, h: (((b.parts.get(s) ?? 0) / sum) * b.total * 100) / yMax.value.top }))
}
function barLabel(key: string): { top: string; sub?: string } {
  if (unit.value === 'day') return { top: fmt(key, { day: 'numeric' }), sub: allDays.value.length <= 14 ? fmt(key, { weekday: 'short' }) : undefined }
  if (unit.value === 'week') return { top: fmt(key, { day: 'numeric', month: 'short' }) }
  return { top: fmt(`${key}-01`, { month: 'short' }) }
}
const isOff = (key: string) => unit.value === 'day' && [0, 6].includes(new Date(`${key}T12:00:00`).getDay())
function barTitle(b: { key: string; parts: Map<string, number>; total: number }): string {
  const head = unit.value === 'day' ? fmt(b.key, { weekday: 'long', day: 'numeric', month: 'long' }) : unit.value === 'week' ? `Неделя с ${fmt(b.key, { day: 'numeric', month: 'long' })}` : fmt(`${b.key}-01`, { month: 'long', year: 'numeric' })
  return [`${head} — ${formatDuration(b.total)}`, ...series.value.filter((s) => b.parts.get(s)).map((s) => `${seriesLabel(s)}: ${formatDuration(b.parts.get(s)!)}`)].join('\n')
}
/** A day bar opens the day; a week / month bar narrows the report to it. */
function openBar(key: string): void {
  if (unit.value === 'day') emit('go', 'day', key)
  else {
    st.value.period = unit.value === 'week' ? 'week' : 'month'
    st.value.anchor = unit.value === 'week' ? key : `${key}-01`
  }
}

// ---------- the breakdown ----------
const GROUPS: Array<{ id: GroupBy; label: string }> = [
  { id: 'kind', label: 'Вид' },
  { id: 'task', label: 'Задача' },
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
]
const subBy = computed<GroupBy>(() => (st.value.group === 'kind' ? 'task' : 'kind'))
const groups = computed(() => groupItems(items.value, st.value.group))
const maxGroup = computed(() => Math.max(1, ...groups.value.map((g) => g.ms)))
const openKeys = ref(new Set<string>())
function flip(k: string): void {
  const s = new Set(openKeys.value)
  if (s.has(k)) s.delete(k)
  else s.add(k)
  openKeys.value = s
}
watch(() => st.value.group, () => (openKeys.value = new Set()))
const summaryOf = (key: string) => all.value.find((i) => i.e.task?.key === key)?.e.task?.summary ?? ''
function groupName(key: string, by: GroupBy): { name: string; sub?: string; color: string; icon?: string } {
  if (by === 'kind') return { name: kindLabel(key), color: kindColor(key) }
  if (by === 'task') return key ? { name: key, sub: summaryOf(key), color: key.startsWith('Q-') ? '#a78bfa' : '#3b82f6' } : { name: 'Без задачи', color: '#64748b' }
  if (by === 'day') return { name: fmt(key, { weekday: 'short', day: 'numeric', month: 'short' }), color: 'var(--accent)' }
  return { name: `${fmt(key, { day: 'numeric', month: 'short' })} – ${fmt(shiftDay(key, 6), { day: 'numeric', month: 'short' })}`, color: 'var(--accent)' }
}
/** Shares of the groups' sum (groups may overlap in time — the shares still add up to 100%). */
const groupSum = computed(() => groups.value.reduce((s, g) => s + g.ms, 0))
const pct = (ms: number) => (groupSum.value ? Math.round((ms / groupSum.value) * 100) : 0)

// ---------- export ----------
function exportCsv(): void {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  const rows = [['Дата', 'Начало', 'Конец', 'Часы', 'Вид', 'Задача', 'Название задачи', 'Запись', 'Источник'].join(';')]
  for (const i of [...items.value].sort((a, b) => a.e.start - b.e.start))
    rows.push([i.day, formatHM(i.e.start), formatHM(i.e.end), ((i.e.end - i.e.start) / HOUR).toFixed(2).replace('.', ','), q(kindLabel(i.e.kind)), i.e.task?.key ?? '', q(i.e.task?.summary ?? ''), q(i.e.label), sourceOf(i.e)].join(';'))
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `qvarch-${range.value[0]}_${range.value[1]}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
</script>

<template>
  <div class="rep">
    <!-- the bar: period · filters · grouping, actions -->
    <div class="bar">
      <div class="seg">
        <button v-for="p in PERIODS" :key="p.id" :class="{ on: st.period === p.id }" @click="st.period = p.id">{{ p.label }}</button>
      </div>
      <div class="nav">
        <button class="ib" title="Назад" @click="shift(-1)"><Icon name="chevronLeft" :size="14" /></button>
        <span v-if="st.period !== 'custom'" class="pl">{{ periodLabel }}</span>
        <button v-else ref="rangeEl" class="rng" :class="{ on: rangeOpen }" title="Выбрать период" @click="rangeOpen = !rangeOpen">
          <Icon name="calendar" :size="12" />{{ customLabel }}
        </button>
        <DateRangePicker v-if="rangeOpen" :from="range[0]" :to="range[1]" :anchor="rangeEl" @apply="(a, b) => ((st.from = a), (st.to = b), (rangeOpen = false))" @close="rangeOpen = false" />
        <button class="ib" title="Вперёд" @click="shift(1)"><Icon name="chevronRight" :size="14" /></button>
        <button v-if="!isCurrent && st.period !== 'custom'" class="ib" title="Сейчас" @click="st.anchor = today()"><Icon name="clock" :size="13" /></button>
      </div>
      <span class="sp"></span>
      <div class="filters">
        <FilterMenu v-model="fKinds" label="Вид" icon="tag" :options="kindOpts" />
        <FilterMenu v-model="fTasks" label="Задачи" icon="jira" :options="taskOpts" />
        <FilterMenu v-model="fType" label="Тип" icon="checkSquare" :options="TYPE_OPTS" title="Jira / свои / без задачи" />
        <FilterMenu v-model="fSource" label="Источник" icon="outlook" :options="SOURCE_OPTS" />
        <label class="srch" :class="{ on: st.filter.text }">
          <Icon name="search" :size="13" />
          <input :value="st.filter.text ?? ''" placeholder="Текст" @input="st.filter = { ...st.filter, text: ($event.target as HTMLInputElement).value }" />
        </label>
        <button v-if="anyFilter" class="ib" title="Сбросить фильтры" @click="st.filter = {}"><Icon name="x" :size="13" /></button>
      </div>
      <div class="acts">
        <div ref="savedEl" class="sv">
          <button class="ib" :class="{ on: savedOpen }" title="Сохранённые отчёты" @click="savedOpen = !savedOpen"><Icon name="star" :size="14" /></button>
          <div v-if="savedOpen" class="svd">
            <button v-for="v in saved" :key="v.name" class="svi" @click="applyView(v)">
              <Icon name="star" :size="12" />
              <span>{{ v.name }}</span>
              <span class="x" title="Удалить" @click.stop="saved = saved.filter((x) => x.name !== v.name)"><Icon name="x" :size="11" /></span>
            </button>
            <p v-if="!saved.length" class="none">Пока нет</p>
            <form class="svn" @submit.prevent="saveView">
              <input v-model="newName" placeholder="Сохранить как…" />
              <button type="submit" :disabled="!newName.trim()"><Icon name="check" :size="13" /></button>
            </form>
          </div>
        </div>
        <button class="ib" title="Экспорт CSV" :disabled="!items.length" @click="exportCsv"><Icon name="download" :size="14" /></button>
        <button class="ib" :class="{ spin: loading }" title="Обновить" @click="load"><Icon name="refresh" :size="14" /></button>
      </div>
    </div>

    <div class="body">
      <!-- the totals -->
      <div class="kpis">
        <div v-for="k in kpi" :key="k.label" class="kpi" :class="{ main: k.main }">
          <span class="kl"><i v-if="k.color" :style="{ background: k.color }"></i>{{ k.label }}</span>
          <span class="kv">
            <b>{{ formatDuration(k.ms) }}</b>
            <span v-if="delta(k) !== undefined" class="kd" :class="delta(k)! >= 0 ? 'up' : 'down'" :title="`Прошлый период: ${formatDuration(k.prev)}`">{{ delta(k)! >= 0 ? '▲' : '▼' }} {{ Math.abs(delta(k)!) }}%</span>
          </span>
          <Spark v-if="k.spark.length > 1" :values="k.spark" :color="k.color ?? 'var(--accent)'" :w="150" :h="20" class="ksp" />
        </div>
      </div>

      <!-- plain words -->
      <div v-if="insights.length" class="ins">
        <span v-for="x in insights" :key="x.k" class="in" :class="x.tone"><em>{{ x.k }}</em>{{ x.v }}</span>
      </div>

      <div class="ana">
        <section class="card s2">
          <div class="ch"><span class="ct">Куда ушло время</span><span class="sp"></span><span class="cm">{{ events.length }} событий · клик — отфильтровать</span></div>
          <Treemap :items="treeItems" :height="270" @pick="pickEvent" />
        </section>
        <section class="card">
          <div class="ch"><span class="ct">По видам</span></div>
          <Donut :parts="donut" @pick="(k) => (fKinds = [k])" />
        </section>
        <section v-if="allDays.length > 1" class="card s2">
          <div class="ch"><span class="ct">Динамика по видам</span></div>
          <AreaStack :labels="areaLabels" :series="areaSeries" :rows="daily.rows" :height="210" />
        </section>
        <section class="card" :class="{ s3: allDays.length <= 1 }">
          <div class="ch"><span class="ct">Когда я работаю</span></div>
          <Heatmap :matrix="heat" />
        </section>
        <section class="card s3">
          <div class="ch">
            <span class="ct">Топ событий</span>
            <span class="sp"></span>
            <div class="seg sm">
              <button :class="{ on: evSort === 'ms' }" @click="evSort = 'ms'">Время</button>
              <button :class="{ on: evSort === 'count' }" @click="evSort = 'count'">Раз</button>
              <button :class="{ on: evSort === 'avg' }" @click="evSort = 'avg'">Среднее</button>
            </div>
          </div>
          <div class="evt">
            <div class="evh"><span>Событие</span><span>Вид</span><span class="r">Раз</span><span class="r">Дней</span><span class="r">Среднее</span><span>Доля</span><span class="r">Всего</span><span>По дням</span></div>
            <button v-for="ev in evShown" :key="ev.key" class="evr" :title="evLabel(ev)" @click="ev.task ? (st.filter = { ...st.filter, tasks: [ev.task.key] }) : (st.filter = { ...st.filter, text: ev.label })">
              <span class="evn">
                <i :style="{ background: kindColor(ev.kind) }"></i>
                <b v-if="ev.task" class="evk">{{ ev.task.key }}</b>
                <span>{{ ev.task ? ev.task.summary : ev.label || kindLabel(ev.kind) }}</span>
              </span>
              <span class="evkind">{{ kindLabel(ev.kind) }}</span>
              <span class="r num">{{ ev.count }}</span>
              <span class="r num">{{ ev.days }}</span>
              <span class="r num">{{ formatDuration(ev.avg) }}</span>
              <span class="evb"><i :style="{ width: `${(ev.ms / evMax) * 100}%`, background: kindColor(ev.kind) }"></i><small>{{ total ? Math.round((ev.ms / total) * 100) : 0 }}%</small></span>
              <b class="r num">{{ formatDuration(ev.ms) }}</b>
              <Spark :values="ev.perDay" :color="kindColor(ev.kind)" :w="96" :h="18" />
            </button>
            <button v-if="events.length > 15" class="more" @click="evAll = !evAll">{{ evAll ? 'Свернуть' : `Показать все ${events.length}` }}</button>
            <p v-if="!events.length" class="none">{{ loading ? 'Загрузка…' : 'Нет записей за период' }}</p>
          </div>
        </section>
      </div>

      <!-- the chart -->
      <section v-if="allDays.length > 1" class="card">
        <div class="ch">
          <span class="ct">{{ unit === 'day' ? 'По дням' : unit === 'week' ? 'По неделям' : 'По месяцам' }}</span>
          <span class="sp"></span>
          <div class="seg sm">
            <button :class="{ on: st.color === 'kind' }" @click="st.color = 'kind'">Вид</button>
            <button :class="{ on: st.color === 'task' }" @click="st.color = 'task'">Задача</button>
          </div>
        </div>
        <div class="chart">
          <div class="yax">
            <span v-for="v in yTicks" :key="v" :style="{ bottom: `${(v / yMax.top) * 100}%` }">{{ v ? `${v / HOUR}ч` : '' }}</span>
          </div>
          <div class="plot">
            <div class="grid"><div v-for="v in yTicks" :key="`g${v}`" class="gl" :style="{ bottom: `${(v / yMax.top) * 100}%` }"></div></div>
            <button v-for="b in chart" :key="b.key" class="col" :class="{ off: isOff(b.key), today: b.key === today() }" :title="barTitle(b)" @click="openBar(b.key)">
              <span class="stack">
                <i v-for="p in segs(b)" :key="p.s" :style="{ height: `${p.h}%`, background: seriesColor(p.s) }"></i>
              </span>
              <span class="xl">{{ barLabel(b.key).top }}<small v-if="barLabel(b.key).sub">{{ barLabel(b.key).sub }}</small></span>
            </button>
          </div>
        </div>
        <div class="legend">
          <span v-for="s in series" :key="s"><i :style="{ background: seriesColor(s) }"></i>{{ seriesLabel(s) }}</span>
        </div>
      </section>

      <!-- the breakdown -->
      <section class="card">
        <div class="ch">
          <span class="ct">Разбивка</span>
          <span class="sp"></span>
          <div class="seg sm">
            <button v-for="g in GROUPS" :key="g.id" :class="{ on: st.group === g.id }" @click="st.group = g.id">{{ g.label }}</button>
          </div>
        </div>
        <!-- the shares in one line -->
        <div v-if="groups.length" class="share">
          <i v-for="g in groups.slice(0, 12)" :key="g.key" :style="{ flexGrow: g.ms, background: groupName(g.key, st.group).color }" :title="`${groupName(g.key, st.group).name} — ${formatDuration(g.ms)}`"></i>
        </div>
        <div class="tbl">
          <template v-for="g in groups" :key="g.key">
            <button class="gr" :class="{ open: openKeys.has(g.key) }" @click="flip(g.key)">
              <Icon name="chevronRight" :size="12" class="tw" />
              <i class="dot" :style="{ background: groupName(g.key, st.group).color }"></i>
              <span class="gn"><b>{{ groupName(g.key, st.group).name }}</b><small v-if="groupName(g.key, st.group).sub">{{ groupName(g.key, st.group).sub }}</small></span>
              <span class="gc">{{ g.count }}</span>
              <span class="gb"><i :style="{ width: `${(g.ms / maxGroup) * 100}%`, background: groupName(g.key, st.group).color }"></i></span>
              <b class="gh">{{ formatDuration(g.ms) }}</b>
              <span class="gp">{{ pct(g.ms) }}%</span>
            </button>
            <template v-if="openKeys.has(g.key)">
              <template v-for="s in groupItems(g.items, subBy)" :key="`${g.key}/${s.key}`">
                <button class="gr sub" :class="{ open: openKeys.has(`${g.key}/${s.key}`) }" @click="flip(`${g.key}/${s.key}`)">
                  <Icon name="chevronRight" :size="11" class="tw" />
                  <i class="dot" :style="{ background: groupName(s.key, subBy).color }"></i>
                  <span class="gn"><b>{{ groupName(s.key, subBy).name }}</b><small v-if="groupName(s.key, subBy).sub">{{ groupName(s.key, subBy).sub }}</small></span>
                  <span class="gc">{{ s.count }}</span>
                  <span class="gb"><i :style="{ width: `${(s.ms / maxGroup) * 100}%`, background: groupName(s.key, subBy).color }"></i></span>
                  <b class="gh">{{ formatDuration(s.ms) }}</b>
                  <span class="gp">{{ pct(s.ms) }}%</span>
                </button>
                <template v-if="openKeys.has(`${g.key}/${s.key}`)">
                  <button v-for="i in [...s.items].sort((a, b) => a.e.start - b.e.start)" :key="i.e.id" class="er" @click="emit('go', 'day', i.day, i.e.id)">
                    <span class="eic" :style="{ background: kindColor(i.e.kind) }"><Icon :name="entryIcon(i.e)" :size="10" :stroke="2.4" /></span>
                    <span class="ed">{{ fmt(i.day, { day: 'numeric', month: 'short' }) }}</span>
                    <span class="et">{{ formatHM(i.e.start) }}–{{ formatHM(i.e.end) }}</span>
                    <span class="el">{{ i.e.label }}</span>
                    <span class="eh">{{ formatDuration(i.e.end - i.e.start) }}</span>
                  </button>
                </template>
              </template>
            </template>
          </template>
          <p v-if="!groups.length" class="none">{{ loading ? 'Загрузка…' : 'Нет записей за период' }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.rep {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
/* the bar: wraps on a narrow window, groups stay together */
.bar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.sp {
  flex: 1;
}
.seg {
  display: inline-flex;
  padding: 2px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
}
.seg button {
  height: 24px;
  padding: 0 9px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.seg button:hover {
  color: var(--text);
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.25);
  color: var(--text-hi);
}
.seg.sm button {
  height: 22px;
  padding: 0 8px;
  font-size: 11.5px;
}
.nav,
.filters,
.acts {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.filters {
  gap: 5px;
  flex-wrap: wrap;
}
.pl {
  min-width: 110px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.dt {
  height: 26px;
  padding: 0 6px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 12px;
  color-scheme: dark;
}
.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
}
.ib:hover:not(:disabled),
.ib.on {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.ib:disabled {
  opacity: 0.4;
}
.ib.spin :deep(svg) {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.srch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
}
.srch.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
}
.srch input {
  width: 90px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
}
.sv {
  position: relative;
}
.svd {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 40;
  width: 230px;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--panel-2);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.svi {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.svi:hover {
  background: rgb(var(--accent-rgb) / 0.14);
}
.svi span:nth-child(2) {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.svi .x {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--r2);
  color: var(--muted);
}
.svi .x:hover {
  color: var(--down-fg);
}
.svn {
  display: flex;
  gap: 4px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}
.svn input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
}
.svn button {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r2);
  background: rgb(var(--accent-rgb) / 0.3);
  color: var(--text-hi);
}
.svn button:disabled {
  opacity: 0.4;
}
.none {
  margin: 8px;
  color: var(--muted);
  font-size: 12px;
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  container-type: inline-size;
  padding: 10px 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* totals */
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--panel);
}
.kpi.main {
  border-color: rgb(var(--accent-rgb) / 0.45);
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
}
.kl {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 11.5px;
  white-space: nowrap;
}
.kl i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.kpi b {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.kpi small {
  color: var(--muted);
  font-size: 11px;
}
.card {
  padding: 10px 12px;
  border-radius: var(--r3);
  border: 1px solid var(--border);
  background: var(--panel);
}
.ch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ct {
  font-size: 11px;
  font-family: var(--font-data);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}
/* the chart */
.chart {
  display: flex;
  height: 200px;
}
.yax {
  position: relative;
  flex: none;
  width: 34px;
  margin-bottom: 30px;
}
.yax span {
  position: absolute;
  right: 6px;
  transform: translateY(50%);
  color: var(--muted);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.plot {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
  gap: 3px;
}
.grid {
  position: absolute;
  inset: 0 0 30px 0;
  pointer-events: none;
}
.gl {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed rgba(255, 255, 255, 0.06);
}
.col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  cursor: pointer;
}
.col:hover {
  background: rgba(255, 255, 255, 0.04);
}
.col.off .xl {
  color: var(--dim);
}
.col.today .xl {
  color: var(--accent-fg);
  font-weight: 600;
}
.stack {
  flex: 1;
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
}
.stack i {
  width: min(70%, 34px);
  min-height: 0;
}
.stack i:first-child {
  border-radius: 0 0 var(--r2) var(--r2);
}
.stack i:last-child {
  border-top-left-radius: 4px;
  border-top-right-radius: 4px;
}
.xl {
  flex: none;
  height: 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  overflow: hidden;
  white-space: nowrap;
}
.xl small {
  color: var(--muted);
  font-size: 10px;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 6px;
  color: var(--muted);
  font-size: 11.5px;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend i {
  width: 9px;
  height: 9px;
  border-radius: var(--r2);
}
/* the breakdown */
.share {
  display: flex;
  gap: 2px;
  height: 8px;
  margin-bottom: 8px;
  border-radius: var(--r2);
  overflow: hidden;
}
.share i {
  min-width: 2px;
}
.tbl {
  display: flex;
  flex-direction: column;
}
.gr {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.gr:hover {
  background: rgba(255, 255, 255, 0.04);
}
.gr.sub {
  padding-left: 26px;
  font-size: 12px;
}
.tw {
  flex: none;
  color: var(--muted);
  transition: transform 0.15s;
}
.gr.open > .tw {
  transform: rotate(90deg);
}
.dot {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: var(--r2);
}
.gn {
  flex: 1 1 200px;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
}
.gn b {
  flex: none;
  font-weight: 600;
  white-space: nowrap;
}
.gn small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11.5px;
}
.gc {
  flex: none;
  width: 28px;
  color: var(--muted);
  font-size: 11px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.gb {
  flex: 0 1 180px;
  height: 6px;
  border-radius: var(--r2);
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
}
.gb i {
  display: block;
  height: 100%;
  border-radius: var(--r2);
}
.gh {
  flex: none;
  width: 64px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.gp {
  flex: none;
  width: 36px;
  color: var(--muted);
  font-size: 11px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.er {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 50px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text-2);
  font-size: 11.5px;
  text-align: left;
}
.er:hover {
  background: rgba(255, 255, 255, 0.04);
}
.eic {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--r2);
  color: var(--text-hi);
}
.ed,
.et,
.eh {
  flex: none;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.ed {
  width: 48px;
}
.el {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: var(--muted);
}
@media (max-width: 760px) {
  .gb,
  .gc {
    display: none;
  }
}
.rng {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  white-space: nowrap;
}
.rng:hover,
.rng.on {
  background: rgba(255, 255, 255, 0.06);
}
.rng :deep(svg) {
  color: var(--muted);
}

/* ---------- analytics ---------- */
.kv {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.kd {
  font-family: var(--font-data);
  font-size: 11px;
  font-weight: 600;
}
.kd.up {
  color: var(--up-fg);
}
.kd.down {
  color: var(--down-fg);
}
.ksp {
  margin-top: 4px;
  width: 100%;
}
.ins {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.in {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-left: 2px solid var(--accent);
  border-radius: var(--r2);
  background: var(--panel);
  font-size: 12.5px;
  color: var(--text);
}
.in em {
  font-style: normal;
  font-family: var(--font-data);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.in.up {
  border-left-color: var(--up);
}
.in.down {
  border-left-color: var(--down);
}
.in.warn {
  border-left-color: var(--warn);
}
.ana {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.ana > .card {
  margin: 0;
  min-width: 0;
}
.ana .s2 {
  grid-column: span 2;
}
.ana .s3 {
  grid-column: 1 / -1;
}
@container (max-width: 980px) {
  .ana {
    grid-template-columns: minmax(0, 1fr);
  }
  .ana .s2 {
    grid-column: auto;
  }
}
.cm {
  color: var(--dim);
  font-size: 11px;
}
.evt {
  display: flex;
  flex-direction: column;
}
.evh,
.evr {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 100px 44px 44px 70px 150px 70px 100px;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
}
.evh {
  height: 26px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.evr {
  height: 32px;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  font-size: 12.5px;
  text-align: left;
  cursor: default;
}
.evr:hover {
  background: var(--hover);
}
.r {
  text-align: right;
}
.num {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.evn {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  white-space: nowrap;
}
.evn > i {
  flex: none;
  width: 3px;
  height: 16px;
  border-radius: 2px;
}
.evn span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.evk {
  flex: none;
  color: var(--info-fg);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.evkind {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11.5px;
}
.evb {
  display: flex;
  align-items: center;
  gap: 6px;
}
.evb i {
  height: 6px;
  min-width: 2px;
  border-radius: 1px;
}
.evb small {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
}
.evr b {
  color: var(--text-hi);
}
.more {
  align-self: flex-start;
  margin: 8px 6px 0;
  padding: 4px 10px;
  font-size: 12px;
}
</style>
