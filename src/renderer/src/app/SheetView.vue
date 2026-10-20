<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { atTime, formatDuration, scheduleRanges, shiftDay, unionMs } from '@shared/timeline'
import { daysBetween, formatHours, parseHours, placeTime, rowKeyOf, rowOf, takeTime, weekStart, type RangeDay, type SheetRow } from '@shared/report'
import type { Entry, PublicSettings } from '@shared/types'
import type { TaskRef } from '@shared/jira'
import { kindColor, kindLabel, kinds, entryIcon } from '../lib/palette'
import Icon from '../components/Icon.vue'
import TaskPicker from '../components/TaskPicker.vue'
import { onNewDay } from '../lib/today'
import FilterMenu from '../components/FilterMenu.vue'
import DateRangePicker from '../components/DateRangePicker.vue'
import { placeFloat, useAnchor } from '../lib/floating'

/**
 * Заполнение — the week (or a day) as a table: a row per task (or kind + text), a column per day. Typing
 * hours into a cell makes real blocks on the timeline (into free working time) or takes time away from
 * the row's blocks; Outlook meetings are never changed.
 */
/**
 * `widget` — on the dashboard (or a tab of the timeline): a day by default, tighter. `store` — its remembered
 * view apart from the others; `day` — the day it follows (the timeline's).
 */
/** `range` — embedded (Моя работа): these days, no bar of its own. */
const props = defineProps<{ settings: PublicSettings; widget?: boolean; store?: string; day?: string; range?: { from: string; to: string } }>()
const SUFFIX = props.store ? `.${props.store}` : props.widget ? '.widget' : ''
const emit = defineEmits<{ go: [view: 'day', day?: string, entryId?: string] }>()

const today = () => new Date().toLocaleDateString('sv-SE')
/**
 * The period: a day, a week or any range picked on the calendar — remembered (the dashboard's apart);
 * "today" is remembered as today, so the next day it shows the new day.
 */
type Mode = 'week' | 'day' | 'range'
const VIEW_KEY = `qa.sheet.view${SUFFIX}`
const saved = (() => {
  try {
    return (JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as { mode?: Mode; anchor?: string; from?: string; to?: string } | null) ?? {}
  } catch {
    return {}
  }
})()
const mode = ref<Mode>(saved.mode ?? (props.widget ? 'day' : 'week'))
const anchor = ref(!saved.anchor || saved.anchor === 'today' ? today() : saved.anchor)
const rangeFrom = ref(saved.from ?? today())
const rangeTo = ref(saved.to ?? today())
watch([mode, anchor, rangeFrom, rangeTo], () => {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ mode: mode.value, anchor: anchor.value === today() ? 'today' : anchor.value, from: rangeFrom.value, to: rangeTo.value }))
  } catch {
    // not remembered — fine
  }
})
onNewDay((prev, next) => {
  if (anchor.value === prev) anchor.value = next
})
// the timeline's day: the period moves to it (a day or the week holding it)
watch(
  () => props.day,
  (d) => {
    if (!d) return
    if (mode.value === 'range') mode.value = 'day'
    anchor.value = d
  },
  { immediate: true },
)
const cols = computed(() =>
  props.range
    ? daysBetween(props.range.from, props.range.to).slice(0, 62)
    : mode.value === 'week' ? daysBetween(weekStart(anchor.value), shiftDay(weekStart(anchor.value), 6)) : mode.value === 'range' ? daysBetween(rangeFrom.value, rangeTo.value).slice(0, 62) : [anchor.value],
)
/** The calendar: one day → "день", Monday..Sunday → "неделя", anything else → that range. */
const pickerOpen = ref(false)
const plEl = ref<HTMLElement>()
function applyRange(from: string, to: string): void {
  pickerOpen.value = false
  if (from === to) {
    mode.value = 'day'
    anchor.value = from
  } else if (weekStart(from) === from && shiftDay(from, 6) === to) {
    mode.value = 'week'
    anchor.value = from
  } else {
    mode.value = 'range'
    rangeFrom.value = from
    rangeTo.value = to
  }
}
function setMode(m: 'day' | 'week'): void {
  if (mode.value === 'range') anchor.value = cols.value.includes(today()) ? today() : cols.value[0]
  mode.value = m
}
function goToday(): void {
  if (mode.value === 'range') mode.value = props.widget ? 'day' : 'week'
  anchor.value = today()
}
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', o)
const label = computed(() => {
  const a = cols.value[0]
  const b = cols.value[cols.value.length - 1]
  return cols.value.length === 1 ? fmt(a, { weekday: 'short', day: 'numeric', month: 'short' }) : `${fmt(a, { day: 'numeric', month: a.slice(5, 7) === b.slice(5, 7) ? undefined : 'short' })} – ${fmt(b, { day: 'numeric', month: 'short' })}`
})
const isCurrent = computed(() => cols.value.includes(today()))
/** The wheel over the period: up — later, down — earlier (as every date field). */
function onWheel(e: WheelEvent): void {
  if (e.deltaY) shift(e.deltaY < 0 ? 1 : -1)
}
function shift(dir: 1 | -1): void {
  if (mode.value === 'range') {
    const n = cols.value.length
    rangeFrom.value = shiftDay(rangeFrom.value, dir * n)
    rangeTo.value = shiftDay(rangeTo.value, dir * n)
  } else anchor.value = shiftDay(anchor.value, dir * (mode.value === 'week' ? 7 : 1))
}

// ---------- the columns' widths (dragged by their edge; remembered, the dashboard's apart) ----------
const COLS_KEY = `qa.sheet.cols${SUFFIX}`
type ColW = { rl: number; dc: number; tc: number }
const colW = ref<ColW>(
  (() => {
    try {
      return { rl: props.widget ? 190 : 300, dc: 76, tc: 76, ...(JSON.parse(localStorage.getItem(COLS_KEY) ?? '{}') as Partial<ColW>) }
    } catch {
      return { rl: props.widget ? 190 : 300, dc: 76, tc: 76 }
    }
  })(),
)
const tableW = computed(() => colW.value.rl + cols.value.length * colW.value.dc + (cols.value.length > 1 ? colW.value.tc : 0))
function startColResize(e: PointerEvent, key: keyof ColW): void {
  const x0 = e.clientX
  const w0 = colW.value[key]
  const min = key === 'rl' ? 110 : 44
  const move = (ev: PointerEvent) => (colW.value = { ...colW.value, [key]: Math.max(min, Math.min(700, Math.round(w0 + ev.clientX - x0))) })
  const up = () => {
    window.removeEventListener('pointermove', move)
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(colW.value))
    } catch {
      // not remembered — fine
    }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up, { once: true })
}

// ---------- the data ----------
const days = ref<RangeDay[]>([])
const busy = ref(false)
async function load(): Promise<void> {
  const from = cols.value[0]
  const r = await window.qa.rangeDays(from, cols.value[cols.value.length - 1])
  if (from === cols.value[0]) days.value = r
}
watch(cols, () => void load(), { immediate: true })
const onFocus = () => void load()
onMounted(() => window.addEventListener('focus', onFocus))
onBeforeUnmount(() => window.removeEventListener('focus', onFocus))
// today's blocks come live (the island, a call, another window) — shown at once, no reload
const offDay = window.qa.onDayState((msg) => {
  const d = msg.day
  if (!cols.value.includes(d.day)) return
  const cur = dayOf(d.day)
  if (cur && cur.entries === d.entries) return
  const next = { day: d.day, entries: d.entries }
  days.value = cur ? days.value.map((x) => (x.day === d.day ? next : x)) : [...days.value, next]
})
onBeforeUnmount(offDay)

// ---------- the kind filter (remembered; the dashboard's apart) ----------
const KINDS_KEY = `qa.sheet.kinds${SUFFIX}`
function readKinds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KINDS_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}
const kindFilter = ref<string[]>(readKinds())
watch(kindFilter, (v) => {
  try {
    localStorage.setItem(KINDS_KEY, JSON.stringify(v))
  } catch {
    // not remembered — fine
  }
})
const kindOpts = computed(() => kinds.value.map((k) => ({ id: k.id, label: k.label, color: k.color })))
const shownKind = (k: string) => !kindFilter.value.length || kindFilter.value.includes(k)
const entriesOf = (d: RangeDay | undefined) => (d?.entries ?? []).filter((e) => shownKind(e.kind))
const dayOf = (d: string) => days.value.find((x) => x.day === d)

// ---------- rows: from the blocks + the ones added by hand (remembered per week) ----------
const ROWS_KEY = 'qa.sheet.rows'
function readRows(): Record<string, SheetRow[]> {
  try {
    return (JSON.parse(localStorage.getItem(ROWS_KEY) ?? 'null') as Record<string, SheetRow[]> | null) ?? {}
  } catch {
    return {}
  }
}
const added = ref<Record<string, SheetRow[]>>(readRows())
watch(
  added,
  (v) => {
    try {
      localStorage.setItem(ROWS_KEY, JSON.stringify(v))
    } catch {
      // not remembered — fine
    }
  },
  { deep: true },
)
const periodKey = computed(() => (mode.value === 'week' ? weekStart(anchor.value) : mode.value === 'range' ? `${rangeFrom.value}_${rangeTo.value}` : anchor.value))
const kindOrder = (k: string) => {
  const i = kinds.value.findIndex((x) => x.id === k)
  return i < 0 ? 99 : i
}
interface Row extends SheetRow {
  cells: Map<string, { ms: number; blocks: Entry[] }>
  total: number
  /** Only Outlook meetings — nothing to change here. */
  locked: boolean
  manual: boolean
}
const rows = computed<Row[]>(() => {
  const m = new Map<string, Row>()
  const ensure = (r: SheetRow, manual: boolean): Row => {
    let row = m.get(r.key)
    if (!row) m.set(r.key, (row = { ...r, cells: new Map(), total: 0, locked: false, manual }))
    return row
  }
  for (const d of days.value)
    for (const e of entriesOf(d)) {
      const row = ensure(rowOf(e), false)
      const c = row.cells.get(d.day) ?? { ms: 0, blocks: [] }
      c.blocks.push(e)
      row.cells.set(d.day, c)
    }
  for (const r of added.value[periodKey.value] ?? []) if (shownKind(r.kind)) ensure(r, true)
  for (const row of m.values()) {
    for (const c of row.cells.values()) c.ms = unionMs(c.blocks)
    row.total = unionMs([...row.cells.values()].flatMap((c) => c.blocks))
    const blocks = [...row.cells.values()].flatMap((c) => c.blocks)
    row.locked = blocks.length > 0 && blocks.every((b) => b.outlook)
  }
  return [...m.values()].sort((a, b) => Number(!a.task) - Number(!b.task) || kindOrder(a.kind) - kindOrder(b.kind) || (a.task?.key ?? a.label).localeCompare(b.task?.key ?? b.label))
})
const dayTotal = (d: string) => unionMs(entriesOf(dayOf(d)))
/** Time per kind (tasks, meetings, calls…): per day and for the period — a kind's own overlaps counted once. */
const kindRows = computed(() => {
  const present = new Set(cols.value.flatMap((d) => entriesOf(dayOf(d)).map((e) => e.kind)))
  return kinds.value
    .filter((k) => present.has(k.id))
    .map((k) => {
      const per = new Map(cols.value.map((d) => [d, unionMs(entriesOf(dayOf(d)).filter((e) => e.kind === k.id))]))
      return { kind: k.id, per, total: [...per.values()].reduce((a, b) => a + b, 0) }
    })
    .concat(
      // a kind removed from the settings but still on old blocks
      [...present].filter((id) => !kinds.value.some((k) => k.id === id)).map((id) => {
        const per = new Map(cols.value.map((d) => [d, unionMs(entriesOf(dayOf(d)).filter((e) => e.kind === id))]))
        return { kind: id, per, total: [...per.values()].reduce((a, b) => a + b, 0) }
      }),
    )
})
const grand = computed(() => cols.value.reduce((s, d) => s + dayTotal(d), 0))
const isOff = (d: string) => !props.settings.schedule.workDays.includes(new Date(`${d}T12:00:00`).getDay())

// ---------- typing hours ----------
const editing = ref<string>()
const draft = ref('')
const bad = ref<string>()
const cellId = (r: Row, d: string) => `${r.key}|${d}`
function startEdit(r: Row, d: string): void {
  if (r.locked) return
  editing.value = cellId(r, d)
  draft.value = formatHours(r.cells.get(d)?.ms ?? 0)
}
/** The working hours of a day (the schedule's, also on a day off — that is where hand-typed time goes). */
function workOf(d: string): { work: [number, number]; lunch?: [number, number] } {
  const s = scheduleRanges(d, props.settings.schedule)
  const sch = props.settings.schedule
  return { work: s.work ?? [atTime(d, sch.start), atTime(d, sch.end)], lunch: s.lunch ?? (sch.lunchStart && sch.lunchEnd ? [atTime(d, sch.lunchStart), atTime(d, sch.lunchEnd)] : undefined) }
}
async function setHours(r: SheetRow & { cells?: Row['cells'] }, d: string, want: number): Promise<void> {
  const cell = r.cells?.get(d)
  const cur = cell?.ms ?? 0
  const diff = want - cur
  if (Math.abs(diff) < 60_000) return
  if (diff > 0) {
    const { work, lunch } = workOf(d)
    for (const [start, end] of placeTime(dayOf(d)?.entries ?? [], diff, work, lunch))
      await window.qa.saveEntry(d, { start, end, kind: r.kind, label: r.label, task: r.task ? { ...r.task } : undefined, source: 'manual' }, { overlap: true })
  } else {
    for (const op of takeTime(cell?.blocks ?? [], -diff)) {
      const e = cell!.blocks.find((b) => b.id === op.id)!
      if (op.drop) await window.qa.deleteEntry(d, e.id)
      else await window.qa.saveEntry(d, { ...e, task: e.task ? { ...e.task } : undefined, end: op.end! }, { overlap: true })
    }
  }
}
async function commit(r: Row, d: string, move?: 'down' | 'up' | 'right'): Promise<void> {
  if (editing.value !== cellId(r, d)) return
  const ms = parseHours(draft.value)
  if (ms === undefined) {
    bad.value = cellId(r, d)
    setTimeout(() => (bad.value = undefined), 900)
    return
  }
  editing.value = undefined
  if (Math.abs(ms - (r.cells.get(d)?.ms ?? 0)) >= 60_000) {
    busy.value = true
    try {
      await setHours(r, d, ms)
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      await load()
      busy.value = false
    }
  }
  if (move) focusNext(r, d, move)
}
function cancel(): void {
  editing.value = undefined
}
async function focusNext(r: Row, d: string, move: 'down' | 'up' | 'right'): Promise<void> {
  const ri = rows.value.findIndex((x) => x.key === r.key)
  const ci = cols.value.indexOf(d)
  const nr = move === 'down' ? rows.value[ri + 1] : move === 'up' ? rows.value[ri - 1] : r
  const nd = move === 'right' ? cols.value[ci + 1] : d
  if (!nr || !nd || nr.locked) return
  startEdit(nr, nd)
  await nextTick()
  const el = document.querySelector<HTMLInputElement>('.sheet input.cin')
  el?.focus()
  el?.select()
}
function onCellKey(e: KeyboardEvent, r: Row, d: string): void {
  if (e.key === 'Enter') void commit(r, d, e.shiftKey ? 'up' : 'down')
  else if (e.key === 'Escape') cancel()
  else if (e.key === 'ArrowDown') void commit(r, d, 'down')
  else if (e.key === 'ArrowUp') void commit(r, d, 'up')
  else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault()
    void commit(r, d, 'right')
  }
}
const vFocus = { mounted: (el: HTMLInputElement) => (el.focus(), el.select()) }

// ---------- adding a row ----------
const adding = ref(false)
const newKind = ref('task')
const newTask = ref<TaskRef[]>([])
const newLabel = ref('')
const addEl = ref<HTMLElement>()
/** The menus float over everything (teleported): the dashboard widget would clip them. */
const addPd = ref<HTMLElement>()
const addStyle = ref<Record<string, string>>({})
useAnchor(adding, addEl, () => addEl.value && (addStyle.value = placeFloat(addEl.value, 320, false, 40).style))
const pickable = computed(() => kinds.value.filter((k) => !k.hidden))
function addRow(): void {
  const t = newTask.value[0]
  const text = newLabel.value.trim() || (t ? `${t.key} ${t.summary}` : kindLabel(newKind.value))
  const row = rowOf({ kind: newKind.value, label: text, task: t ? { key: t.key, summary: t.summary } : undefined })
  const list = added.value[periodKey.value] ?? []
  if (!list.some((x) => x.key === row.key) && !rows.value.some((x) => x.key === row.key)) added.value = { ...added.value, [periodKey.value]: [...list, row] }
  adding.value = false
  newTask.value = []
  newLabel.value = ''
}
function removeRow(r: Row): void {
  added.value = { ...added.value, [periodKey.value]: (added.value[periodKey.value] ?? []).filter((x) => x.key !== r.key) }
}

// ---------- copying the previous week ----------
const copyOpen = ref(false)
const copyEl = ref<HTMLElement>()
const copyPd = ref<HTMLElement>()
const copyStyle = ref<Record<string, string>>({})
useAnchor(copyOpen, copyEl, () => copyEl.value && (copyStyle.value = placeFloat(copyEl.value, 200, false, 40).style))
async function copyPrev(withHours: boolean): Promise<void> {
  copyOpen.value = false
  const span = cols.value.length
  const prevCols = cols.value.map((d) => shiftDay(d, -span))
  const prev = await window.qa.rangeDays(prevCols[0], prevCols[prevCols.length - 1])
  // what came by itself (meetings, found calls) is not copied
  const own = prev.flatMap((d) => d.entries.filter((e) => !e.outlook && e.source !== 'detected').map((e) => ({ day: d.day, e })))
  const prevRows = new Map<string, SheetRow>()
  for (const { e } of own) prevRows.set(rowKeyOf(e), rowOf(e))
  if (!withHours) {
    const list = [...(added.value[periodKey.value] ?? [])]
    for (const r of prevRows.values()) if (!list.some((x) => x.key === r.key) && !rows.value.some((x) => x.key === r.key)) list.push(r)
    added.value = { ...added.value, [periodKey.value]: list }
    return
  }
  const plan: Array<{ row: SheetRow; day: string; ms: number }> = []
  for (const [key, row] of prevRows)
    prevCols.forEach((pd, i) => {
      const ms = unionMs(own.filter((x) => x.day === pd && rowKeyOf(x.e) === key).map((x) => x.e))
      const d = cols.value[i]
      const cur = rows.value.find((r) => r.key === key)?.cells.get(d)?.ms ?? 0
      if (ms >= 60_000 && cur === 0) plan.push({ row, day: d, ms })
    })
  if (!plan.length) return
  const sum = plan.reduce((s, p) => s + p.ms, 0)
  if (!confirm(`Добавить ${plan.length} блоков (${formatDuration(sum)}) как на прошлой неделе?`)) return
  busy.value = true
  try {
    for (const p of plan) {
      await setHours(p.row, p.day, p.ms)
      await load()
    }
  } finally {
    await load()
    busy.value = false
  }
}
function onDown(e: MouseEvent): void {
  if (copyOpen.value && !copyEl.value?.contains(e.target as Node) && !copyPd.value?.contains(e.target as Node)) copyOpen.value = false
  if (adding.value && !addEl.value?.contains(e.target as Node) && !addPd.value?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.dd')) adding.value = false
}
onMounted(() => window.addEventListener('mousedown', onDown, true))
onBeforeUnmount(() => window.removeEventListener('mousedown', onDown, true))
</script>

<template>
  <div class="sh" :class="{ widget }">
    <div v-if="!range" class="bar">
      <div class="seg">
        <button :class="{ on: mode === 'week' }" @click="setMode('week')">Неделя</button>
        <button :class="{ on: mode === 'day' }" @click="setMode('day')">День</button>
      </div>
      <div class="nav" title="Колесо мыши — день / неделя вперёд или назад" @wheel.prevent="onWheel">
        <button class="ib" title="Назад" @click="shift(-1)"><Icon name="chevronLeft" :size="14" /></button>
        <button ref="plEl" class="pl" :class="{ on: pickerOpen, now: isCurrent }" title="Выбрать период" @click="pickerOpen = !pickerOpen"><Icon name="calendar" :size="12" />{{ label }}</button>
        <button class="ib" title="Вперёд" @click="shift(1)"><Icon name="chevronRight" :size="14" /></button>
        <button v-if="!isCurrent" class="ib" title="Сейчас" @click="goToday"><Icon name="clock" :size="13" /></button>
      </div>
      <DateRangePicker v-if="pickerOpen" :from="cols[0]" :to="cols[cols.length - 1]" :anchor="plEl" :max="62" @apply="applyRange" @close="pickerOpen = false" />
      <span class="sp"></span>
      <FilterMenu v-model="kindFilter" label="Вид" icon="tag" :options="kindOpts" />
      <span v-if="busy" class="busy"><Icon name="refresh" :size="13" /></span>
      <div ref="addEl" class="pop">
        <button class="btn" :class="{ on: adding }" title="Добавить строку" @click="adding = !adding"><Icon name="plus" :size="13" /><span class="bl">Строка</span></button>
        <Teleport to="body">
        <div v-if="adding" ref="addPd" class="pd add" :style="addStyle">
          <div class="kinds">
            <button v-for="k in pickable" :key="k.id" :class="{ on: newKind === k.id }" :style="{ '--c': k.color }" :title="k.label" @click="newKind = k.id"><Icon :name="k.icon" :size="13" /></button>
          </div>
          <div class="arow">
            <TaskPicker v-model="newTask" single compact />
            <input v-model="newLabel" class="ain" :placeholder="newTask[0] ? newTask[0].summary : kindLabel(newKind)" @keydown.enter="addRow" />
          </div>
          <button class="btn pri" @click="addRow"><Icon name="check" :size="13" />Добавить</button>
        </div>
        </Teleport>
      </div>
      <div ref="copyEl" class="pop">
        <button class="ib" :class="{ on: copyOpen }" :title="cols.length === 1 ? 'Как вчера' : 'Как в прошлый период'" @click="copyOpen = !copyOpen"><Icon name="copy" :size="14" /></button>
        <Teleport to="body">
        <div v-if="copyOpen" ref="copyPd" class="pd menu" :style="copyStyle">
          <button @click="copyPrev(false)"><Icon name="list" :size="13" />Только строки</button>
          <button @click="copyPrev(true)"><Icon name="clock" :size="13" />Строки и часы</button>
        </div>
        </Teleport>
      </div>
      <button class="ib" title="Обновить" @click="load"><Icon name="refresh" :size="14" /></button>
    </div>

    <div class="wrap">
      <table class="sheet" :style="{ width: `${tableW}px` }">
        <colgroup>
          <col :style="{ width: `${colW.rl}px` }" />
          <col v-for="d in cols" :key="d" :style="{ width: `${colW.dc}px` }" />
          <col v-if="cols.length > 1" :style="{ width: `${colW.tc}px` }" />
        </colgroup>
        <thead>
          <tr>
            <th class="rl">Задача<span class="crz" title="Ширина" @pointerdown.prevent="startColResize($event, 'rl')"></span></th>
            <th v-for="d in cols" :key="d" class="dc" :class="{ off: isOff(d), today: d === today() }">
              <button class="dh" title="Открыть день" @click="emit('go', 'day', d)">
                <span class="dw">{{ fmt(d, { weekday: 'short' }) }}</span><b>{{ fmt(d, { day: 'numeric' }) }}</b>
              </button>
              <span class="crz" title="Ширина" @pointerdown.prevent="startColResize($event, 'dc')"></span>
            </th>
            <th v-if="cols.length > 1" class="tc">Итого<span class="crz" title="Ширина" @pointerdown.prevent="startColResize($event, 'tc')"></span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.key" :class="{ locked: r.locked }">
            <td class="rl">
              <span class="rlab">
                <span class="eic" :style="{ background: kindColor(r.kind) }" :title="kindLabel(r.kind)"><Icon :name="entryIcon(r)" :size="11" :stroke="2.4" /></span>
                <b v-if="r.task" class="key">{{ r.task.key }}</b>
                <span class="rt" :title="r.task ? r.task.summary : r.label">{{ r.task ? r.task.summary : r.label }}</span>
                <Icon v-if="r.locked" name="outlook" :size="12" class="lk" />
                <button v-if="r.manual && !r.total" class="rx" title="Убрать строку" @click="removeRow(r)"><Icon name="x" :size="11" /></button>
              </span>
            </td>
            <td v-for="d in cols" :key="d" class="cell" :class="{ off: isOff(d), today: d === today(), bad: bad === cellId(r, d) }" @click="editing !== cellId(r, d) && startEdit(r, d)">
              <input
                v-if="editing === cellId(r, d)"
                v-model="draft"
                v-focus
                class="cin"
                @keydown="onCellKey($event, r, d)"
                @blur="commit(r, d)"
              />
              <span v-else class="cv" :class="{ zero: !r.cells.get(d)?.ms }">{{ formatHours(r.cells.get(d)?.ms ?? 0) }}</span>
            </td>
            <td v-if="cols.length > 1" class="tc">{{ formatHours(r.total) }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="cols.length + 2" class="empty">Пусто — добавьте строку</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="sum">
            <td class="rl">Итого</td>
            <td v-for="d in cols" :key="d" class="cell" :class="{ off: isOff(d), today: d === today() }">{{ formatHours(dayTotal(d)) }}</td>
            <td v-if="cols.length > 1" class="tc">{{ formatHours(grand) }}</td>
          </tr>
          <tr v-for="(k, ki) in kindRows" :key="k.kind" class="kt" :class="{ first: ki === 0 }">
            <td class="rl"><span class="kname"><i :style="{ background: kindColor(k.kind) }"></i>{{ kindLabel(k.kind) }}</span></td>
            <td v-for="d in cols" :key="d" class="cell" :class="{ off: isOff(d), today: d === today() }">{{ formatHours(k.per.get(d) ?? 0) }}</td>
            <td v-if="cols.length > 1" class="tc">{{ formatHours(k.total) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.sh {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
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
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.25);
  color: var(--text-hi);
}
.nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pl {
  min-width: 110px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
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
.ib:hover,
.ib.on {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.btn:hover,
.btn.on {
  background: rgba(255, 255, 255, 0.06);
}
.btn.pri {
  justify-content: center;
  border-color: transparent;
  background: var(--accent);
  color: var(--on-accent);
}
.busy {
  display: inline-flex;
  color: var(--accent-fg);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.pop {
  position: relative;
}
.pd {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 40;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--panel-2);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.pd.menu {
  min-width: 190px;
  display: flex;
  flex-direction: column;
}
.pd.menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.pd.menu button:hover {
  background: rgb(var(--accent-rgb) / 0.16);
}
.pd.add {
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}
.kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.kinds button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: color-mix(in srgb, var(--c) 14%, transparent);
  color: var(--c);
}
.kinds button.on {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 30%, transparent);
  color: var(--text-hi);
}
.arow {
  display: flex;
  gap: 6px;
  align-items: center;
}
.ain {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-size: 12.5px;
}
/* the table: the task column and the header stay put while it scrolls */
.wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 12px 16px;
}
.sheet {
  width: 100%;
  min-width: 720px;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12.5px;
}
.sheet.one {
  min-width: 0;
  max-width: 640px;
}
th,
td {
  border-bottom: 1px solid var(--border);
}
thead th {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--bg, var(--bg));
  padding: 5px 0;
  white-space: nowrap;
  color: var(--muted);
  font-weight: 500;
  font-size: 11.5px;
}
.rl {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--bg, var(--bg));
  width: 34%;
  min-width: 220px;
  max-width: 380px;
  padding: 0 10px 0 2px;
  text-align: left;
}
thead .rl {
  z-index: 4;
}
.dc,
.tc {
  width: 76px;
  text-align: right;
}
/* one line: "пн 13"; a narrow column keeps only the date (never a second line) */
.dh {
  container-type: inline-size;
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 4px;
  width: 100%;
  box-sizing: border-box;
  white-space: nowrap;
  overflow: hidden;
  padding: 2px 10px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: inherit;
  line-height: 1.15;
}
@container (max-width: 52px) {
  .dw {
    display: none;
  }
}
.dh:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
}
.dh b {
  font-size: 13px;
  color: var(--text-2);
}
.dc.today .dh b,
.dc.today .dh {
  color: var(--accent-fg);
}
.tc {
  padding-right: 10px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  font-weight: 600;
}
.rlab {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  min-width: 0;
}
.eic {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--r2);
  color: var(--text-hi);
}
.key {
  flex: none;
  color: var(--info-fg);
  font-size: 12px;
}
.rt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lk {
  flex: none;
  color: var(--info);
}
.rx {
  flex: none;
  display: inline-flex;
  margin-left: auto;
  padding: 3px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.rx:hover {
  color: var(--down-fg);
}
.cell {
  height: 34px;
  padding: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  cursor: text;
}
.cell.off {
  background: rgba(255, 255, 255, 0.015);
}
.cell.today {
  background: rgb(var(--accent-rgb) / 0.06);
}
tbody .cell:hover {
  background: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 0 0 1px rgb(var(--accent-rgb) / 0.35);
}
tr.locked .cell {
  cursor: default;
}
tr.locked .cell:hover {
  box-shadow: none;
}
.cv {
  display: block;
  padding: 0 10px;
}
.cv.zero::before {
  content: '·';
  color: var(--border-3);
}
.cin {
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  padding: 0 9px;
  border: 1px solid var(--accent);
  border-radius: var(--r2);
  outline: none;
  background: var(--panel);
  color: var(--text-hi);
  font: inherit;
  text-align: right;
}
.cell.bad .cin {
  border-color: var(--down);
  animation: shake 0.3s;
}
@keyframes shake {
  25% {
    transform: translateX(-3px);
  }
  75% {
    transform: translateX(3px);
  }
}
tfoot td {
  height: 30px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
tfoot .cell {
  padding-right: 10px;
  cursor: default;
}
.sum td {
  font-weight: 600;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}
.qa td {
  color: var(--muted);
  font-size: 11.5px;
}
.empty {
  padding: 18px 4px;
  color: var(--muted);
}
/* the dashboard's: tighter */
.sh.widget .bar {
  padding: 6px 8px;
  gap: 4px 6px;
}
.sh.widget .wrap {
  padding: 0 8px 8px;
}
.sh.widget .sheet,
.sh.widget .sheet.one {
  min-width: 0;
  max-width: none;
  font-size: 12px;
}
.sh.widget .rl {
  min-width: 140px;
}
.sh.widget .rlab,
.sh.widget .cell {
  height: 30px;
}
.sh.widget .pl {
  min-width: 80px;
  font-size: 12px;
}
/* the period label opens the calendar */
button.pl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
}
button.pl:hover,
button.pl.on {
  background: rgba(255, 255, 255, 0.07);
}
button.pl.now {
  color: var(--accent-fg);
}
button.pl.now :deep(svg) {
  color: var(--accent);
}
button.pl :deep(svg) {
  color: var(--muted);
}
/* fixed columns, each edge drags */
.sheet {
  table-layout: fixed;
  min-width: 0 !important;
  max-width: none !important;
}
th {
  position: sticky;
}
.crz {
  position: absolute;
  top: 4px;
  bottom: 4px;
  right: -3px;
  z-index: 5;
  width: 6px;
  cursor: col-resize;
  border-radius: var(--r2);
}
.crz:hover {
  background: rgb(var(--accent-rgb) / 0.55);
}
.rt {
  min-width: 0;
}
/* the dashboard's bar: one line */
.sh.widget .bar {
  flex-wrap: nowrap;
  height: 34px;
  padding: 0 8px;
  overflow: hidden;
}
.sh.widget .seg button {
  height: 22px;
  padding: 0 7px;
  font-size: 11.5px;
}
.sh.widget .ib {
  width: 24px;
  height: 24px;
}
.sh.widget .btn {
  height: 24px;
  padding: 0 7px;
}
.sh.widget .bl,
.sh.widget :deep(.fl) {
  display: none;
}
.sh.widget :deep(.fb) {
  height: 24px;
  padding: 0 6px;
}
.sh.widget button.pl {
  height: 24px;
  white-space: nowrap;
}
/* per kind, under the total */
.kt td {
  height: 26px;
  color: var(--text-2);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.kt.first td {
  border-top: 1px dashed var(--border);
}
.kname {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
.kname i {
  width: 9px;
  height: 9px;
  border-radius: var(--r2);
}
</style>
