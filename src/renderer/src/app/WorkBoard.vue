<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { dayEnd, dayStart, formatDuration, formatHM, MINUTE, overlapPairs, scheduleRanges, shiftDay } from '@shared/timeline'
import type { Quick } from '@shared/quickadd'
import type { JiraIssue, TaskRef } from '@shared/jira'
import type { Entry, Ms, Note, PlanBlock, PublicSettings, Selection } from '@shared/types'
import Icon from '../components/Icon.vue'
import DatePick from '../components/DatePick.vue'
import QuickAdd, { type QuickDraft } from '../components/QuickAdd.vue'
import TaskSearch from '../components/TaskSearch.vue'
import EventStream from '../components/EventStream.vue'
import Timeline from '../components/Timeline.vue'
import DayStrip from '../components/DayStrip.vue'
import SheetView from './SheetView.vue'
import { refreshMentions } from '../lib/mentions'
import NoteLinks from '../components/NoteLinks.vue'
import JiraDetails from '../components/JiraDetails.vue'
import DateRangePicker from '../components/DateRangePicker.vue'
import { entryIcon, kindColor, kindLabel } from '../lib/palette'
import { todayKey } from '../lib/today'
import { useDay, useNow } from '../lib/useDay'
import { mondayOf, useRange, type RangeDay } from '../lib/useRange'
import { recentLabels } from '../lib/recent'

/**
 * «Моя работа» · Работа: the week at a glance (each day's done and planned time), one line to add anything,
 * the chosen day as a feed (done → now → plan, free gaps in between), and the tasks of the day / the week.
 */
const props = defineProps<{ settings: PublicSettings; focus?: { day: string; entryId?: string; n: number } }>()
const emit = defineEmits<{ openDay: [day: string, entryId?: string] }>()

/** The chosen day — remembered («today» as today: the next day it is the next day). */
const DAY_KEY = 'qa.work.day'
const day = ref(
  (() => {
    try {
      const v = localStorage.getItem(DAY_KEY)
      return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayKey.value
    } catch {
      return todayKey.value
    }
  })(),
)
watch(day, (d) => {
  try {
    localStorage.setItem(DAY_KEY, d === todayKey.value ? 'today' : d)
  } catch {
    // fine
  }
})
watch(todayKey, (now, was) => {
  if (day.value === was) day.value = now
})
/** The shown period: the week of the chosen day, or any picked range (up to 62 days). */
type Period = { mode: 'week' } | { mode: 'range'; from: string; to: string }
const PER_KEY = 'qa.work.period'
const per = ref<Period>(readPer())
function readPer(): Period {
  try {
    const v = JSON.parse(localStorage.getItem(PER_KEY) ?? 'null') as Period | null
    return v?.mode === 'range' && v.from && v.to ? v : { mode: 'week' }
  } catch {
    return { mode: 'week' }
  }
}
watch(per, (v) => {
  try {
    localStorage.setItem(PER_KEY, JSON.stringify(v))
  } catch {
    // fine
  }
})
const weekStart = computed(() => (per.value.mode === 'range' ? per.value.from : mondayOf(day.value)))
const weekEnd = computed(() => (per.value.mode === 'range' ? per.value.to : shiftDay(weekStart.value, 6)))
// a range keeps the chosen day inside it
watch([weekStart, weekEnd], ([a, b]) => {
  if (day.value < a || day.value > b) day.value = todayKey.value >= a && todayKey.value <= b ? todayKey.value : a
}, { immediate: true })
const spanDays = computed(() => Math.round((new Date(`${weekEnd.value}T12:00:00`).getTime() - new Date(`${weekStart.value}T12:00:00`).getTime()) / 86_400_000) + 1)
/** ‹ › move the whole period. */
function shiftPeriod(dir: 1 | -1): void {
  const p = per.value
  if (p.mode === 'week') day.value = shiftDay(day.value, dir * 7)
  else {
    const n = spanDays.value * dir
    per.value = { mode: 'range', from: shiftDay(p.from, n), to: shiftDay(p.to, n) }
    day.value = shiftDay(day.value, n)
  }
}
const rangeOpen = ref(false)
const rangeEl = ref<HTMLElement>()
function applyRange(a: string, b: string): void {
  rangeOpen.value = false
  per.value = { mode: 'range', from: a, to: b }
}
/** Back to the week of the chosen day. */
function toWeek(): void {
  per.value = { mode: 'week' }
}
const { days, reload } = useRange(weekStart, weekEnd)
const now = useNow(5_000)
/** Going on now: started, and its end is now or ahead (a detected call is extended every few seconds). */
const isLive = (e: Entry) => e.start <= now.value && e.end >= now.value - 90_000 && (e.source === 'detected' || e.end > now.value)
const isToday = computed(() => day.value === todayKey.value)
const empty = (d: string): RangeDay => ({ day: d, entries: [], notes: [], plan: [], dayTasks: [] })
const cur = computed(() => days.value.find((d) => d.day === day.value) ?? empty(day.value))
const err = ref('')
const fail = (e: unknown) => (err.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

// ---------- time sums ----------
/** Union length of intervals, cut to [lo, hi]. */
function union(list: Array<{ start: Ms; end: Ms }>, lo = -Infinity, hi = Infinity): number {
  const s = list.map((x) => ({ start: Math.max(lo, x.start), end: Math.min(hi, x.end) })).filter((x) => x.end > x.start).sort((a, b) => a.start - b.start)
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
const isMeeting = (e: Entry) => !!e.outlook || e.kind === 'meeting'

// ---------- the week strip ----------
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const week = computed(() =>
  days.value.map((d) => {
    const date = new Date(`${d.day}T12:00:00`)
    const done = union(d.entries, -Infinity, now.value)
    const plan = union(d.entries, now.value) + union(d.plan.filter((p) => !p.doneEntryId), now.value)
    const byKind = new Map<string, number>()
    for (const e of d.entries) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + (e.end - e.start))
    const sum = [...byKind.values()].reduce((a, b) => a + b, 0) || 1
    return {
      day: d.day,
      n: date.getDate(),
      wd: WD[date.getDay()],
      off: !props.settings.schedule.workDays.includes(date.getDay()),
      done,
      plan,
      kinds: [...byKind].sort((a, b) => b[1] - a[1]).map(([kind, ms]) => ({ kind, pct: (ms / sum) * 100 })),
      count: d.entries.length,
      notes: d.notes.length,
    }
  }),
)
const maxDay = computed(() => Math.max(8 * 3_600_000, ...week.value.map((w) => w.done + w.plan)))
const totals = computed(() => {
  const all = days.value.flatMap((d) => d.entries)
  return {
    done: days.value.reduce((s, d) => s + union(d.entries, -Infinity, now.value), 0),
    plan: days.value.reduce((s, d) => s + union(d.entries, now.value), 0),
    tasks: days.value.reduce((s, d) => s + union(d.entries.filter((e) => e.task), -Infinity, now.value), 0),
    meetings: days.value.reduce((s, d) => s + union(d.entries.filter(isMeeting), -Infinity, now.value), 0),
    count: all.length,
  }
})
const weekTitle = computed(() => {
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', o)
  return `${f(weekStart.value, { day: 'numeric' })} – ${f(weekEnd.value, { day: 'numeric', month: 'short' })}`
})

// ---------- the day's feed ----------
type Row =
  | { t: 'e'; key: string; e: Entry; at: Ms; plan: boolean }
  | { t: 'p'; key: string; p: PlanBlock; at: Ms }
  | { t: 'n'; key: string; n: Note; at: Ms }
  | { t: 'gap'; key: string; start: Ms; end: Ms; at: Ms; plan: boolean }
  | { t: 'now'; key: string; at: Ms }
const GAP_MIN = 15 * MINUTE
const feed = computed<Row[]>(() => {
  const d = cur.value
  const n = now.value
  const today = isToday.value
  const future = d.day > todayKey.value
  const rows: Row[] = [
    ...d.entries.map((e) => ({ t: 'e' as const, key: e.id, e, at: e.start, plan: future || (today && e.start >= n) })),
    ...d.plan.filter((p) => !p.doneEntryId).map((p) => ({ t: 'p' as const, key: `p${p.id}`, p, at: p.start })),
    ...d.notes.map((x) => ({ t: 'n' as const, key: `n${x.id}`, n: x, at: x.at })),
  ]
  // free gaps inside the working day (or around what there is)
  const busy = [...d.entries, ...d.plan.filter((p) => !p.doneEntryId)].sort((a, b) => a.start - b.start)
  const work = scheduleRanges(d.day, props.settings.schedule).work
  const lo = Math.min(work?.[0] ?? Infinity, busy[0]?.start ?? Infinity)
  const hi = Math.max(work?.[1] ?? -Infinity, busy.reduce((m, b) => Math.max(m, b.end), -Infinity))
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    let t = lo
    const cuts = today ? [n] : []
    const push = (a: Ms, b: Ms) => {
      // a gap through "now" is two: the free past and the free rest of the day
      for (const c of cuts)
        if (c > a && c < b) {
          push(a, c)
          push(c, b)
          return
        }
      if (b - a >= GAP_MIN) rows.push({ t: 'gap', key: `g${a}`, start: a, end: b, at: a, plan: future || (today && a >= n) })
    }
    for (const b of busy) {
      if (b.start > t) push(t, b.start)
      t = Math.max(t, b.end)
    }
    if (hi > t) push(t, hi)
  }
  if (today) rows.push({ t: 'now', key: 'now', at: n })
  return rows.sort((a, b) => a.at - b.at || (a.t === 'now' ? -1 : b.t === 'now' ? 1 : 0))
})
const flash = ref<string>()
// the notes the events are mentioned in
refreshMentions()
/** Blocks of the day at the same time: under the later one — with which, when, how long. */
const overlaps = computed(() => overlapPairs(cur.value.entries))
const overlapsOf = (id: string) => overlaps.value.filter((o) => o.b.id === id)

// ---------- quick add ----------
const quick = ref<InstanceType<typeof QuickAdd>>()
/** Without a time in the text: from now, 30 min (or the named length) — on another day at the same clock time. */
function placeQ(q: Quick): { start: Ms; end: Ms } {
  const dur = q.dur ?? 30 * MINUTE
  if (q.start !== undefined) return { start: q.start, end: q.end ?? q.start + dur }
  const n = Math.floor(now.value / MINUTE) * MINUTE
  const start = Math.min(dayEnd(q.day) - dur, dayStart(q.day) + (n - dayStart(todayKey.value)))
  return { start, end: start + dur }
}
async function addTaskToDay(d: string, t: TaskRef): Promise<void> {
  const list = d === day.value ? cur.value.dayTasks : ((await window.qa.getDay(d)).dayTasks ?? [])
  if (!list.some((x) => x.key === t.key)) await window.qa.setDayTasks(d, [...list, { key: t.key, summary: t.summary }])
}
async function onQuick(q: QuickDraft): Promise<void> {
  err.value = ''
  try {
    const e = await window.qa.saveEntry(q.day, { start: q.start, end: q.end, kind: q.kind, label: q.label, task: q.task ? { key: q.task.key, summary: q.task.summary } : undefined, source: 'manual' }, { overlap: true })
    if (q.task) await addTaskToDay(q.day, q.task)
    day.value = q.day
    await reload()
    flash.value = e.id
    setTimeout(() => flash.value === e.id && (flash.value = undefined), 1600)
  } catch (x) {
    fail(x)
  }
}
/** A free gap → the quick line gets its time. */
const fillGap = (r: { start: Ms; end: Ms }) => quick.value?.focus(`${formatHM(r.start)}-${formatHM(r.end)} `)
/** N or / anywhere in the section (not while typing) — to the quick line. */
function onKey(e: KeyboardEvent): void {
  const t = e.target as HTMLElement
  if (e.ctrlKey || e.altKey || e.metaKey || t.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return
  if (e.code === 'KeyN' || e.code === 'Slash') {
    e.preventDefault()
    quick.value?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// ---------- a block: open, give a task, delete ----------
/** The event edited in the stream on the right, and the one hovered in the list (the stream follows it). */
const openId = ref<string>()
const hoverId = ref<string>()
const recent = computed(() => recentLabels(...days.value.map((d) => d.entries)))
async function giveTask(e: Entry, t: TaskRef | null): Promise<void> {
  try {
    await window.qa.setEntryTask(day.value, e.id, t)
    if (t) await addTaskToDay(day.value, t)
    await reload()
  } catch (x) {
    fail(x)
  }
}
async function removeEntry(e: Entry): Promise<void> {
  try {
    await window.qa.deleteEntry(day.value, e.id)
    if (openId.value === e.id) openId.value = undefined
    await reload()
  } catch (x) {
    fail(x)
  }
}
async function planDone(p: PlanBlock): Promise<void> {
  await window.qa.planDone(day.value, p.id)
  await reload()
}
async function planDrop(p: PlanBlock): Promise<void> {
  await window.qa.deletePlan(day.value, p.id)
  await reload()
}

/** Following the time on the timeline (the same switch as the Таймлайн section's — a setting). */
const tlRef = ref<InstanceType<typeof Timeline>>()
const following = computed(() => !!props.settings.ui.timeline.follow)
const setFollow = (on: boolean) => void window.qa.updateSettings({ ui: { timeline: { follow: on } } })
let navWheelAt = 0
function onNavWheel(e: WheelEvent): void {
  if (!e.deltaY || performance.now() - navWheelAt < 90) return
  navWheelAt = performance.now()
  shiftPeriod(e.deltaY < 0 ? 1 : -1)
}
// ---------- the top: the week, or the chosen day's timeline (remembered) ----------
const remembered = <T extends string>(key: string, values: T[], def: T) => {
  const r = ref<T>(values.includes(localStorage.getItem(key) as T) ? (localStorage.getItem(key) as T) : def)
  watch(r, (v) => {
    try {
      localStorage.setItem(key, v)
    } catch {
      // fine
    }
  })
  return r
}
const top = remembered<'week' | 'timeline'>('qa.work.top', ['timeline', 'week'], 'timeline')
/** The day's list, or Заполнение (the period's sheet). */
const feedTab = remembered<'list' | 'sheet'>('qa.work.feedTab', ['list', 'sheet'], 'list')
// a day / a block opened from elsewhere (the island, a report, a reminder): that day, the block picked
watch(
  () => props.focus?.n,
  () => {
    const f = props.focus
    if (!f) return
    if (per.value.mode === 'range' && (f.day < per.value.from || f.day > per.value.to)) per.value = { mode: 'week' }
    day.value = f.day
    if (f.entryId) {
      openId.value = f.entryId
      flash.value = f.entryId
      feedTab.value = 'list'
      setTimeout(() => flash.value === f.entryId && (flash.value = undefined), 2500)
    }
  },
  { immediate: true },
)
const { data: dayData, reload: reloadDay } = useDay(day)
const sched = computed(() => scheduleRanges(day.value, props.settings.schedule))
const tlBounds = computed<[Ms, Ms]>(() => [dayStart(day.value), dayEnd(day.value)])
const tlInitial = computed<[Ms, Ms]>(() => {
  const es = dayData.value.entries
  const starts = es.map((e) => e.start)
  const ends = [...es.map((e) => e.end), ...(isToday.value ? [now.value] : [])]
  if (sched.value.work) {
    starts.push(sched.value.work[0])
    ends.push(sched.value.work[1])
  }
  const HOUR = 60 * MINUTE
  const from = starts.length ? Math.min(...starts) : dayStart(day.value) + 9 * HOUR
  const to = ends.length ? Math.max(...ends) : dayStart(day.value) + 18 * HOUR
  return [Math.max(dayStart(day.value), Math.floor((from - 15 * MINUTE) / HOUR) * HOUR), Math.min(dayEnd(day.value), Math.ceil((to + 15 * MINUTE) / HOUR) * HOUR)]
})
const tlSel = ref<Selection | null>(null)
watch(day, () => (tlSel.value = null))
async function reloadAll(): Promise<void> {
  await Promise.all([reload(), reloadDay()])
}
/** A span chosen on the timeline: the quick line gets its time. */
function onTlSelection(sel: Selection | null, commit: boolean): void {
  tlSel.value = sel
  if (commit && sel?.end !== undefined) quick.value?.focus(`${formatHM(sel.start)}-${formatHM(sel.end)} `)
}
async function tlSave(id: string, patch: Partial<Entry>): Promise<void> {
  const e = dayData.value.entries.find((x) => x.id === id)
  if (!e) return
  try {
    await window.qa.saveEntry(day.value, { ...e, ...patch }, { overlap: true })
  } catch (x) {
    fail(x)
  }
  await reloadAll()
}
async function tlCut(kind: string): Promise<void> {
  const m = tlSel.value
  if (!m) return
  await window.qa.saveEntry(day.value, { start: m.start, end: m.end ?? now.value, kind, label: kindLabel(kind), source: 'manual' }, { overlap: true })
  tlSel.value = null
  await reloadAll()
}
async function tlDelete(id: string): Promise<void> {
  await window.qa.deleteEntry(day.value, id)
  await reloadAll()
}
async function tlMerge(ids: string[]): Promise<void> {
  await window.qa.mergeEntries(day.value, ids)
  await reloadAll()
}

// ---------- a Jira task of an event, unfolded in the list ----------
const jiraOpen = ref(new Set<string>())
const issues = ref<Record<string, JiraIssue | null>>({})
async function toggleJira(e: Entry): Promise<void> {
  const s = new Set(jiraOpen.value)
  if (s.has(e.id)) s.delete(e.id)
  else s.add(e.id)
  jiraOpen.value = s
  const key = e.task?.key
  if (key && !(key in issues.value)) {
    const i = await window.qa.jiraIssue(key).catch(() => undefined)
    issues.value = { ...issues.value, [key]: i ?? null }
  }
}

/** 1 запись, 2 записи, 5 записей. */
const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many)
</script>

<template>
  <div class="wb">
    <!-- the week -->
    <div class="whead">
      <span class="wnav" title="Колесо мыши — на неделю (период) вперёд или назад" @wheel.prevent="onNavWheel">
        <button class="ib" :title="per.mode === 'week' ? 'Предыдущая неделя' : 'Предыдущий период'" @click="shiftPeriod(-1)"><Icon name="chevronLeft" :size="14" /></button>
        <button ref="rangeEl" class="wt num" :class="{ on: rangeOpen, rng: per.mode === 'range' }" title="Выбрать период" @click="rangeOpen = !rangeOpen"><Icon name="calendar" :size="12" />{{ weekTitle }}</button>
        <button class="ib" :title="per.mode === 'week' ? 'Следующая неделя' : 'Следующий период'" @click="shiftPeriod(1)"><Icon name="chevronRight" :size="14" /></button>
      </span>
      <DateRangePicker v-if="rangeOpen" :from="weekStart" :to="weekEnd" :anchor="rangeEl" :max="62" @apply="applyRange" @close="rangeOpen = false" />
      <button v-if="per.mode === 'range'" class="toweek" title="Показывать неделю выбранного дня" @click="toWeek">Неделя</button>
      <DatePick v-model="day" />
      <!-- always there (hidden when not for this day / the week): the bar never changes its size -->
      <button class="follow" :style="{ visibility: top === 'timeline' && isToday ? 'visible' : 'hidden' }" :class="{ on: following }" :title="following ? 'Автопрокрутка включена: таймлайн следует за текущим временем' : 'Автопрокрутка: таймлайн следует за текущим временем'" @click="tlRef?.toggleFollow()"><Icon name="follow" :size="13" /></button>
      <span class="tots">
        <span>СДЕЛАНО <b>{{ formatDuration(totals.done) }}</b></span>
        <span class="o1">ЗАДАЧИ <b>{{ formatDuration(totals.tasks) }}</b></span>
        <span class="o1">ВСТРЕЧИ <b>{{ formatDuration(totals.meetings) }}</b></span>
        <span class="o2">ПЛАН <b class="pl">{{ formatDuration(totals.plan) }}</b></span>
      </span>
    </div>
    <div class="toprow">
    <div class="topsw">
      <button :class="{ on: top === 'timeline' }" title="Таймлайн выбранного дня" @click="top = 'timeline'"><Icon name="timeline" :size="14" /></button>
      <button :class="{ on: top === 'week' }" title="Неделя: время по дням" @click="top = 'week'"><Icon name="calendar" :size="14" /></button>
    </div>
    <div v-if="top === 'timeline'" class="tlwrap">
      <Timeline
        ref="tlRef"
        :data="dayData"
        :follow="settings.ui.timeline"
        @follow="setFollow"
        :now="isToday ? now : undefined"
        :cursor="isToday ? now : tlInitial[0]"
        :schedule="sched"
        :bounds="tlBounds"
        :initial="tlInitial"
        :selection="tlSel"
        :selected-id="openId"
        view-key="work"
        @select="(id) => (openId = id)"
        @selection="onTlSelection"
        @resize="(c) => tlSave(c.id, { start: c.start, end: c.end })"
        @move="(c) => tlSave(c.id, { start: c.start, end: c.end, lane: c.lane })"
        @change-kind="(c) => tlSave(c.id, { kind: c.kind })"
        @cut-as="tlCut"
        @delete-entry="tlDelete"
        @merge="tlMerge"
        @plan-changed="reloadAll"
      />
      <!-- the day as a chain of events -->
      <DayStrip class="wchain" :entries="dayData.entries" :now="now" :countdown="settings.ui.timeline.countdown" />
    </div>
    <div v-else class="strip" :class="{ many: days.length > 10 }" :style="{ gridTemplateColumns: `repeat(${days.length || 7}, minmax(${days.length > 10 ? 76 : 0}px, 1fr))` }">
      <button v-for="w in week" :key="w.day" class="dcell" :class="{ sel: w.day === day, today: w.day === todayKey, off: w.off }" @click="day = w.day">
        <span class="dtop"><span class="dwd">{{ w.wd }}</span><span class="dn num">{{ w.n }}</span></span>
        <span class="dsum num">{{ w.done ? formatDuration(w.done) : '—' }}<small v-if="w.plan">+{{ formatDuration(w.plan) }}</small></span>
        <span class="dbar">
          <i class="dfill" :style="{ width: `${Math.min(100, (w.done / maxDay) * 100)}%` }">
            <i v-for="k in w.kinds" :key="k.kind" :style="{ width: `${k.pct}%`, background: kindColor(k.kind) }"></i>
          </i>
          <i v-if="w.plan" class="dplan" :style="{ width: `${Math.min(100, (w.plan / maxDay) * 100)}%` }"></i>
        </span>
        <span class="dcnt">{{ w.count ? `${w.count} зап.` : '' }}<template v-if="w.notes"> · {{ w.notes }} зам.</template></span>
      </button>
    </div>
    </div>

    <QuickAdd ref="quick" class="qadd" :day="day" :week-start="mondayOf(day)" :place="placeQ" @add="onQuick" />
    <p v-if="err" class="err">{{ err }}</p>

    <div class="wgrid">
      <!-- the day -->
      <section class="feed">
        <div class="cap fh">
          <span v-if="feedTab === 'list'">{{ isToday ? 'Сегодня' : 'День' }} · {{ cur.entries.length }} {{ plural(cur.entries.length, 'запись', 'записи', 'записей') }}<template v-if="overlaps.length"> · <em class="ovc">{{ overlaps.length }} {{ plural(overlaps.length, 'пересечение', 'пересечения', 'пересечений') }}</em></template></span>
          <span v-else>Заполнение · {{ weekTitle }}</span>
          <span class="ftabs">
            <button :class="{ on: feedTab === 'list' }" title="Записи выбранного дня" @click="feedTab = 'list'">Записи</button>
            <button :class="{ on: feedTab === 'sheet' }" title="Табель периода: часы по задачам и дням" @click="feedTab = 'sheet'">Заполнение</button>
          </span>
        </div>
        <SheetView v-if="feedTab === 'sheet'" class="wsheet" :settings="settings" widget store="work" :range="{ from: weekStart, to: weekEnd }" @go="(_v, d, id) => d && ((day = d), (feedTab = 'list'), id && (openId = id))" />
        <template v-else>
        <template v-for="r in feed" :key="r.key">
          <div v-if="r.t === 'now'" class="nowline"><span class="num">{{ formatHM(r.at) }}</span></div>
          <button v-else-if="r.t === 'gap'" class="gap" :class="{ plan: r.plan }" title="Заполнить это время" @click="fillGap(r)">
            <span class="num">{{ formatHM(r.start) }}–{{ formatHM(r.end) }}</span>
            <span>свободно {{ formatDuration(r.end - r.start) }}</span>
            <Icon name="plus" :size="12" />
          </button>
          <div v-else-if="r.t === 'n'" class="row note" @click="emit('openDay', day)">
            <span class="tm num">{{ formatHM(r.n.at) }}</span>
            <span class="kic"><Icon name="note" :size="13" /></span>
            <span class="tt"><span class="ttl">{{ r.n.text.split('\n')[0] || 'Заметка' }}</span></span>
          </div>
          <div v-else-if="r.t === 'p'" class="row plan pblock" :style="{ '--c': kindColor(r.p.kind) }">
            <span class="tm num">{{ formatHM(r.p.start) }}–{{ formatHM(r.p.end) }}</span>
            <span class="kic"><Icon :name="entryIcon(r.p)" :size="13" /></span>
            <span class="tt"><span class="ttl">{{ r.p.label || kindLabel(r.p.kind) }}</span><span class="sub">план дня</span></span>
            <span class="du num">{{ formatDuration(r.p.end - r.p.start) }}</span>
            <span class="acts">
              <button title="Сделано по плану" @click.stop="planDone(r.p)"><Icon name="check" :size="13" /></button>
              <button title="Убрать из плана" @click.stop="planDrop(r.p)"><Icon name="x" :size="13" /></button>
            </span>
          </div>
          <div v-else class="row" :class="{ plan: r.plan && !isLive(r.e), on: openId === r.e.id, flash: flash === r.e.id, live: isLive(r.e) }" :style="{ '--c': kindColor(r.e.kind) }" @mouseenter="hoverId = r.e.id" @click="openId = openId === r.e.id ? undefined : r.e.id">
            <span class="tm num">{{ formatHM(r.e.start) }}–{{ formatHM(r.e.end) }}</span>
            <span class="kic" :title="kindLabel(r.e.kind)"><Icon :name="entryIcon(r.e)" :size="13" /></span>
            <span class="tt">
              <span class="ttl">{{ r.e.label || kindLabel(r.e.kind) }}</span>
              <span v-if="r.e.description" class="sub">{{ r.e.description.split('\n')[0] }}</span>
            </span>
            <span v-if="isLive(r.e)" class="lv"><i></i>идёт</span>
            <span v-if="r.e.outlook" class="badge">Outlook</span>
            <span v-if="r.plan && !isLive(r.e)" class="badge pl">план</span>
            <span v-if="r.e.task" class="tchip" :class="{ open: jiraOpen.has(r.e.id) }" :title="r.e.task.summary" @click.stop>
              <button class="jx" :title="jiraOpen.has(r.e.id) ? 'Свернуть задачу Jira' : 'Показать задачу Jira здесь'" @click="toggleJira(r.e)">{{ r.e.task.key }}<Icon name="chevronDown" :size="10" /></button><button title="Отвязать задачу" @click="giveTask(r.e, null)"><Icon name="x" :size="10" /></button>
            </span>
            <span v-else @click.stop>
              <TaskSearch :marked="[]" placeholder="К какой задаче отнести это время?" @pick="(t) => giveTask(r.e, t)">
                <button class="give" title="Отнести к задаче"><Icon name="plus" :size="10" />задача</button>
              </TaskSearch>
            </span>
            <NoteLinks :id="r.e.id" />
            <span class="du num">{{ formatDuration(r.e.end - r.e.start) }}</span>
            <span class="acts" @click.stop>
              <button title="Показать на таймлайне" @click="(top = 'timeline'), (openId = r.e.id)"><Icon name="timeline" :size="13" /></button>
              <button v-if="!r.e.outlook" title="Удалить" @click="removeEntry(r.e)"><Icon name="trash" :size="13" /></button>
            </span>
          </div>
          <template v-if="r.t === 'e'">
            <div v-for="o in overlapsOf(r.e.id)" :key="`o${o.a.id}${o.b.id}`" class="orow" :class="{ past: o.end <= now }" :title="`Одновременно с «${o.a.label}»`" @click="openId = o.a.id">
              <Icon name="layers" :size="11" />
              <span>пересечение с <b>{{ formatHM(o.a.start) }}–{{ formatHM(o.a.end) }}</b> {{ o.a.label || kindLabel(o.a.kind) }}</span>
              <span class="grow"></span>
              <span class="otime">{{ formatHM(o.start) }}–{{ formatHM(o.end) }}</span>
              <b class="odur">{{ formatDuration(o.end - o.start) }}</b>
            </div>
          </template>
          <div v-if="r.t === 'e' && r.e.task && jiraOpen.has(r.e.id)" class="jdet">
            <JiraDetails v-if="issues[r.e.task.key]" :issue="issues[r.e.task.key]!" />
            <p v-else-if="issues[r.e.task.key] === null" class="none">Задачи {{ r.e.task.key }} нет среди загруженных из Jira — откройте её в Jira или проверьте подключение.</p>
            <p v-else class="none">Загружаю из Jira…</p>
          </div>
        </template>
        <p v-if="!feed.some((r) => r.t !== 'now')" class="none">Пусто. Добавьте запись строкой выше — нажмите N.</p>
        </template>
      </section>

      <!-- the side: the open block, or the tasks -->
      <aside class="side">
        <div class="cap fh"><span>Лента · {{ weekTitle }}</span><span class="cm">наведите на запись слева · клик — править</span></div>
        <EventStream class="stream" :days="days" :schedule="settings.schedule" :recent="recent" :now="now" :focus-id="hoverId" :open-id="openId" @open="(id) => (openId = id)" @changed="reload" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* the week / the timeline, its switch on the left (two icons one over the other) */
.toprow {
  display: flex;
  flex: none;
  gap: 6px;
  min-width: 0;
}
.toprow > .strip,
.toprow > .tlwrap {
  flex: 1;
  min-width: 0;
}
.topsw {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 4px;
}
.topsw button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  /* the same size over the week and over the timeline */
  width: 30px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.topsw button:hover {
  color: var(--text);
}
.topsw button.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--accent-fg);
}
.follow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.follow.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--accent-fg);
}
.wchain {
  border-top: 1px solid var(--border);
}
.tlwrap {
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  overflow: hidden;
}
.tchip .jx {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  width: auto;
  padding: 0 2px;
  color: inherit;
  font: inherit;
}
.tchip.open {
  border-color: rgb(var(--accent-rgb) / 0.6);
}
.jdet {
  margin: -2px 0 6px 48px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid #2684ff;
  border-radius: var(--r2);
  background: var(--panel);
}
.wb {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
  padding: 10px 14px 12px;
  overflow: hidden;
  container-type: inline-size;
}
.num {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}
.whead {
  display: flex;
  align-items: center;
  gap: 12px;
  white-space: nowrap;
  overflow: hidden;
  flex: none;
}
.wnav {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.wt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 120px;
  justify-content: center;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--field-bg);
  font-size: 12px;
  color: var(--text-hi);
}
.wt svg {
  color: var(--muted);
}
.wt.on,
.wt:hover {
  border-color: var(--accent);
}
.wt.rng {
  border-color: var(--accent-line);
  color: var(--accent-fg);
}
.toweek {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}
.ib {
  display: inline-flex;
  padding: 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.tots {
  display: inline-flex;
  gap: 16px;
  margin-left: auto;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.05em;
}
.tots b {
  color: var(--text-hi);
  font-size: 12px;
}
.tots b.pl {
  color: var(--accent-fg);
}
@container (max-width: 900px) {
  .o2 {
    display: none;
  }
}
@container (max-width: 720px) {
  .o1 {
    display: none;
  }
}
/* the week strip */
.strip {
  display: grid;
  gap: 6px;
  flex: none;
  overflow-x: auto;
  padding-bottom: 2px;
}
.strip.many .dcell {
  padding: 6px 7px;
}
.strip.many .dsum {
  font-size: 13px;
}
.strip.many .dsum small,
.strip.many .dcnt {
  display: none;
}
.dcell {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--panel);
  text-align: left;
  cursor: default;
}
.dcell:hover {
  border-color: var(--border-3);
}
.dcell.sel {
  border-color: var(--accent);
  background: var(--panel-2);
  box-shadow: inset 0 2px 0 var(--accent);
}
.dtop {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.dwd {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.dcell.off .dwd,
.dcell.off .dn {
  color: var(--down-fg);
}
.dn {
  font-size: 13px;
  color: var(--text-2);
}
.dcell.today .dn {
  padding: 0 5px;
  border-radius: var(--r2);
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 700;
}
.dsum {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-hi);
  white-space: nowrap;
  overflow: hidden;
}
.dsum small {
  margin-left: 5px;
  color: var(--accent-fg);
  font-size: 11px;
  font-weight: 500;
}
.dbar {
  position: relative;
  display: flex;
  height: 4px;
  border-radius: 2px;
  background: var(--panel-3);
  overflow: hidden;
}
.dfill {
  display: flex;
  height: 100%;
}
.dfill i {
  height: 100%;
}
.dplan {
  height: 100%;
  background: repeating-linear-gradient(90deg, var(--accent) 0 3px, transparent 3px 5px);
  opacity: 0.8;
}
.dcnt {
  min-height: 14px;
  color: var(--dim);
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
}
.err {
  margin: 0;
  color: var(--down-fg);
  font-size: 12px;
}
/* the body */
.wgrid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 460px);
  gap: 12px;
  align-items: stretch;
}
/* each column scrolls on its own: the day on the left, the period's stream on the right */
.feed {
  overflow-y: auto;
}
.side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.stream {
  flex: 1;
  min-height: 0;
}
.cm {
  color: var(--dim);
  font-family: var(--font-ui);
  font-size: 10.5px;
  letter-spacing: 0;
  text-transform: none;
}
@container (max-width: 900px) {
  .wgrid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
  .cm {
    display: none;
  }
}
.feed,
.side {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--panel);
  padding-bottom: 6px;
}
.nlinks {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  max-width: 260px;
  overflow: hidden;
}
.nlink {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 130px;
  height: 20px;
  padding: 0 7px;
  overflow: hidden;
  border: 1px solid var(--border-2);
  border-radius: 10px;
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nlink:hover {
  border-color: var(--accent);
  color: var(--accent-fg);
}
.nmore {
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
}
.ftabs {
  display: inline-flex;
  gap: 2px;
  margin-left: auto;
}
.ftabs button {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 11.5px;
}
.ftabs button.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--accent-fg);
}
.ovc {
  color: var(--warn-fg);
  font-style: normal;
}
.wsheet {
  flex: 1;
  min-height: 0;
}
.orow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 8px 4px 38px;
  padding: 3px 8px;
  border-left: 2px solid rgba(255, 183, 77, 0.6);
  border-radius: var(--r2);
  background: rgba(255, 183, 77, 0.06);
  color: var(--warn-fg);
  font-size: 11.5px;
  cursor: pointer;
}
.orow.past {
  opacity: 0.75;
}
.orow > span:nth-child(2) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.orow .otime,
.orow .odur {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.orow .otime {
  color: var(--muted);
}
.orow .odur {
  color: var(--warn);
}
.fh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 34px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  margin: 0 6px;
  padding: 4px 8px 4px 6px;
  border-left: 3px solid var(--c, var(--border-3));
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  cursor: default;
}
.row:hover {
  background: var(--hover);
}
.row.on {
  background: var(--accent-soft);
}
.row.flash {
  animation: flash 1.6s ease-out;
}
@keyframes flash {
  0% {
    background: rgb(var(--accent-rgb) / 0.4);
  }
  100% {
    background: transparent;
  }
}
.row.plan {
  border-left-style: dashed;
}
.row.plan .ttl {
  color: var(--text-2);
}
.row.note {
  --c: var(--warn);
  min-height: 32px;
}
.tm {
  flex: none;
  width: 92px;
  color: var(--text-2);
  font-size: 12px;
}
.row.note .tm {
  width: 92px;
}
.kic {
  display: inline-flex;
  flex: none;
  color: var(--c);
}
.tt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ttl {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
  font-size: 13px;
}
.sub {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
  font-size: 11.5px;
}
.badge {
  flex: none;
  padding: 0 6px;
  border-radius: var(--r2);
  background: rgba(68, 138, 255, 0.16);
  color: var(--info-fg);
  font-size: 10.5px;
}
.badge.pl {
  background: var(--accent-soft);
  color: var(--accent-fg);
}
.du {
  flex: none;
  min-width: 52px;
  text-align: right;
  color: var(--text-2);
  font-size: 12px;
}
.acts {
  display: inline-flex;
  flex: none;
  gap: 2px;
  opacity: 0;
}
.row:hover .acts {
  opacity: 1;
}
.acts button {
  display: inline-flex;
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.acts button:hover {
  color: var(--text-hi);
}
.tchip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  height: 20px;
  padding: 0 2px 0 7px;
  border-radius: var(--r2);
  background: rgba(68, 138, 255, 0.16);
  color: var(--info-fg);
  font-family: var(--font-data);
  font-size: 11px;
}
.tchip button {
  display: inline-flex;
  padding: 2px;
  border: 0;
  background: transparent;
  color: inherit;
}
.give {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border: 1px dashed var(--border-3);
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  opacity: 0;
}
.row:hover .give {
  opacity: 1;
}
.gap {
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(100% - 12px);
  height: 26px;
  margin: 0 6px;
  padding: 0 8px 0 9px;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--dim);
  font-size: 11.5px;
  text-align: left;
}
.gap .num {
  width: 92px;
}
.gap svg {
  margin-left: auto;
  opacity: 0;
}
.gap:hover {
  background: var(--hover);
  color: var(--accent-fg);
}
.gap:hover svg {
  opacity: 1;
}
.gap.plan {
  color: var(--muted);
}
.nowline {
  position: relative;
  height: 0;
  margin: 6px 6px;
  border-top: 1px solid var(--down);
}
.nowline span {
  position: absolute;
  left: 0;
  top: -9px;
  padding: 1px 6px;
  border-radius: var(--r2);
  background: var(--down);
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
}
.none {
  margin: 10px 12px;
  color: var(--muted);
  font-size: 12px;
}
/* the side */
.seg {
  display: inline-flex;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  overflow: hidden;
}
.seg button {
  height: 22px;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  text-transform: uppercase;
}
.seg button.on {
  background: var(--accent-soft);
  color: var(--accent-fg);
}
.trow {
  margin: 0 6px;
  border-bottom: 1px solid var(--border);
}
.trow.open {
  background: var(--panel-2);
}
.th {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 4px;
  white-space: nowrap;
}
.chev {
  display: inline-flex;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--info);
}
.chev:disabled {
  color: var(--up);
  opacity: 1;
}
.key {
  flex: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--info-fg);
  font-size: 12px;
  font-weight: 600;
}
.key.own {
  color: var(--up-fg);
}
.sum {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
  font-size: 12.5px;
}
.tms {
  flex: none;
  color: var(--text-hi);
  font-size: 12px;
}
.tms.zero {
  color: var(--dim);
  font-weight: 400;
}
.x {
  display: inline-flex;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.tb {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px 7px 28px;
}
.tplan {
  color: var(--accent-fg);
  font-size: 11px;
}
.cells {
  display: inline-flex;
  gap: 2px;
}
.cells i {
  width: 14px;
  height: 14px;
  border-radius: 2px;
  background: rgb(var(--accent-rgb) / var(--a));
  outline: 1px solid var(--border);
}
.cells i.sel {
  outline-color: var(--text-2);
}
.grow {
  flex: 1;
}
.quick {
  display: inline-flex;
  gap: 2px;
}
.quick button {
  height: 22px;
  padding: 0 6px;
  font-family: var(--font-data);
  font-size: 10.5px;
  color: var(--text-2);
}
.quick button:hover {
  border-color: var(--accent);
  color: var(--accent-fg);
}
.take {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 8px 10px 4px;
  padding: 5px 10px;
  border-style: dashed;
  color: var(--text-2);
  font-size: 12px;
}
.ed :deep(.ee) {
  border: 0;
}

/* an event going on now (a call the tracker keeps extending, a block over "now"): a sweep and a pulse */
.row.live {
  position: relative;
  overflow: hidden;
  background: linear-gradient(90deg, color-mix(in srgb, var(--c) 16%, transparent), transparent 70%);
}
.row.live::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 35%;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--c) 22%, transparent), transparent);
  animation: live-sweep 2.6s linear infinite;
  pointer-events: none;
}
.row.live .kic {
  animation: live-pulse 1.4s ease-in-out infinite;
}
.lv {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 0 7px;
  border-radius: var(--r2);
  background: color-mix(in srgb, var(--c) 20%, transparent);
  color: var(--text-hi);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.lv i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 6px var(--c);
  animation: live-blink 1s steps(2) infinite;
}
@keyframes live-sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}
@keyframes live-pulse {
  50% {
    opacity: 0.45;
    transform: scale(0.88);
  }
}
@keyframes live-blink {
  50% {
    opacity: 0.3;
  }
}
</style>
