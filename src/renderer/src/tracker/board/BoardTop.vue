<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { dayEnd, dayStart, formatDuration, formatHM, scheduleRanges } from '@shared/timeline'
import type { Entry, Ms, Selection } from '@shared/types'
import Icon from '../../components/Icon.vue'
import Timeline from '../../components/Timeline.vue'
import DayStrip from '../../components/DayStrip.vue'
import { kindColor, kindLabel } from '../../lib/palette'
import { todayKey } from '../../lib/today'
import { useDay } from '../../lib/useDay'
import { dayCell, timelineWindow } from '@shared/tracker/boardTime'
import { useWorkBoard, type TimelineInstance } from './useWorkBoard'
import { saveCopy } from '../entry/copyEntry'

/** The board's top: the chosen day's timeline (with its chain of events) or the period's day cells. */
const { settings, day, days, reload, now, isToday, top, openId, quick, fail, tlRef } = useWorkBoard()

// ---------- the period's day cells ----------
const week = computed(() => days.value.map((d) => dayCell(d, now.value, settings.value.schedule.workDays)))
const maxDay = computed(() => Math.max(8 * 3_600_000, ...week.value.map((w) => w.done + w.plan)))

// ---------- the chosen day's timeline ----------
const setFollow = (on: boolean) => void window.qa.updateSettings({ ui: { timeline: { follow: on } } })
const { data: dayData, reload: reloadDay } = useDay(day)
const sched = computed(() => scheduleRanges(day.value, settings.value.schedule))
const tlBounds = computed<[Ms, Ms]>(() => [dayStart(day.value), dayEnd(day.value)])
const tlInitial = computed<[Ms, Ms]>(() => timelineWindow(day.value, dayData.value.entries, sched.value.work, isToday.value ? now.value : undefined))
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
/** A copy of a block put where it was dragged with Ctrl / right after it; the copy opened. */
async function tlCopy(c: { id: string; start: Ms; end: Ms; lane?: number }): Promise<void> {
  const e = dayData.value.entries.find((x) => x.id === c.id)
  if (!e) return
  try {
    onCopied(await saveCopy(day.value, e, c), day.value)
  } catch (x) {
    fail(x)
  }
}
/** A block's recording started / stopped from its menu. */
async function tlRecord(c: { id: string; on: boolean }): Promise<void> {
  try {
    await window.qa.recordSet(day.value, c.id, c.on)
  } catch (x) {
    fail(x)
  }
  await reloadAll()
}
/** A copy made: its day shown, the copy opened. */
async function onCopied(c: Entry, d: string): Promise<void> {
  day.value = d
  await reloadAll()
  openId.value = c.id
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
</script>

<template>
  <div class="toprow tw:flex tw:flex-none tw:gap-6 tw:min-w-0">
  <div class="topsw tw:flex tw:flex-none tw:flex-col tw:gap-4">
    <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-30 tw:h-40 tw:p-0 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:text-text tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-accent-fg tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:not-[&.on]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:not-[&.on]:bg-transparent tw:[.seg_&]:not-hover:not-[&.on]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.seg_&]:[&.on]:bg-accent-soft tw:[.seg_&]:[&.on]:text-accent-fg tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-hover:not-[&.on]:text-text-2 tw:[&&]:[.quick_&]:hover:border-accent tw:[&&]:[.quick_&]:hover:text-accent-fg" :class="{ on: top === 'timeline' }" title="Таймлайн выбранного дня" @click="top = 'timeline'"><Icon name="timeline" :size="14" /></button>
    <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-30 tw:h-40 tw:p-0 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:text-text tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-accent-fg tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:not-[&.on]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:not-[&.on]:bg-transparent tw:[.seg_&]:not-hover:not-[&.on]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.seg_&]:[&.on]:bg-accent-soft tw:[.seg_&]:[&.on]:text-accent-fg tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-hover:not-[&.on]:text-text-2 tw:[&&]:[.quick_&]:hover:border-accent tw:[&&]:[.quick_&]:hover:text-accent-fg" :class="{ on: top === 'week' }" title="Неделя: время по дням" @click="top = 'week'"><Icon name="calendar" :size="14" /></button>
  </div>
  <div v-if="top === 'timeline'" class="tlwrap tw:flex-1 tw:min-w-0 tw:min-h-0 tw:border tw:border-border tw:rounded-r2 tw:overflow-hidden">
    <Timeline
      :ref="(c) => (tlRef = (c ?? undefined) as TimelineInstance | undefined)"
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
      @copy="tlCopy"
      @record="tlRecord"
      @attrs="(c) => tlSave(c.id, { attrs: Object.keys(c.attrs).length ? c.attrs : undefined })"
      @copied="(c, d) => onCopied(c, d)"
      @change-kind="(c) => tlSave(c.id, { kind: c.kind })"
      @cut-as="tlCut"
      @delete-entry="tlDelete"
      @merge="tlMerge"
      @plan-changed="reloadAll"
    />
    <!-- the day as a chain of events -->
    <DayStrip class="wchain tw:[&&]:border-t tw:[&&]:border-t-border" :entries="dayData.entries" :now="now" :countdown="settings.ui.timeline.countdown" />
  </div>
  <div v-else class="strip tw:group/strip tw:flex-1 tw:min-w-0 tw:grid tw:gap-6 tw:overflow-x-auto tw:pb-2" :class="{ many: days.length > 10 }" :style="{ gridTemplateColumns: `repeat(${days.length || 7}, minmax(${days.length > 10 ? 76 : 0}px, 1fr))` }">
    <button v-for="w in week" :key="w.day" class="dcell tw:group/dcell tw:group-[.many]/strip:py-6 tw:group-[.many]/strip:px-7 tw:flex tw:flex-col tw:items-stretch tw:gap-5 tw:min-w-0 tw:py-8 tw:px-10 tw:border tw:border-border tw:rounded-r3 tw:bg-panel tw:text-left tw:cursor-default tw:hover:not-[&.sel]:border-border-3 tw:[&.sel]:border-accent tw:[&.sel]:bg-panel-2 tw:[&.sel]:[box-shadow:inset_0_2px_0_var(--accent)] tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-group-[.many]/strip:not-[.quick_&]:py-0 tw:[.seg_&]:not-group-[.many]/strip:not-[.quick_&]:px-10 tw:[.seg_&]:not-hover:not-[&.sel]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:not-[&.sel]:bg-transparent tw:[.seg_&]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:not-group-[.many]/strip:py-0 tw:[.quick_&]:not-group-[.many]/strip:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:text-text-2 tw:[&&]:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg tw:hover:enabled:not-[&.sel]:not-[.seg_&]:bg-hover" :class="{ sel: w.day === day, today: w.day === todayKey, off: w.off }" @click="day = w.day">
      <span class="dtop tw:flex tw:items-baseline tw:justify-between"><span class="dwd tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase tw:group-[.off]/dcell:text-down-fg">{{ w.wd }}</span><span class="dn num tw:font-data tw:tabular-nums tw:group-[.off]/dcell:not-group-[.today]/dcell:text-down-fg tw:text-[13px] tw:text-text-2 tw:group-[.today]/dcell:py-0 tw:group-[.today]/dcell:px-5 tw:group-[.today]/dcell:rounded-r2 tw:group-[.today]/dcell:bg-accent tw:group-[.today]/dcell:text-on-accent tw:group-[.today]/dcell:font-bold">{{ w.n }}</span></span>
      <span class="dsum num tw:font-data tw:tabular-nums tw:group-[.many]/strip:text-[13px] tw:text-[15px] tw:font-semibold tw:text-text-hi tw:whitespace-nowrap tw:overflow-hidden">{{ w.done ? formatDuration(w.done) : '—' }}<small class="tw:group-[.many]/strip:hidden tw:ml-5 tw:text-accent-fg tw:text-[11px] tw:font-medium" v-if="w.plan">+{{ formatDuration(w.plan) }}</small></span>
      <span class="dbar tw:relative tw:flex tw:h-4 tw:rounded-[2px] tw:bg-panel-3 tw:overflow-hidden">
        <i class="dfill tw:flex tw:h-full tw:[.cells_&]:w-14 tw:[.cells_&]:h-14 tw:[.cells_&]:rounded-[2px] tw:[.cells_&]:bg-[color:rgb(var(--accent-rgb)_/_var(--a))] tw:[.cells_&]:[outline:1px_solid_var(--border)]" :style="{ width: `${Math.min(100, (w.done / maxDay) * 100)}%` }">
          <i class="tw:h-full tw:[.cells_&]:w-14 tw:[.cells_&]:h-14 tw:[.cells_&]:rounded-[2px] tw:[.cells_&]:bg-[color:rgb(var(--accent-rgb)_/_var(--a))] tw:[.cells_&]:[outline:1px_solid_var(--border)]" v-for="k in w.kinds" :key="k.kind" :style="{ width: `${k.pct}%`, background: kindColor(k.kind) }"></i>
        </i>
        <i v-if="w.plan" class="dplan tw:h-full tw:[background:repeating-linear-gradient(90deg,var(--accent)_0_3px,transparent_3px_5px)] tw:opacity-80 tw:[.cells_&]:w-14 tw:[.cells_&]:h-14 tw:[.cells_&]:rounded-[2px] tw:[.cells_&]:bg-[color:rgb(var(--accent-rgb)_/_var(--a))] tw:[.cells_&]:[outline:1px_solid_var(--border)]" :style="{ width: `${Math.min(100, (w.plan / maxDay) * 100)}%` }"></i>
      </span>
      <span class="dcnt tw:group-[.many]/strip:hidden tw:min-h-14 tw:text-dim tw:text-[10.5px] tw:whitespace-nowrap tw:overflow-hidden">{{ w.count ? `${w.count} зап.` : '' }}<template v-if="w.notes"> · {{ w.notes }} зам.</template></span>
    </button>
  </div>
  </div>
</template>
