<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDuration, shiftDay, unionMs } from '@shared/timeline'
import { formatHours, rowOf, type SheetRow } from '@shared/report'
import type { PublicSettings } from '@shared/types'
import type { TaskRef } from '@shared/jira'
import { kindColor, kindLabel, kinds, entryIcon } from '../lib/palette'
import Icon from '../components/Icon.vue'
import TaskPicker from '../components/TaskPicker.vue'
import FilterMenu from '../components/FilterMenu.vue'
import DateRangePicker from '../components/DateRangePicker.vue'
import Popover from '../components/Popover.vue'
import { buildSheetRows, copyFromPrevious, kindTotals, type SheetGridRow } from '@shared/tracker/sheetRows'
import { fmtDay as fmt, sheetToday as today, useSheetPeriod } from '../tracker/sheet/useSheetPeriod'
import { useSheetColumns } from '../tracker/sheet/useSheetColumns'
import { useSheetDays } from '../tracker/sheet/useSheetDays'
import { useSheetHours } from '../tracker/sheet/useSheetHours'
import { readStored, storedRef } from '../tracker/sheet/sheetStorage'

/**
 * Заполнение — the week (or a day) as a table: a row per task (or kind + text), a column per day. Typing
 * hours into a cell makes real blocks on the timeline (into free working time) or takes time away from
 * the row's blocks; Outlook meetings are never changed. The pieces live in tracker/sheet.
 */
/**
 * `widget` — on the dashboard (or a tab of the timeline): a day by default, tighter. `store` — its remembered
 * view apart from the others; `day` — the day it follows (the timeline's).
 */
/** `range` — embedded (Моя работа): these days, no bar of its own. */
const props = defineProps<{ settings: PublicSettings; widget?: boolean; store?: string; day?: string; range?: { from: string; to: string } }>()
const SUFFIX = props.store ? `.${props.store}` : props.widget ? '.widget' : ''
const emit = defineEmits<{ go: [view: 'day', day?: string, entryId?: string] }>()

const { mode, cols, key: periodKey, pickerOpen, applyRange, setMode, goToday, shift, onWheel, label, isCurrent } = useSheetPeriod(props, SUFFIX)
const plEl = ref<HTMLElement>()
const { colW, tableW, startColResize } = useSheetColumns(SUFFIX, props.widget, cols)
const { days, busy, load, dayOf, kindFilter, kindOpts, shownKind, entriesOf, kindOrder } = useSheetDays(cols, SUFFIX)

// ---------- rows: from the blocks + the ones added by hand (remembered per period) ----------
const added = storedRef<Record<string, SheetRow[]>>('qa.sheet.rows', readStored<Record<string, SheetRow[]>>('qa.sheet.rows', {}), true)
const rows = computed<SheetGridRow[]>(() => buildSheetRows(days.value, added.value[periodKey.value] ?? [], shownKind, kindOrder))
const dayTotal = (d: string) => unionMs(entriesOf(dayOf(d)))
/** Time per kind (tasks, meetings, calls…): per day and for the period — a kind's own overlaps counted once. */
const kindRows = computed(() => kindTotals(cols.value, (d) => entriesOf(dayOf(d)), kinds.value.map((k) => k.id)))
const grand = computed(() => cols.value.reduce((s, d) => s + dayTotal(d), 0))
const isOff = (d: string) => !props.settings.schedule.workDays.includes(new Date(`${d}T12:00:00`).getDay())

const { editing, draft, bad, cellId, startEdit, setHours, commit, onCellKey, vFocus } = useSheetHours({ settings: () => props.settings, rows, cols, dayOf, load, busy })

/** Rows not yet in the period (by key) join the hand-added ones. */
function addRows(list: SheetRow[]): void {
  const cur = added.value[periodKey.value] ?? []
  const fresh: SheetRow[] = []
  for (const r of list) if (![...cur, ...fresh].some((x) => x.key === r.key) && !rows.value.some((x) => x.key === r.key)) fresh.push(r)
  if (fresh.length) added.value = { ...added.value, [periodKey.value]: [...cur, ...fresh] }
}

// ---------- adding a row ----------
const adding = ref(false)
const newKind = ref('task')
const newTask = ref<TaskRef[]>([])
const newLabel = ref('')
/** The menus float over everything (Popover): the dashboard widget would clip them. */
const addEl = ref<HTMLElement>()
const pickable = computed(() => kinds.value.filter((k) => !k.hidden))
function addRow(): void {
  const t = newTask.value[0]
  const text = newLabel.value.trim() || (t ? `${t.key} ${t.summary}` : kindLabel(newKind.value))
  addRows([rowOf({ kind: newKind.value, label: text, task: t ? { key: t.key, summary: t.summary } : undefined })])
  adding.value = false
  newTask.value = []
  newLabel.value = ''
}
function removeRow(r: SheetGridRow): void {
  added.value = { ...added.value, [periodKey.value]: (added.value[periodKey.value] ?? []).filter((x) => x.key !== r.key) }
}

// ---------- copying the previous period ----------
const copyOpen = ref(false)
const copyEl = ref<HTMLElement>()
/** Rows of the previous period of the same length; `withHours` — their time too, into cells still empty. */
async function copyPrev(withHours: boolean): Promise<void> {
  copyOpen.value = false
  const span = cols.value.length
  const prevCols = cols.value.map((d) => shiftDay(d, -span))
  const prev = await window.qa.rangeDays(prevCols[0], prevCols[prevCols.length - 1])
  const copy = copyFromPrevious(prev, prevCols, cols.value, (key, d) => rows.value.find((r) => r.key === key)?.cells.get(d)?.ms ?? 0)
  if (!withHours) return addRows(copy.rows)
  if (!copy.fills.length) return
  const sum = copy.fills.reduce((s, p) => s + p.ms, 0)
  if (!confirm(`Добавить ${copy.fills.length} блоков (${formatDuration(sum)}) как на прошлой неделе?`)) return
  busy.value = true
  try {
    for (const p of copy.fills) {
      await setHours(p.row, p.day, p.ms)
      await load()
    }
  } finally {
    await load()
    busy.value = false
  }
}
</script>

<template>
  <div class="sh tw:group/sh tw:flex tw:flex-col tw:h-full tw:min-h-0" :class="{ widget }">
    <div v-if="!range" class="bar tw:flex-none tw:flex tw:flex-wrap tw:items-center tw:gap-y-6 tw:gap-x-10 tw:py-8 tw:px-12 tw:border-b tw:border-b-border tw:group-[.widget]/sh:gap-y-4 tw:group-[.widget]/sh:gap-x-6 tw:group-[.widget]/sh:flex-nowrap tw:group-[.widget]/sh:h-34 tw:group-[.widget]/sh:py-0 tw:group-[.widget]/sh:px-8 tw:group-[.widget]/sh:overflow-hidden">
      <div class="seg tw:inline-flex tw:p-2 tw:rounded-[4px] tw:bg-white/4 tw:border tw:border-border">
        <button class="tw:h-24 tw:py-0 tw:px-9 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-accent/25 tw:[&.on]:text-text-hi tw:group-[.widget]/sh:h-22 tw:group-[.widget]/sh:py-0 tw:group-[.widget]/sh:px-7 tw:group-[.widget]/sh:text-[11.5px]" :class="{ on: mode === 'week' }" @click="setMode('week')">Неделя</button>
        <button class="tw:h-24 tw:py-0 tw:px-9 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-accent/25 tw:[&.on]:text-text-hi tw:group-[.widget]/sh:h-22 tw:group-[.widget]/sh:py-0 tw:group-[.widget]/sh:px-7 tw:group-[.widget]/sh:text-[11.5px]" :class="{ on: mode === 'day' }" @click="setMode('day')">День</button>
      </div>
      <div class="nav tw:inline-flex tw:items-center tw:gap-4" title="Колесо мыши — день / неделя вперёд или назад" @wheel.prevent="onWheel">
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:group-[.widget]/sh:w-24 tw:group-[.widget]/sh:h-24 tw:hover:enabled:border-border-3" title="Назад" @click="shift(-1)"><Icon name="chevronLeft" :size="14" /></button>
        <button ref="plEl" class="pl tw:min-w-110 tw:text-center tw:text-[13px] tw:font-semibold tw:whitespace-nowrap tw:group-[.widget]/sh:min-w-80 tw:group-[.widget]/sh:text-[12px] tw:inline-flex tw:items-center tw:justify-center tw:gap-6 tw:h-26 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:hover:not-[&.on]:bg-white/7 tw:[&.on]:bg-white/7 tw:[&.now]:text-accent-fg tw:group-[.widget]/sh:h-24 tw:group-[.widget]/sh:whitespace-nowrap" :class="{ on: pickerOpen, now: isCurrent }" title="Выбрать период" @click="pickerOpen = !pickerOpen"><Icon name="calendar" :size="12" />{{ label }}</button>
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:group-[.widget]/sh:w-24 tw:group-[.widget]/sh:h-24 tw:hover:enabled:border-border-3" title="Вперёд" @click="shift(1)"><Icon name="chevronRight" :size="14" /></button>
        <button v-if="!isCurrent" class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:group-[.widget]/sh:w-24 tw:group-[.widget]/sh:h-24 tw:hover:enabled:border-border-3" title="Сейчас" @click="goToday"><Icon name="clock" :size="13" /></button>
      </div>
      <DateRangePicker v-if="pickerOpen" :from="cols[0]" :to="cols[cols.length - 1]" :anchor="plEl" :max="62" @apply="applyRange" @close="pickerOpen = false" />
      <span class="sp tw:flex-1"></span>
      <FilterMenu v-model="kindFilter" label="Вид" icon="tag" :options="kindOpts" />
      <span v-if="busy" class="busy tw:inline-flex tw:text-accent-fg tw:animate-[SheetView-spin_0.8s_linear_infinite]"><Icon name="refresh" :size="13" /></span>
      <div ref="addEl" class="pop tw:relative">
        <button class="btn tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border tw:rounded-[4px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:hover:not-[&.on]:bg-white/6 tw:[&.on]:bg-white/6 tw:group-[.widget]/sh:h-24 tw:group-[.widget]/sh:py-0 tw:group-[.widget]/sh:px-7 tw:hover:enabled:border-border-3" :class="{ on: adding }" title="Добавить строку" @click="adding = !adding"><Icon name="plus" :size="13" /><span class="bl">Строка</span></button>
        <Popover v-model:open="adding" :anchor="addEl" :width="320" :chrome="40" max-height="none" class="pd add tw:absolute tw:top-[calc(100%+4px)] tw:right-0 tw:z-40 tw:rounded-[4px] tw:border tw:border-white/10 tw:bg-panel-2 tw:[box-shadow:var(--shadow-menu)] tw:w-320 tw:flex tw:flex-col tw:gap-8 tw:p-10">
          <div class="kinds tw:flex tw:flex-wrap tw:gap-4">
            <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-32 tw:h-28 tw:p-0 tw:border tw:border-transparent tw:rounded-[4px] tw:bg-[color-mix(in_srgb,var(--c)_14%,transparent)] tw:text-(--c) tw:[&.on]:border-(--c) tw:[&.on]:bg-[color-mix(in_srgb,var(--c)_30%,transparent)] tw:[&.on]:text-text-hi" v-for="k in pickable" :key="k.id" :class="{ on: newKind === k.id }" :style="{ '--c': k.color }" :title="k.label" @click="newKind = k.id"><Icon :name="k.icon" :size="13" /></button>
          </div>
          <div class="arow tw:flex tw:gap-6 tw:items-center">
            <TaskPicker v-model="newTask" single compact />
            <input v-model="newLabel" class="ain tw:flex-1 tw:min-w-0 tw:h-30 tw:py-0 tw:px-8 tw:rounded-[4px] tw:border tw:border-border tw:bg-panel tw:text-text tw:text-[12.5px]" :placeholder="newTask[0] ? newTask[0].summary : kindLabel(newKind)" @keydown.enter="addRow" />
          </div>
          <button class="btn pri tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border tw:rounded-[4px] tw:text-[12px] tw:justify-center tw:[&&]:border-transparent tw:bg-accent tw:text-on-accent" @click="addRow"><Icon name="check" :size="13" />Добавить</button>
        </Popover>
      </div>
      <div ref="copyEl" class="pop tw:relative">
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:bg-white/7 tw:[&.on]:bg-white/7 tw:hover:not-[&.on]:text-text tw:[&.on]:text-text tw:group-[.widget]/sh:w-24 tw:group-[.widget]/sh:h-24 tw:hover:enabled:border-border-3" :class="{ on: copyOpen }" :title="cols.length === 1 ? 'Как вчера' : 'Как в прошлый период'" @click="copyOpen = !copyOpen"><Icon name="copy" :size="14" /></button>
        <Popover v-model:open="copyOpen" :anchor="copyEl" :width="200" :chrome="40" max-height="none" class="pd menu tw:absolute tw:top-[calc(100%+4px)] tw:right-0 tw:z-40 tw:p-6 tw:rounded-[4px] tw:border tw:border-white/10 tw:bg-panel-2 tw:[box-shadow:var(--shadow-menu)] tw:min-w-190 tw:flex tw:flex-col">
          <button class="tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-9 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/16" @click="copyPrev(false)"><Icon name="list" :size="13" />Только строки</button>
          <button class="tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-9 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/16" @click="copyPrev(true)"><Icon name="clock" :size="13" />Строки и часы</button>
        </Popover>
      </div>
      <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:group-[.widget]/sh:w-24 tw:group-[.widget]/sh:h-24 tw:hover:enabled:border-border-3" title="Обновить" @click="load"><Icon name="refresh" :size="14" /></button>
    </div>

    <div class="wrap tw:flex-1 tw:min-h-0 tw:overflow-auto tw:pt-0 tw:pr-12 tw:pb-16 tw:pl-12 tw:group-[.widget]/sh:pt-0 tw:group-[.widget]/sh:pr-8 tw:group-[.widget]/sh:pb-8 tw:group-[.widget]/sh:pl-8">
      <table class="sheet tw:w-full tw:border-separate tw:[border-spacing:0] tw:text-[12.5px] tw:table-fixed tw:min-w-0! tw:max-w-none!" :style="{ width: `${tableW}px` }">
        <colgroup>
          <col :style="{ width: `${colW.rl}px` }" />
          <col v-for="d in cols" :key="d" :style="{ width: `${colW.dc}px` }" />
          <col v-if="cols.length > 1" :style="{ width: `${colW.tc}px` }" />
        </colgroup>
        <thead>
          <tr>
            <th class="rl tw:border-b tw:border-b-border tw:top-0 tw:whitespace-nowrap tw:text-muted tw:font-medium tw:text-[11.5px] tw:sticky tw:left-0 tw:[background:var(--bg,var(--bg))] tw:w-[34%] tw:min-w-220 tw:max-w-380 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-2 tw:text-left tw:z-4 tw:group-[.widget]/sh:min-w-140">Задача<span class="crz tw:absolute tw:top-4 tw:bottom-4 tw:-right-3 tw:z-5 tw:w-6 tw:cursor-col-resize tw:rounded-r2 tw:hover:bg-accent/55" title="Ширина" @pointerdown.prevent="startColResize($event, 'rl')"></span></th>
            <th v-for="d in cols" :key="d" class="dc tw:group/dc tw:border-b tw:border-b-border tw:sticky tw:top-0 tw:z-3 tw:[background:var(--bg,var(--bg))] tw:py-5 tw:px-0 tw:whitespace-nowrap tw:text-muted tw:font-medium tw:text-[11.5px] tw:w-76 tw:text-right" :class="{ off: isOff(d), today: d === today() }">
              <button class="dh tw:@container tw:flex tw:justify-end tw:items-baseline tw:gap-4 tw:w-full tw:box-border tw:whitespace-nowrap tw:overflow-hidden tw:py-2 tw:px-10 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-inherit tw:leading-[1.15] tw:hover:bg-white/5 tw:hover:not-group-[.today]/dc:text-text tw:group-[.today]/dc:text-accent-fg tw:hover:enabled:border-border-3" title="Открыть день" @click="emit('go', 'day', d)">
                <span class="dw tw:@max-[52px]:hidden">{{ fmt(d, { weekday: 'short' }) }}</span><b class="tw:text-[13px] tw:text-text-2 tw:group-[.today]/dc:text-accent-fg">{{ fmt(d, { day: 'numeric' }) }}</b>
              </button>
              <span class="crz tw:absolute tw:top-4 tw:bottom-4 tw:-right-3 tw:z-5 tw:w-6 tw:cursor-col-resize tw:rounded-r2 tw:hover:bg-accent/55" title="Ширина" @pointerdown.prevent="startColResize($event, 'dc')"></span>
            </th>
            <th v-if="cols.length > 1" class="tc tw:border-b tw:border-b-border tw:sticky tw:top-0 tw:z-3 tw:[background:var(--bg,var(--bg))] tw:py-5 tw:px-0 tw:whitespace-nowrap tw:text-muted tw:text-[11.5px] tw:w-76 tw:text-right tw:[&&]:pr-10 tw:tabular-nums tw:font-data tw:font-semibold">Итого<span class="crz tw:absolute tw:top-4 tw:bottom-4 tw:-right-3 tw:z-5 tw:w-6 tw:cursor-col-resize tw:rounded-r2 tw:hover:bg-accent/55" title="Ширина" @pointerdown.prevent="startColResize($event, 'tc')"></span></th>
          </tr>
        </thead>
        <tbody>
          <tr class="tw:group/g23" v-for="r in rows" :key="r.key" :class="{ locked: r.locked }">
            <td class="rl tw:border-b tw:border-b-border tw:sticky tw:left-0 tw:z-2 tw:[background:var(--bg,var(--bg))] tw:w-[34%] tw:min-w-220 tw:max-w-380 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-2 tw:text-left tw:[.qa_&]:text-muted tw:[.qa_&]:text-[11.5px] tw:group-[.widget]/sh:min-w-140">
              <span class="rlab tw:flex tw:items-center tw:gap-7 tw:h-34 tw:min-w-0 tw:group-[.widget]/sh:h-30">
                <span class="eic tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:rounded-r2 tw:text-text-hi" :style="{ background: kindColor(r.kind) }" :title="kindLabel(r.kind)"><Icon :name="entryIcon(r)" :size="11" :stroke="2.4" /></span>
                <b v-if="r.task" class="key tw:flex-none tw:text-info-fg tw:text-[12px]">{{ r.task.key }}</b>
                <span class="rt tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:min-w-0" :title="r.task ? r.task.summary : r.label">{{ r.task ? r.task.summary : r.label }}</span>
                <Icon v-if="r.locked" name="outlook" :size="12" class="lk tw:[&&]:flex-none tw:text-info" />
                <button v-if="r.manual && !r.total" class="rx tw:flex-none tw:inline-flex tw:ml-auto tw:p-3 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:text-down-fg tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Убрать строку" @click="removeRow(r)"><Icon name="x" :size="11" /></button>
              </span>
            </td>
            <td v-for="d in cols" :key="d" class="cell tw:group/cell tw:border-b tw:border-b-border tw:h-34 tw:p-0 tw:text-right tw:tabular-nums tw:font-data tw:cursor-text tw:[&.off]:not-[&.today]:not-hover:bg-white/1.5 tw:[&.today]:not-hover:bg-accent/6 tw:hover:bg-white/5 tw:hover:[box-shadow:inset_0_0_0_1px_rgb(var(--accent-rgb)/0.35)] tw:group-[.locked]/g23:cursor-default tw:group-[.locked]/g23:hover:shadow-none tw:[.qa_&]:text-muted tw:[.qa_&]:text-[11.5px] tw:group-[.widget]/sh:h-30" :class="{ off: isOff(d), today: d === today(), bad: bad === cellId(r, d) }" @click="editing !== cellId(r, d) && startEdit(r, d)">
              <input
                v-if="editing === cellId(r, d)"
                v-model="draft"
                v-focus
                class="cin tw:w-full tw:h-32 tw:box-border tw:py-0 tw:px-9 tw:border tw:border-accent tw:rounded-r2 tw:outline-none tw:bg-panel tw:text-text-hi tw:[font:inherit] tw:text-right tw:group-[.bad]/cell:border-down tw:group-[.bad]/cell:animate-[SheetView-shake_0.3s]"
                @keydown="onCellKey($event, r, d)"
                @blur="commit(r, d)"
              />
              <span v-else class="cv tw:block tw:py-0 tw:px-10 tw:[&.zero]:before:content-['·'] tw:[&.zero]:before:text-border-3" :class="{ zero: !r.cells.get(d)?.ms }">{{ formatHours(r.cells.get(d)?.ms ?? 0) }}</span>
            </td>
            <td v-if="cols.length > 1" class="tc tw:border-b tw:border-b-border tw:w-76 tw:text-right tw:pr-10 tw:tabular-nums tw:font-data tw:font-semibold tw:[.qa_&]:text-muted tw:[.qa_&]:text-[11.5px]">{{ formatHours(r.total) }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="cols.length + 2" class="empty tw:border-b tw:border-b-border tw:[.qa_&]:text-muted tw:[.qa_&]:text-[11.5px] tw:py-18 tw:px-4 tw:text-muted">Пусто — добавьте строку</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="sum">
            <td class="rl tw:border-b tw:border-b-border tw:sticky tw:left-0 tw:z-2 tw:[background:var(--bg,var(--bg))] tw:w-[34%] tw:min-w-220 tw:max-w-380 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-2 tw:text-left tw:h-30 tw:tabular-nums tw:font-data tw:font-semibold tw:border-t tw:border-t-white/12 tw:[.qa_&]:text-muted tw:[.qa_&]:text-[11.5px] tw:group-[.widget]/sh:min-w-140">Итого</td>
            <td v-for="d in cols" :key="d" class="cell tw:border-b tw:border-b-border tw:h-34 tw:p-0 tw:text-right tw:tabular-nums tw:font-data tw:[&.off]:not-[&.today]:bg-white/1.5 tw:[&.today]:bg-accent/6 tw:[&&]:pr-10 tw:cursor-default tw:font-semibold tw:border-t tw:border-t-white/12 tw:[.qa_&]:text-muted tw:[.qa_&]:text-[11.5px] tw:group-[.widget]/sh:h-30" :class="{ off: isOff(d), today: d === today() }">{{ formatHours(dayTotal(d)) }}</td>
            <td v-if="cols.length > 1" class="tc tw:border-b tw:border-b-border tw:w-76 tw:text-right tw:pr-10 tw:tabular-nums tw:font-data tw:h-30 tw:font-semibold tw:border-t tw:border-t-white/12 tw:[.qa_&]:text-muted tw:[.qa_&]:text-[11.5px]">{{ formatHours(grand) }}</td>
          </tr>
          <tr v-for="(k, ki) in kindRows" :key="k.kind" class="kt tw:group/kt" :class="{ first: ki === 0 }">
            <td class="rl tw:border-b tw:border-b-border tw:sticky tw:left-0 tw:z-2 tw:[background:var(--bg,var(--bg))] tw:w-[34%] tw:min-w-220 tw:max-w-380 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-2 tw:text-left tw:group-[.widget]/sh:min-w-140 tw:h-26 tw:text-text-2 tw:text-[12px] tw:tabular-nums tw:font-data tw:group-[.first]/kt:border-t tw:group-[.first]/kt:[border-top-style:dashed] tw:group-[.first]/kt:border-t-border"><span class="kname tw:inline-flex tw:items-center tw:gap-7 tw:whitespace-nowrap"><i class="tw:w-9 tw:h-9 tw:rounded-r2" :style="{ background: kindColor(k.kind) }"></i>{{ kindLabel(k.kind) }}</span></td>
            <td v-for="d in cols" :key="d" class="cell tw:border-b tw:border-b-border tw:p-0 tw:text-right tw:[&.off]:not-[&.today]:bg-white/1.5 tw:[&.today]:bg-accent/6 tw:[&&]:pr-10 tw:cursor-default tw:group-[.widget]/sh:h-30 tw:h-26 tw:text-text-2 tw:text-[12px] tw:tabular-nums tw:font-data tw:group-[.first]/kt:border-t tw:group-[.first]/kt:[border-top-style:dashed] tw:group-[.first]/kt:border-t-border" :class="{ off: isOff(d), today: d === today() }">{{ formatHours(k.per.get(d) ?? 0) }}</td>
            <td v-if="cols.length > 1" class="tc tw:border-b tw:border-b-border tw:w-76 tw:text-right tw:pr-10 tw:font-semibold tw:h-26 tw:text-text-2 tw:text-[12px] tw:tabular-nums tw:font-data tw:group-[.first]/kt:border-t tw:group-[.first]/kt:[border-top-style:dashed] tw:group-[.first]/kt:border-t-border">{{ formatHours(k.total) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped src="./SheetView.css"></style>
