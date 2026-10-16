<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { dayEnd, dayStart, formatDuration, formatHM, MINUTE, scheduleRanges, shiftDay } from '@shared/timeline'
import { isOwnTask, placeSlot } from '@shared/work'
import type { Quick } from '@shared/quickadd'
import type { TaskRef } from '@shared/jira'
import type { Entry, Ms, Note, PlanBlock, PublicSettings } from '@shared/types'
import Icon from '../components/Icon.vue'
import DatePick from '../components/DatePick.vue'
import QuickAdd, { type QuickDraft } from '../components/QuickAdd.vue'
import TaskSearch from '../components/TaskSearch.vue'
import JiraDetails from '../components/JiraDetails.vue'
import EntryEditor from '../components/EntryEditor.vue'
import DateRangePicker from '../components/DateRangePicker.vue'
import { entryIcon, kindColor, kindLabel } from '../lib/palette'
import { useJira } from '../lib/jira'
import { todayKey } from '../lib/today'
import { useNow } from '../lib/useDay'
import { mondayOf, useRange, type RangeDay } from '../lib/useRange'
import { recentLabels } from '../lib/recent'

/**
 * «Моя работа» · Работа: the week at a glance (each day's done and planned time), one line to add anything,
 * the chosen day as a feed (done → now → plan, free gaps in between), and the tasks of the day / the week.
 */
const props = defineProps<{ settings: PublicSettings }>()
const emit = defineEmits<{ openDay: [day: string, entryId?: string] }>()

const day = ref(todayKey.value)
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
const jira = useJira()
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

// ---------- quick add ----------
const quick = ref<InstanceType<typeof QuickAdd>>()
const workStart = (d: string) => scheduleRanges(d, props.settings.schedule).work?.[0]
function placeQ(q: Quick): { start: Ms; end: Ms } {
  const dur = q.dur ?? 30 * MINUTE
  if (q.start !== undefined) return { start: q.start, end: q.end ?? q.start + dur }
  const list = days.value.find((d) => d.day === q.day)?.entries ?? []
  return placeSlot(list, dur, { now: now.value, isToday: q.day === todayKey.value, dayStart: dayStart(q.day), dayEnd: dayEnd(q.day), workStart: workStart(q.day) })
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
const sel = ref<Entry>()
watch(day, () => (sel.value = undefined))
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
    if (sel.value?.id === e.id) sel.value = undefined
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
async function onSaved(): Promise<void> {
  sel.value = undefined
  await reload()
}

// ---------- tasks of the day / the week ----------
const SCOPE_KEY = 'qa.work.scope'
const scope = ref<'day' | 'week'>(localStorage.getItem(SCOPE_KEY) === 'week' ? 'week' : 'day')
watch(scope, (v) => {
  try {
    localStorage.setItem(SCOPE_KEY, v)
  } catch {
    // fine
  }
})
interface TaskRow {
  task: TaskRef
  own: boolean
  done: number
  plan: number
  perDay: number[]
  slots: number
  listed: boolean
}
const taskRows = computed<TaskRow[]>(() => {
  const range = scope.value === 'day' ? [cur.value] : days.value
  const map = new Map<string, TaskRow & { parts: Entry[][] }>()
  const get = (t: TaskRef) => {
    let r = map.get(t.key)
    if (!r) map.set(t.key, (r = { task: { key: t.key, summary: t.summary }, own: isOwnTask(t.key), done: 0, plan: 0, perDay: Array(days.value.length).fill(0), slots: 0, listed: false, parts: days.value.map(() => []) }))
    if (!r.task.summary && t.summary) r.task.summary = t.summary
    return r
  }
  for (const d of range) for (const t of d.dayTasks) get(t).listed = get(t).listed || d.day === day.value
  for (const d of range) {
    const i = days.value.findIndex((x) => x.day === d.day)
    for (const e of d.entries) if (e.task) get(e.task).parts[Math.max(0, i)].push(e)
  }
  const out = [...map.values()].map((r) => {
    const all = r.parts.flat()
    return {
      task: r.task,
      own: r.own,
      done: union(all, -Infinity, now.value),
      plan: union(all, now.value),
      perDay: r.parts.map((p) => union(p)),
      slots: (scope.value === 'day' ? all : r.parts[days.value.findIndex((x) => x.day === day.value)] ?? []).length,
      listed: r.listed,
    }
  })
  const order = cur.value.dayTasks.map((t) => t.key)
  return out.sort((a, b) => {
    const ia = order.indexOf(a.task.key)
    const ib = order.indexOf(b.task.key)
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib)
    return b.done + b.plan - (a.done + a.plan)
  })
})
const maxCell = computed(() => Math.max(3_600_000, ...taskRows.value.flatMap((r) => r.perDay)))
const opened = ref<string>()
const issueOf = (key: string) => jira.value.issues.find((i) => i.key === key)
async function quickTime(r: TaskRow, minutes: number): Promise<void> {
  const d = day.value
  const range = placeSlot(cur.value.entries, minutes * MINUTE, { now: now.value, isToday: isToday.value, dayStart: dayStart(d), dayEnd: dayEnd(d), workStart: workStart(d) })
  await onQuick({ day: d, ...range, kind: 'task', label: `${r.task.key} ${r.task.summary}`.trim(), task: r.task })
}
async function takeTask(t: TaskRef): Promise<void> {
  await addTaskToDay(day.value, t)
  await reload()
}
async function dropTask(r: TaskRow): Promise<void> {
  await window.qa.setDayTasks(day.value, cur.value.dayTasks.filter((x) => x.key !== r.task.key))
  await reload()
}
const openTask = (key: string) => !isOwnTask(key) && jira.value.siteUrl && window.qa.openExternal(`${jira.value.siteUrl}/browse/${key}`)
const QUICK = [
  { m: 15, label: '15м' },
  { m: 30, label: '30м' },
  { m: 60, label: '1ч' },
]
/** 1 запись, 2 записи, 5 записей. */
const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many)
const hm = (ms: number) => (ms ? formatDuration(ms) : '')
</script>

<template>
  <div class="wb">
    <!-- the week -->
    <div class="whead">
      <span class="wnav">
        <button class="ib" :title="per.mode === 'week' ? 'Предыдущая неделя' : 'Предыдущий период'" @click="shiftPeriod(-1)"><Icon name="chevronLeft" :size="14" /></button>
        <button ref="rangeEl" class="wt num" :class="{ on: rangeOpen, rng: per.mode === 'range' }" title="Выбрать период" @click="rangeOpen = !rangeOpen"><Icon name="calendar" :size="12" />{{ weekTitle }}</button>
        <button class="ib" :title="per.mode === 'week' ? 'Следующая неделя' : 'Следующий период'" @click="shiftPeriod(1)"><Icon name="chevronRight" :size="14" /></button>
      </span>
      <DateRangePicker v-if="rangeOpen" :from="weekStart" :to="weekEnd" :anchor="rangeEl" :max="62" @apply="applyRange" @close="rangeOpen = false" />
      <button v-if="per.mode === 'range'" class="toweek" title="Показывать неделю выбранного дня" @click="toWeek">Неделя</button>
      <DatePick v-model="day" />
      <span class="tots">
        <span>СДЕЛАНО <b>{{ formatDuration(totals.done) }}</b></span>
        <span class="o1">ЗАДАЧИ <b>{{ formatDuration(totals.tasks) }}</b></span>
        <span class="o1">ВСТРЕЧИ <b>{{ formatDuration(totals.meetings) }}</b></span>
        <span class="o2">ПЛАН <b class="pl">{{ formatDuration(totals.plan) }}</b></span>
      </span>
    </div>
    <div class="strip" :class="{ many: days.length > 10 }" :style="{ gridTemplateColumns: `repeat(${days.length || 7}, minmax(${days.length > 10 ? 76 : 0}px, 1fr))` }">
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

    <QuickAdd ref="quick" class="qadd" :day="day" :week-start="mondayOf(day)" :place="placeQ" @add="onQuick" />
    <p v-if="err" class="err">{{ err }}</p>

    <div class="wgrid">
      <!-- the day -->
      <section class="feed">
        <div class="cap fh">
          <span>{{ isToday ? 'Сегодня' : 'День' }} · {{ cur.entries.length }} {{ plural(cur.entries.length, 'запись', 'записи', 'записей') }}</span>
          <button class="lnk" title="Открыть день на таймлайне" @click="emit('openDay', day)"><Icon name="timeline" :size="12" />таймлайн</button>
        </div>
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
          <div v-else class="row" :class="{ plan: r.plan && !isLive(r.e), on: sel?.id === r.e.id, flash: flash === r.e.id, live: isLive(r.e) }" :style="{ '--c': kindColor(r.e.kind) }" @click="sel = sel?.id === r.e.id ? undefined : r.e">
            <span class="tm num">{{ formatHM(r.e.start) }}–{{ formatHM(r.e.end) }}</span>
            <span class="kic" :title="kindLabel(r.e.kind)"><Icon :name="entryIcon(r.e)" :size="13" /></span>
            <span class="tt">
              <span class="ttl">{{ r.e.label || kindLabel(r.e.kind) }}</span>
              <span v-if="r.e.description" class="sub">{{ r.e.description.split('\n')[0] }}</span>
            </span>
            <span v-if="isLive(r.e)" class="lv"><i></i>идёт</span>
            <span v-if="r.e.outlook" class="badge">Outlook</span>
            <span v-if="r.plan && !isLive(r.e)" class="badge pl">план</span>
            <span v-if="r.e.task" class="tchip" :title="r.e.task.summary" @click.stop>
              {{ r.e.task.key }}<button title="Отвязать задачу" @click="giveTask(r.e, null)"><Icon name="x" :size="10" /></button>
            </span>
            <span v-else @click.stop>
              <TaskSearch :marked="[]" placeholder="К какой задаче отнести это время?" @pick="(t) => giveTask(r.e, t)">
                <button class="give" title="Отнести к задаче"><Icon name="plus" :size="10" />задача</button>
              </TaskSearch>
            </span>
            <span class="du num">{{ formatDuration(r.e.end - r.e.start) }}</span>
            <span class="acts" @click.stop>
              <button title="На таймлайне" @click="emit('openDay', day, r.e.id)"><Icon name="timeline" :size="13" /></button>
              <button v-if="!r.e.outlook" title="Удалить" @click="removeEntry(r.e)"><Icon name="trash" :size="13" /></button>
            </span>
          </div>
        </template>
        <p v-if="!feed.some((r) => r.t !== 'now')" class="none">Пусто. Добавьте запись строкой выше — нажмите N.</p>
      </section>

      <!-- the side: the open block, or the tasks -->
      <aside class="side">
        <div v-if="sel" class="ed">
          <div class="cap fh"><span>Запись</span><button class="lnk" title="Закрыть" @click="sel = undefined"><Icon name="x" :size="12" /></button></div>
          <EntryEditor :key="sel.id" :day="day" :entry="sel" :recent="recent" :entries="cur.entries" :notes="cur.notes" textarea @saved="onSaved" @deleted="onSaved" @close="sel = undefined" />
        </div>
        <template v-else>
          <div class="cap fh">
            <span>Задачи</span>
            <span class="seg">
              <button :class="{ on: scope === 'day' }" @click="scope = 'day'">День</button>
              <button :class="{ on: scope === 'week' }" @click="scope = 'week'">{{ per.mode === 'week' ? 'Неделя' : 'Период' }}</button>
            </span>
          </div>
          <div v-for="r in taskRows" :key="r.task.key" class="trow" :class="{ open: opened === r.task.key }">
            <div class="th">
              <button class="chev" :disabled="r.own" :title="r.own ? '' : 'Подробности'" @click="opened = opened === r.task.key ? undefined : r.task.key"><Icon :name="r.own ? 'checkSquare' : 'jira'" :size="13" /></button>
              <button class="key num" :class="{ own: r.own }" :title="r.own ? 'Своя задача' : 'Открыть в Jira'" @click="openTask(r.task.key)">{{ r.task.key }}</button>
              <span class="sum" :title="r.task.summary">{{ r.task.summary }}</span>
              <b class="tms num" :class="{ zero: !r.done }">{{ r.done ? formatDuration(r.done) : '—' }}</b>
              <button v-if="scope === 'day' && r.listed && !r.slots" class="x" title="Убрать из дня" @click="dropTask(r)"><Icon name="x" :size="12" /></button>
            </div>
            <div class="tb">
              <span v-if="r.plan" class="tplan num">план +{{ formatDuration(r.plan) }}</span>
              <span v-if="scope === 'week'" class="cells">
                <i v-for="(ms, i) in r.perDay" :key="i" :class="{ sel: days[i]?.day === day }" :style="{ '--a': ms ? 0.25 + (ms / maxCell) * 0.75 : 0 }" :title="`${week[i]?.wd} ${hm(ms) || '—'}`"></i>
              </span>
              <span class="grow"></span>
              <span class="quick">
                <button v-for="q in QUICK" :key="q.m" :title="`+${q.label} в свободное время дня`" @click="quickTime(r, q.m)">+{{ q.label }}</button>
              </span>
            </div>
            <JiraDetails v-if="opened === r.task.key && issueOf(r.task.key)" :issue="issueOf(r.task.key)!" />
            <p v-else-if="opened === r.task.key" class="none">Задачи нет в списке Jira — синхронизируйте или отметьте её звёздочкой.</p>
          </div>
          <p v-if="!taskRows.length" class="none">{{ scope === 'day' ? 'На этот день задач нет.' : 'За неделю задач нет.' }}</p>
          <TaskSearch :marked="cur.dayTasks.map((t) => t.key)" @pick="takeTask">
            <button class="take"><Icon name="plus" :size="12" />Взять задачу на день</button>
          </TaskSearch>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.wb {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
  padding: 10px 14px 12px;
  overflow: auto;
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
  grid-template-columns: minmax(0, 1fr) minmax(320px, 400px);
  gap: 12px;
  align-items: start;
}
@container (max-width: 900px) {
  .wgrid {
    grid-template-columns: minmax(0, 1fr);
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
.lnk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  text-transform: uppercase;
}
.lnk:hover {
  color: var(--accent-fg);
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
