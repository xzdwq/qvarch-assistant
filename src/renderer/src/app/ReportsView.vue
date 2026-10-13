<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatDuration, formatHM, shiftDay } from '@shared/timeline'
import { bars, daysBetween, groupItems, matches, sourceOf, taskType, unionOf, weekStart, type GroupBy, type RangeDay, type ReportFilter, type ReportItem } from '@shared/report'
import { entryIcon, kindColor, kindLabel, kinds } from '../lib/palette'
import Icon from '../components/Icon.vue'
import FilterMenu from '../components/FilterMenu.vue'
import DateRangePicker from '../components/DateRangePicker.vue'
import { onNewDay } from '../lib/today'

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
const pcOn = computed(() => days.value.reduce((s, d) => s + d.pcOnMs, 0))
const kpi = computed(() => {
  const of = (pred: (i: ReportItem) => boolean) => unionOf(items.value.filter(pred))
  return [
    { label: 'Всего', ms: total.value, main: true },
    { label: 'В среднем за день', ms: activeDays.value ? total.value / activeDays.value : 0 },
    { label: 'Jira', ms: of((i) => taskType(i.e) === 'jira'), color: '#3b82f6' },
    { label: 'Созвоны', ms: of((i) => i.e.kind === 'call'), color: kindColor('call') },
    { label: 'Встречи', ms: of((i) => i.e.kind === 'meeting'), color: kindColor('meeting') },
    { label: 'QA включено', ms: pcOn.value, sub: pcOn.value ? `размечено ${Math.round((unionOf(all.value) / pcOn.value) * 100)}%` : '' },
  ]
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
  if (by === 'day') return { name: fmt(key, { weekday: 'short', day: 'numeric', month: 'short' }), color: '#7c6cf6' }
  return { name: `${fmt(key, { day: 'numeric', month: 'short' })} – ${fmt(shiftDay(key, 6), { day: 'numeric', month: 'short' })}`, color: '#7c6cf6' }
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
          <b>{{ formatDuration(k.ms) }}</b>
          <small v-if="k.sub">{{ k.sub }}</small>
        </div>
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
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
}
.seg button {
  height: 24px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.seg button:hover {
  color: var(--text);
}
.seg button.on {
  background: rgba(124, 108, 246, 0.25);
  color: #fff;
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
  border-radius: 7px;
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
  border-radius: 8px;
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
  border-radius: 8px;
  color: var(--muted);
}
.srch.on {
  border-color: rgba(124, 108, 246, 0.6);
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
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1c2030;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.svi {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.svi:hover {
  background: rgba(139, 92, 246, 0.14);
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
  border-radius: 4px;
  color: var(--muted);
}
.svi .x:hover {
  color: #fca5a5;
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
  border-radius: 7px;
  border: 1px solid var(--border);
  background: #141824;
  color: var(--text);
  font-size: 12px;
}
.svn button {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: rgba(124, 108, 246, 0.3);
  color: #fff;
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
  padding: 10px 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* totals */
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel);
}
.kpi.main {
  border-color: rgba(124, 108, 246, 0.45);
  background: color-mix(in srgb, #7c6cf6 10%, var(--panel));
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
}
.kpi small {
  color: var(--muted);
  font-size: 11px;
}
.card {
  padding: 10px 12px;
  border-radius: 12px;
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
  font-size: 12.5px;
  font-weight: 600;
  color: #c3c8d6;
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
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.col:hover {
  background: rgba(255, 255, 255, 0.04);
}
.col.off .xl {
  color: #6b7387;
}
.col.today .xl {
  color: #c4b5fd;
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
  border-radius: 0 0 3px 3px;
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
  color: #9aa3b8;
  font-size: 11px;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
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
  color: #9aa3b8;
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
  border-radius: 3px;
}
/* the breakdown */
.share {
  display: flex;
  gap: 2px;
  height: 8px;
  margin-bottom: 8px;
  border-radius: 4px;
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
  border-radius: 7px;
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
  border-radius: 3px;
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
}
.gb {
  flex: 0 1 180px;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
}
.gb i {
  display: block;
  height: 100%;
  border-radius: 3px;
}
.gh {
  flex: none;
  width: 64px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.gp {
  flex: none;
  width: 36px;
  color: var(--muted);
  font-size: 11px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.er {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 50px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #c7cbd6;
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
  border-radius: 4px;
  color: #fff;
}
.ed,
.et,
.eh {
  flex: none;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
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
  border-radius: 8px;
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
</style>
