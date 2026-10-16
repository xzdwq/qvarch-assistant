<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clipEntries, dayEnd, dayStart, formatDuration, formatHM, HOUR, MINUTE, scheduleRanges, unionMs } from '@shared/timeline'
import { productiveMs } from '@shared/kinds'
import { visibleNotes } from '@shared/notes'
import type { PublicSettings, Selection } from '@shared/types'
import { useSelection } from '../lib/selection'
import { addWidget, arrange, COLS, OLD_COLS_SCALE, resizeWidget, DEFAULT_DASHBOARD, WIDGETS, widgetInfo, type Widget, type WidgetType } from '@shared/dashboard'
import Icon from '../components/Icon.vue'
import Timeline from '../components/Timeline.vue'
import NoteList from '../components/NoteList.vue'
import TaskCalendar from '../components/TaskCalendar.vue'
import ThinkingOrb from '../components/ThinkingOrb.vue'
import TaskList from './TaskList.vue'
import { kinds } from '../lib/palette'
import { useDay } from '../lib/useDay'
import { todayKey } from '../lib/today'
import { useTitleActions } from '../lib/titlebar'
import { askSeries } from '../lib/seriesAsk'
import DayStrip from '../components/DayStrip.vue'
import EntryRecords from '../components/EntryRecords.vue'
import EntryEditor, { type AddPrefs, type Draft } from '../components/EntryEditor.vue'
import NotebookView from './NotebookView.vue'
import SheetView from './SheetView.vue'
import NoteEditor from '../components/NoteEditor.vue'

/**
 * Дашборд — the things the user picked, laid out on a grid: drag a widget by its header, pull its corner
 * to resize (snapped to the grid); widgets push each other and float up — rows, columns, stacks.
 */
const props = defineProps<{ settings: PublicSettings }>()
const emit = defineEmits<{ go: [view: 'day' | 'calendar' | 'work' | 'notebook' | 'settings', day?: string, entryId?: string] }>()

// ---------- the layout (remembered) ----------
/** The layout on the 60-column grid; one saved on the old 12-column grid (qa.dash) is scaled over once. */
const KEY = 'qa.dash.v60'
const OLD_KEY = 'qa.dash'
function readLayout(): Widget[] {
  // widgets of removed kinds drop out — the rest of a saved layout stays
  const known = (v: unknown): Widget[] | undefined => (Array.isArray(v) ? (v as Widget[]).filter((w) => w && WIDGETS.some((x) => x.type === w.type)) : undefined)
  try {
    const v = known(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
    if (v?.length) return arrange(v)
    const old = known(JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null'))
    if (old?.length) return arrange(old.map((w) => ({ ...w, x: w.x * OLD_COLS_SCALE, w: w.w * OLD_COLS_SCALE })))
  } catch {
    // a broken layout — the default one
  }
  return arrange(DEFAULT_DASHBOARD)
}
const layout = ref<Widget[]>(readLayout())
watch(
  layout,
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      // not remembered — fine
    }
  },
  { deep: true },
)
const editing = ref(false)
const addOpen = ref(false)
/** The timeline widget (its follow switch is in the title bar — the widget has no legend). */
let tl: InstanceType<typeof Timeline> | undefined
useTitleActions(() => [
  ...(layout.value.some((w) => w.type === 'timeline') && !editing.value
    ? [{ id: 'follow', icon: 'follow', title: 'Автопрокрутка', on: props.settings.ui.timeline.follow, click: () => (tl ? tl.toggleFollow() : void window_follow(!props.settings.ui.timeline.follow)) }]
    : []),
  ...(editing.value
    ? [
        { id: 'add', icon: 'plus', title: 'Виджет', menu: missing.value.map((w) => ({ label: w.label, icon: w.icon, click: () => add(w.type) })) },
        { id: 'reset', icon: 'refresh', title: 'Сбросить', click: reset },
        { id: 'done', icon: 'check', title: 'Готово', on: true, click: () => (editing.value = false) },
      ]
    : [
        { id: 'create', icon: 'plus', title: 'Создать', click: () => openQuick('event') },
        { id: 'edit', icon: 'dashboard', title: 'Настроить', click: () => (editing.value = true) },
      ]),
])
// ---------- create anything from the title bar: an event or a note, in a window over everything ----------
const quick = ref<'event' | 'note'>()
const quickNote = ref({ id: '', at: 0, text: '', isNew: true })
const quickKey = ref(0)
function openQuick(kind: 'event' | 'note'): void {
  quick.value = kind
  quickNote.value = { id: crypto.randomUUID(), at: Date.now(), text: '', isNew: true }
  quickKey.value++
}
function onQuickKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && quick.value) quick.value = undefined
}
onMounted(() => window.addEventListener('keydown', onQuickKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onQuickKey))
const missing = computed(() => WIDGETS.filter((w) => !layout.value.some((x) => x.type === w.type)))
function add(type: WidgetType): void {
  layout.value = addWidget(layout.value, type, `${type}-${Date.now()}`)
  addOpen.value = false
}
function remove(i: string): void {
  layout.value = arrange(layout.value.filter((w) => w.i !== i))
}
function reset(): void {
  if (confirm('Вернуть дашборд к раскладке по умолчанию?')) layout.value = arrange(DEFAULT_DASHBOARD)
}

// ---------- the grid ----------
const ROW_H = 44
const GAP = 6
const grid = ref<HTMLElement>()
const gridW = ref(1200)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(() => grid.value && (gridW.value = grid.value.clientWidth))
  if (grid.value) ro.observe(grid.value)
})
onBeforeUnmount(() => ro?.disconnect())
const colW = computed(() => (gridW.value - (COLS - 1) * GAP) / COLS)
/** While dragging: the layout as it would be (the others make room live). */
const preview = ref<Widget[]>()
const shown = computed(() => preview.value ?? layout.value)
const box = (w: Widget) => ({
  left: `${w.x * (colW.value + GAP)}px`,
  top: `${w.y * (ROW_H + GAP)}px`,
  width: `${w.w * colW.value + (w.w - 1) * GAP}px`,
  height: `${w.h * ROW_H + (w.h - 1) * GAP}px`,
})
const gridH = computed(() => Math.max(...shown.value.map((w) => (w.y + w.h) * (ROW_H + GAP)), 200))

/** The sides a widget is pulled by (and its corners). */
const EDGES = ['t', 'r', 'b', 'l', 'tl', 'tr', 'bl', 'br']
const drag = ref<{ i: string; mode: string; x0: number; y0: number; orig: Widget }>()
function startDrag(e: PointerEvent, w: Widget, mode: string): void {
  if (!editing.value || e.button !== 0) return
  e.preventDefault()
  drag.value = { i: w.i, mode, x0: e.clientX, y0: e.clientY, orig: { ...w } }
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', endDrag, { once: true })
}
function onDrag(e: PointerEvent): void {
  const d = drag.value
  if (!d) return
  const dx = Math.round((e.clientX - d.x0) / (colW.value + GAP))
  const dy = Math.round((e.clientY - d.y0) / (ROW_H + GAP))
  preview.value =
    d.mode === 'move'
      ? arrange([...layout.value.filter((w) => w.i !== d.i), { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }], d.i)
      : resizeWidget(layout.value, d.i, d.mode, dx, dy)
}
function endDrag(): void {
  window.removeEventListener('pointermove', onDrag)
  if (preview.value) layout.value = preview.value
  preview.value = undefined
  drag.value = undefined
}
onBeforeUnmount(() => window.removeEventListener('pointermove', onDrag))

// ---------- today's data for the widgets ----------
const today = todayKey
const { data, live, now, cursor, reload } = useDay(today)
// the timeline widget edits like the timeline page: move, resize, kind, delete, merge
async function onMove(c: { id: string; start: number; end: number; lane: number }): Promise<void> {
  const e = data.value.entries.find((x) => x.id === c.id)
  if (!e || e.outlook) return
  await window.qa.saveEntry(today.value, { ...e, start: c.start, end: c.end, lane: c.lane }, { overlap: true })
  await reload()
}
async function onResize(c: { id: string; start: number; end: number }): Promise<void> {
  const e = data.value.entries.find((x) => x.id === c.id)
  if (!e || e.outlook) return
  await window.qa.saveEntry(today.value, { ...e, start: c.start, end: c.end }, { overlap: true })
  await reload()
}
async function onKind(c: { id: string; kind: string }): Promise<void> {
  const e = data.value.entries.find((x) => x.id === c.id)
  if (!e || e.outlook) return
  await window.qa.saveEntry(today.value, { ...e, kind: c.kind }, { overlap: true })
  await reload()
}
async function onDelete(id: string): Promise<void> {
  const e = data.value.entries.find((x) => x.id === id)
  if (!e || e.outlook) return
  if (e.series) {
    const scope = await askSeries('delete')
    if (!scope) return
    if (scope === 'all') await window.qa.seriesDelete(today.value, id)
    else await window.qa.deleteEntry(today.value, id)
  } else await window.qa.deleteEntry(today.value, id)
  await reload()
}
async function onMerge(ids: string[]): Promise<void> {
  await window.qa.mergeEntries(today.value, ids)
  await reload()
}
async function onPlanChange(c: { id: string; start: number; end: number }): Promise<void> {
  const p = data.value.plan?.find((x) => x.id === c.id)
  if (!p) return
  await window.qa.savePlan(today.value, { ...p, task: p.task ? { ...p.task } : undefined, start: c.start, end: c.end })
  await reload()
}
const schedule = computed(() => scheduleRanges(today.value, props.settings.schedule))
const bounds = computed<[number, number]>(() => [dayStart(today.value), dayEnd(today.value)])
const initial = computed<[number, number]>(() => {
  // the work day, the day's blocks and now
  const starts = data.value.entries.map((e) => e.start)
  const ends = [...data.value.entries.map((e) => e.end), now.value]
  if (schedule.value.work) {
    starts.push(schedule.value.work[0])
    ends.push(schedule.value.work[1])
  }
  const from = starts.length ? Math.min(...starts) : dayStart(today.value) + 9 * HOUR
  const to = Math.max(...ends)
  return [Math.max(dayStart(today.value), Math.floor((from - 15 * MINUTE) / HOUR) * HOUR), Math.min(dayEnd(today.value), Math.ceil((to + 15 * MINUTE) / HOUR) * HOUR)]
})
const stats = computed(() => {
  const entries = clipEntries(data.value.entries, now.value)
  const calls = entries.filter((e) => e.kind === 'call' || e.kind === 'meeting')
  return { labelled: unionMs(entries), productive: productiveMs(entries, kinds.value), calls: unionMs(calls), count: data.value.entries.length }
})
const notes = computed(() => visibleNotes(data.value.notes))
// creating a block: from now, ± minutes (as on the timeline page)
const createAdd = ref<AddPrefs>({ from: 'now', back: false, min: 30 })
const createKey = ref(0)
// a period selected on the timeline (shared with the day page) — "+" / "Создать" take it
const sel = useSelection()
const marker = computed<Selection | null>(() => (sel.selection.value?.day === today.value ? sel.selection.value : null))
function onSelection(s: Selection | null, commit: boolean): void {
  if (commit) sel.commit(s)
  else sel.preview(s)
}
function onEditorRange(r: { start: number; end: number; followsNow: boolean }): void {
  if (marker.value) sel.commit({ day: today.value, start: r.start, end: r.followsNow ? undefined : r.end })
}
function onCreated(): void {
  if (marker.value) sel.clear()
}
const createDraft = computed<Draft>(() => {
  const m = marker.value
  if (m) return { start: m.start, end: m.end ?? now.value, kind: 'task', label: '', source: 'manual', followsNow: !m.end }
  const b = Math.floor(now.value / MINUTE) * MINUTE
  const span = createAdd.value.min * MINUTE
  return { start: createAdd.value.back ? b - span : b, end: createAdd.value.back ? b : b + span, kind: 'task', label: '', source: 'manual', followsNow: createAdd.value.back, startsNow: !createAdd.value.back }
})
const orbText = computed(() => (live.value.inCall ? `Созвон${live.value.callApp ? ` · ${live.value.callApp}` : ''}` : 'В работе'))

</script>

<template>
  <div class="dash">

    <Teleport to="body">
      <div v-if="quick" class="qc-back" @pointerdown.self="quick = undefined">
        <div class="qc">
          <div class="qc-tabs">
            <button :class="{ on: quick === 'event' }" @click="openQuick('event')"><Icon name="plus" :size="13" />Событие</button>
            <button :class="{ on: quick === 'note' }" @click="openQuick('note')"><Icon name="note" :size="13" />Заметка</button>
            <span class="grow"></span>
            <button class="x" title="Закрыть" @click="quick = undefined"><Icon name="x" :size="14" /></button>
          </div>
          <EntryEditor
            v-if="quick === 'event'"
            :key="`qe${quickKey}`"
            :day="today"
            :entry="createDraft"
            :recent="[]"
            :now="now"
            :entries="data.entries"
            :notes="data.notes"
            :add="marker ? undefined : createAdd"
            textarea
            @update:add="(a) => (createAdd = a)"
            @range="onEditorRange"
            @saved="onCreated(), (quick = undefined)"
          />
          <NoteEditor
            v-else
            :key="`qn${quickKey}`"
            :day="today"
            :note="quickNote"
            :entries="data.entries"
            :notes="data.notes"
            @close="quick = undefined"
          />
        </div>
      </div>
    </Teleport>
    <div ref="grid" class="grid" :class="{ editing }" :style="{ height: `${gridH}px` }">
      <!-- grid cells while editing -->
      <template v-if="editing">
        <div v-for="c in COLS" :key="`g${c}`" class="gcol" :class="{ major: c % 5 === 1 }" :style="{ left: `${(c - 1) * (colW + GAP)}px`, width: `${colW}px` }"></div>
      </template>
      <section v-for="w in shown" :key="w.i" class="wd" :class="{ dragging: drag?.i === w.i }" :style="box(w)">
        <header v-if="editing" class="wh" @pointerdown="startDrag($event, w, 'move')">
          <Icon v-if="editing" name="grip" :size="13" class="grip" />
          <Icon :name="widgetInfo(w.type).icon" :size="13" />
          <span class="wt">{{ widgetInfo(w.type).label }}</span>
          <span class="grow"></span>
          <button class="wx" title="Убрать" @pointerdown.stop @click="remove(w.i)"><Icon name="x" :size="12" /></button>
        </header>
        <div class="wb" :class="`t-${w.type}`">
          <!-- while editing the contents are not clickable (the widget is moved) -->
          <div v-if="editing" class="shield"></div>

          <div v-if="w.type === 'stats'" class="stats">
            <div><span>Размечено</span><b>{{ formatDuration(stats.labelled) }}</b></div>
            <div><span>Продуктивно</span><b class="g">{{ formatDuration(stats.productive) }}</b></div>
            <div><span>Встречи и созвоны</span><b>{{ formatDuration(stats.calls) }}</b></div>
            <div><span>Записей</span><b>{{ stats.count }}</b></div>
          </div>

          <div v-else-if="w.type === 'timeline'" class="tlw">
          <Timeline
            :ref="(el) => (tl = (el as InstanceType<typeof Timeline>) ?? undefined)"
            bare
            compact
            view-key="dash"
            :data="data"
            :now="now"
            :cursor="cursor"
            :schedule="schedule"
            :bounds="bounds"
            :initial="initial"
            :selection="marker"
            :follow="settings.ui.timeline"
            @select="(id) => emit('go', 'day', today, id)"
            @selection="onSelection"
            @follow="(on) => void window_follow(on)"
            @move="onMove"
            @resize="onResize"
            @change-kind="onKind"
            @delete-entry="onDelete"
            @merge="onMerge"
            @plan-changed="reload"
            @plan-change="onPlanChange"
          />
          <DayStrip :entries="data.entries" :now="now" :countdown="settings.ui.timeline.countdown" />
          </div>

          <EntryRecords v-else-if="w.type === 'entries'" class="elist" compact :data="data" :now="now" @select="(id) => emit('go', 'day', today, id)" @changed="reload" />

          <div v-else-if="w.type === 'notes'" class="nlist">
            <NoteList v-if="notes.length" :notes="notes" :entries="data.entries" :day="today" />
            <p v-else class="empty">Заметок сегодня нет</p>
          </div>

          <TaskCalendar v-else-if="w.type === 'week'" :work-days="settings.schedule.workDays" @open-day="(d) => emit('go', 'day', d)" />
          <TaskList v-else-if="w.type === 'tasks'" @open-day="(d) => emit('go', 'day', d)" @settings="emit('go', 'settings')" />

          <div v-else-if="w.type === 'orb'" class="orb">
            <ThinkingOrb :state="live.inCall ? 'listening' : 'working'" :size="64" :px="72" />
            <b>{{ orbText }}</b>
            <span class="muted">{{ formatHM(now) }} · размечено {{ formatDuration(stats.labelled) }}</span>
          </div>

          <NotebookView v-else-if="w.type === 'notebook'" widget />
          <SheetView v-else-if="w.type === 'sheet'" :settings="settings" widget @go="(v, d, id) => emit('go', v, d, id)" />

          <div v-else-if="w.type === 'create'" class="cre">
            <EntryEditor
              :key="createKey"
              :day="today"
              :entry="createDraft"
              :recent="[]"
              :now="now"
              :entries="data.entries"
              :notes="data.notes"
              :add="marker ? undefined : createAdd"
              textarea
              @update:add="(a) => (createAdd = a)"
              @range="onEditorRange"
              @saved="onCreated(), createKey++"
            />
          </div>
        </div>
        <template v-if="editing">
          <div v-for="g in EDGES" :key="g" class="rz" :class="`e-${g}`" @pointerdown.stop="startDrag($event, w, g)"></div>
        </template>
      </section>
    </div>
  </div>
</template>

<script lang="ts">
/** The follow-the-time switch of the timeline widget — the same setting as on the timeline page. */
async function window_follow(on: boolean): Promise<void> {
  await window.qa.updateSettings({ ui: { timeline: { follow: on } } })
}
</script>

<style scoped>
.dash {
  padding: 8px 10px 20px;
}
.dbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.dbar h2 {
  margin: 0;
  font-size: 16px;
}
.dbar button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 4px;
  font-size: 12.5px;
}
.dbar .ghost {
  background: transparent;
  border-color: transparent;
  color: var(--muted);
}
.grow {
  flex: 1;
}
.addw {
  position: relative;
}
.addmenu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 30;
  min-width: 220px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--panel-2);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.addmenu button {
  justify-content: flex-start;
  border: 0;
  background: transparent;
}
.addmenu button:hover {
  background: rgb(var(--accent-rgb) / 0.16);
}
.grid {
  position: relative;
}
.gcol {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgb(var(--accent-rgb) / 0.025);
}
.gcol.major {
  border-left: 1px dashed rgb(var(--accent-rgb) / 0.22);
}
.wd {
  position: absolute;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-radius: var(--r3);
  border: 1px solid var(--border);
  background: var(--panel);
  overflow: hidden;
  transition:
    left 0.15s,
    top 0.15s,
    width 0.15s,
    height 0.15s;
}
.wd.dragging {
  z-index: 10;
  transition: none;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  border-color: rgb(var(--accent-rgb) / 0.7);
}
.wh {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 600;
  user-select: none;
}
.editing .wh {
  cursor: grab;
  background: rgb(var(--accent-rgb) / 0.08);
}
.grip {
  color: var(--muted);
}
.wt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx,
.wgo {
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.wx:hover,
.wgo:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}
.wb {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.shield {
  position: absolute;
  inset: 0;
  z-index: 5;
}
/* while editing every side pulls: a lit edge under the pointer, a small dot in the corner */
.editing .wd {
  border-color: rgb(var(--accent-rgb) / 0.45);
}
.rz {
  position: absolute;
  z-index: 6;
}
.rz.e-t,
.rz.e-b {
  left: 10px;
  right: 10px;
  height: 7px;
  cursor: ns-resize;
}
.rz.e-l,
.rz.e-r {
  top: 10px;
  bottom: 10px;
  width: 7px;
  cursor: ew-resize;
}
.rz.e-t {
  top: 0;
}
.rz.e-b {
  bottom: 0;
}
.rz.e-l {
  left: 0;
}
.rz.e-r {
  right: 0;
}
.rz.e-t::after,
.rz.e-b::after,
.rz.e-l::after,
.rz.e-r::after {
  content: '';
  position: absolute;
  border-radius: 2px;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.12s;
}
.rz.e-t::after,
.rz.e-b::after {
  left: 0;
  right: 0;
  height: 3px;
}
.rz.e-t::after {
  top: 0;
}
.rz.e-b::after {
  bottom: 0;
}
.rz.e-l::after,
.rz.e-r::after {
  top: 0;
  bottom: 0;
  width: 3px;
}
.rz.e-l::after {
  left: 0;
}
.rz.e-r::after {
  right: 0;
}
.rz:hover::after {
  opacity: 0.9;
}
.rz.e-tl,
.rz.e-tr,
.rz.e-bl,
.rz.e-br {
  z-index: 7;
  width: 12px;
  height: 12px;
}
.rz.e-tl {
  left: 0;
  top: 0;
  cursor: nwse-resize;
}
.rz.e-tr {
  right: 0;
  top: 0;
  cursor: nesw-resize;
}
.rz.e-bl {
  left: 0;
  bottom: 0;
  cursor: nesw-resize;
}
.rz.e-br {
  right: 0;
  bottom: 0;
  cursor: nwse-resize;
}
.rz.e-br::after {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--accent);
}
/* widgets */
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  padding: 10px 16px;
}
.stats div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stats span {
  color: var(--muted);
  font-size: 11.5px;
}
.stats b {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.stats b.g {
  color: var(--up);
}
.stats b.y {
  color: var(--warn);
}
.wb.t-timeline :deep(.tl) {
  flex: none;
  border: 0;
  border-radius: 0;
}
.wb.t-week {
  padding: 8px;
}
.wb.t-week :deep(.wrap) {
  height: auto;
  min-height: 0;
}
.tlw {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.wb.t-notebook,
.wb.t-sheet {
  overflow: hidden;
}
.wb.t-notebook :deep(.nb) {
  height: 100%;
}
.cre {
  padding: 10px 12px;
}
.wb.t-calendar,
.wb.t-tasks,
.wb.t-notes {
  padding: 8px 10px;
}
/* every widget's own header: one line, the same height (34px), no gap above it */
.wb.t-calendar,
.wb.t-tasks,
.wb.t-notes,
.wb.t-week {
  padding-top: 0;
}
.elist {
  padding-top: 0 !important;
}
.wb.t-entries :deep(.esum),
.wb.t-sheet :deep(.bar),
.wb.t-notebook :deep(.tabs),
.wb.t-notebook :deep(.ntools),
.wb.t-calendar :deep(.head),
.wb.t-week :deep(.bar),
.wb.t-tasks :deep(.topbar) {
  box-sizing: border-box;
  height: 34px;
  min-height: 34px;
  margin-top: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
  flex-wrap: nowrap;
  overflow: hidden;
  align-items: center;
}
.wb.t-calendar :deep(.head h2) {
  font-size: 14px;
}

.elist {
  padding: 6px 4px;
}
.mk {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: var(--r2);
}
.orb {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  padding: 8px;
}
.orb .muted {
  font-size: 11.5px;
}
.empty {
  margin: 10px 12px;
  color: var(--muted);
  font-size: 12.5px;
}
</style>

<style>
/* "Создать" from the title bar — over everything */
.qc-back {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 70px;
  background: rgba(13, 17, 23, 0.5);
}
.qc {
  width: 520px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 100px);
  overflow: auto;
  padding: 12px 16px 16px;
  border-radius: var(--r3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--panel);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.qc-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
}
.qc-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
}
.qc-tabs button.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--text-hi);
}
.qc-tabs .grow {
  flex: 1;
}
.qc-tabs .x {
  padding: 5px;
}
</style>
