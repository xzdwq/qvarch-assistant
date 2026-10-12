<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { atTime, formatDuration, scheduleRanges, shiftDay, unionMs } from '@shared/timeline'
import { daysBetween, formatHours, parseHours, placeTime, rowKeyOf, rowOf, takeTime, weekStart, type RangeDay, type SheetRow } from '@shared/report'
import type { Entry, PublicSettings } from '@shared/types'
import type { TaskRef } from '@shared/jira'
import { kindColor, kindLabel, kinds, entryIcon } from '../lib/palette'
import Icon from '../components/Icon.vue'
import TaskPicker from '../components/TaskPicker.vue'

/**
 * Заполнение — the week (or a day) as a table: a row per task (or kind + text), a column per day. Typing
 * hours into a cell makes real blocks on the timeline (into free working time) or takes time away from
 * the row's blocks; Outlook meetings are never changed.
 */
const props = defineProps<{ settings: PublicSettings }>()
const emit = defineEmits<{ go: [view: 'day', day?: string, entryId?: string] }>()

const today = () => new Date().toLocaleDateString('sv-SE')
const mode = ref<'week' | 'day'>('week')
const anchor = ref(today())
const cols = computed(() => (mode.value === 'week' ? daysBetween(weekStart(anchor.value), shiftDay(weekStart(anchor.value), 6)) : [anchor.value]))
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', o)
const label = computed(() => {
  const a = cols.value[0]
  const b = cols.value[cols.value.length - 1]
  return mode.value === 'day' ? fmt(a, { weekday: 'short', day: 'numeric', month: 'short' }) : `${fmt(a, { day: 'numeric', month: a.slice(5, 7) === b.slice(5, 7) ? undefined : 'short' })} – ${fmt(b, { day: 'numeric', month: 'short' })}`
})
const isCurrent = computed(() => cols.value.includes(today()))
const shift = (dir: 1 | -1) => (anchor.value = shiftDay(anchor.value, dir * (mode.value === 'week' ? 7 : 1)))

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
const periodKey = computed(() => (mode.value === 'week' ? weekStart(anchor.value) : anchor.value))
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
    for (const e of d.entries) {
      const row = ensure(rowOf(e), false)
      const c = row.cells.get(d.day) ?? { ms: 0, blocks: [] }
      c.blocks.push(e)
      row.cells.set(d.day, c)
    }
  for (const r of added.value[periodKey.value] ?? []) ensure(r, true)
  for (const row of m.values()) {
    for (const c of row.cells.values()) c.ms = unionMs(c.blocks)
    row.total = unionMs([...row.cells.values()].flatMap((c) => c.blocks))
    const blocks = [...row.cells.values()].flatMap((c) => c.blocks)
    row.locked = blocks.length > 0 && blocks.every((b) => b.outlook)
  }
  return [...m.values()].sort((a, b) => Number(!a.task) - Number(!b.task) || kindOrder(a.kind) - kindOrder(b.kind) || (a.task?.key ?? a.label).localeCompare(b.task?.key ?? b.label))
})
const dayTotal = (d: string) => unionMs(dayOf(d)?.entries ?? [])
const pcOn = (d: string) => dayOf(d)?.pcOnMs ?? 0
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
async function copyPrev(withHours: boolean): Promise<void> {
  copyOpen.value = false
  const span = mode.value === 'week' ? 7 : 1
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
  if (copyOpen.value && !copyEl.value?.contains(e.target as Node)) copyOpen.value = false
  if (adding.value && !addEl.value?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.dd')) adding.value = false
}
onMounted(() => window.addEventListener('mousedown', onDown, true))
onBeforeUnmount(() => window.removeEventListener('mousedown', onDown, true))
</script>

<template>
  <div class="sh">
    <div class="bar">
      <div class="seg">
        <button :class="{ on: mode === 'week' }" @click="mode = 'week'">Неделя</button>
        <button :class="{ on: mode === 'day' }" @click="mode = 'day'">День</button>
      </div>
      <div class="nav">
        <button class="ib" title="Назад" @click="shift(-1)"><Icon name="chevronLeft" :size="14" /></button>
        <span class="pl">{{ label }}</span>
        <button class="ib" title="Вперёд" @click="shift(1)"><Icon name="chevronRight" :size="14" /></button>
        <button v-if="!isCurrent" class="ib" title="Сейчас" @click="anchor = today()"><Icon name="clock" :size="13" /></button>
      </div>
      <span class="sp"></span>
      <span v-if="busy" class="busy"><Icon name="refresh" :size="13" /></span>
      <div ref="addEl" class="pop">
        <button class="btn" :class="{ on: adding }" @click="adding = !adding"><Icon name="plus" :size="13" />Строка</button>
        <div v-if="adding" class="pd add">
          <div class="kinds">
            <button v-for="k in pickable" :key="k.id" :class="{ on: newKind === k.id }" :style="{ '--c': k.color }" :title="k.label" @click="newKind = k.id"><Icon :name="k.icon" :size="13" /></button>
          </div>
          <div class="arow">
            <TaskPicker v-model="newTask" single compact />
            <input v-model="newLabel" class="ain" :placeholder="newTask[0] ? newTask[0].summary : kindLabel(newKind)" @keydown.enter="addRow" />
          </div>
          <button class="btn pri" @click="addRow"><Icon name="check" :size="13" />Добавить</button>
        </div>
      </div>
      <div ref="copyEl" class="pop">
        <button class="ib" :class="{ on: copyOpen }" :title="mode === 'week' ? 'Как на прошлой неделе' : 'Как вчера'" @click="copyOpen = !copyOpen"><Icon name="copy" :size="14" /></button>
        <div v-if="copyOpen" class="pd menu">
          <button @click="copyPrev(false)"><Icon name="list" :size="13" />Только строки</button>
          <button @click="copyPrev(true)"><Icon name="clock" :size="13" />Строки и часы</button>
        </div>
      </div>
      <button class="ib" title="Обновить" @click="load"><Icon name="refresh" :size="14" /></button>
    </div>

    <div class="wrap">
      <table class="sheet" :class="{ one: mode === 'day' }">
        <thead>
          <tr>
            <th class="rl">Задача</th>
            <th v-for="d in cols" :key="d" class="dc" :class="{ off: isOff(d), today: d === today() }">
              <button class="dh" title="Открыть день" @click="emit('go', 'day', d)">
                <span>{{ fmt(d, { weekday: 'short' }) }}</span><b>{{ fmt(d, { day: 'numeric' }) }}</b>
              </button>
            </th>
            <th v-if="mode === 'week'" class="tc">Итого</th>
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
            <td v-if="mode === 'week'" class="tc">{{ formatHours(r.total) }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="cols.length + 2" class="empty">Пусто — добавьте строку</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="sum">
            <td class="rl">Итого</td>
            <td v-for="d in cols" :key="d" class="cell" :class="{ off: isOff(d), today: d === today() }">{{ formatHours(dayTotal(d)) }}</td>
            <td v-if="mode === 'week'" class="tc">{{ formatHours(grand) }}</td>
          </tr>
          <tr class="qa">
            <td class="rl">QA включено</td>
            <td v-for="d in cols" :key="d" class="cell" :class="{ off: isOff(d) }">{{ formatHours(pcOn(d)) }}</td>
            <td v-if="mode === 'week'" class="tc">{{ formatHours(cols.reduce((s, d) => s + pcOn(d), 0)) }}</td>
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
}
.seg button.on {
  background: rgba(124, 108, 246, 0.25);
  color: #fff;
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
  border-radius: 8px;
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
  border-radius: 8px;
  background: transparent;
  color: #c3c8d6;
  font-size: 12px;
}
.btn:hover,
.btn.on {
  background: rgba(255, 255, 255, 0.06);
}
.btn.pri {
  justify-content: center;
  border-color: transparent;
  background: #6d5df0;
  color: #fff;
}
.busy {
  display: inline-flex;
  color: #a78bfa;
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
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1c2030;
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
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.pd.menu button:hover {
  background: rgba(139, 92, 246, 0.16);
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
  border-radius: 8px;
  background: color-mix(in srgb, var(--c) 14%, transparent);
  color: var(--c);
}
.kinds button.on {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 30%, transparent);
  color: #fff;
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
  border-radius: 8px;
  border: 1px solid var(--border);
  background: #141824;
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
  background: var(--bg, #0f1218);
  padding: 8px 0 6px;
  color: var(--muted);
  font-weight: 500;
  font-size: 11.5px;
}
.rl {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--bg, #0f1218);
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
.dh {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  padding: 2px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  line-height: 1.15;
}
.dh:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
}
.dh b {
  font-size: 13px;
  color: #c7cbd6;
}
.dc.today .dh b,
.dc.today .dh {
  color: #c4b5fd;
}
.tc {
  padding-right: 10px;
  font-variant-numeric: tabular-nums;
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
  border-radius: 6px;
  color: #fff;
}
.key {
  flex: none;
  color: #93c5fd;
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
  color: #38bdf8;
}
.rx {
  flex: none;
  display: inline-flex;
  margin-left: auto;
  padding: 3px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}
.rx:hover {
  color: #fca5a5;
}
.cell {
  height: 34px;
  padding: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
  cursor: text;
}
.cell.off {
  background: rgba(255, 255, 255, 0.015);
}
.cell.today {
  background: rgba(124, 108, 246, 0.06);
}
tbody .cell:hover {
  background: rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 0 0 1px rgba(124, 108, 246, 0.35);
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
  color: #3a4052;
}
.cin {
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  padding: 0 9px;
  border: 1px solid #7c6cf6;
  border-radius: 6px;
  outline: none;
  background: #151927;
  color: #fff;
  font: inherit;
  text-align: right;
}
.cell.bad .cin {
  border-color: #ef4444;
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
</style>
