<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDuration, formatHM, overlapPairs, scheduleRanges } from '@shared/timeline'
import type { JiraIssue, TaskRef } from '@shared/jira'
import type { Entry, Ms, PlanBlock } from '@shared/types'
import Icon from '../../components/Icon.vue'
import TaskSearch from '../../components/TaskSearch.vue'
import NoteLinks from '../../components/NoteLinks.vue'
import JiraDetails from '../../components/JiraDetails.vue'
import SheetView from '../../app/SheetView.vue'
import { entryIcon, kindColor, kindLabel } from '../../lib/palette'
import { todayKey } from '../../lib/today'
import { dayFeed, plural } from '@shared/tracker/boardTime'
import { useWorkBoard } from './useWorkBoard'
import EntryCopyMenu from '../entry/EntryCopyMenu.vue'
import { useRecording } from '../entry/useRecording'
import RecDot from '../../components/RecDot.vue'
import AttrChips from '../../components/AttrChips.vue'

/** The chosen day as a feed (done → now → plan, free gaps in between) — or the period's sheet. */
const emit = defineEmits<{ openDay: [day: string] }>()
const { settings, day, weekStart, weekEnd, weekTitle, reload, now, isToday, cur, fail, flash, flashFor, top, feedTab, feedOrder, openId, hoverId, addTaskToDay, quick } = useWorkBoard()

/** «Запись» on an event: started / stopped from its row too. */
const rec = useRecording()
/** Going on now: started, and its end is now or ahead (a detected call / a recording is extended every few seconds). */
const isLive = (e: Entry) => e.start <= now.value && e.end >= now.value - 90_000 && (e.source === 'detected' || !!e.recording || e.end > now.value)
const feed = computed(() => dayFeed(cur.value, { now: now.value, today: todayKey.value, work: scheduleRanges(cur.value.day, settings.value.schedule).work, order: feedOrder.value }))
/** Blocks of the day at the same time: under the later one — with which, when, how long. */
const overlaps = computed(() => overlapPairs(cur.value.entries))
const overlapsOf = (id: string) => overlaps.value.filter((o) => o.b.id === id)
/** A free gap → the quick line gets its time. */
const fillGap = (r: { start: Ms; end: Ms }) => quick.value?.focus(`${formatHM(r.start)}-${formatHM(r.end)} `)

// ---------- a block: give a task, delete; a plan: done, dropped ----------
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
/** The row's record button: the recording stopped / started (an event going on or ahead). */
async function toggleRecording(e: Entry): Promise<void> {
  try {
    await rec.set(day.value, e.id, !e.recording)
    await reload()
  } catch (x) {
    fail(x)
  }
}
/** A copy made from a row: on this day — lit in the list; on another — that day opened. */
async function onCopied(c: Entry, d: string): Promise<void> {
  if (d !== day.value) day.value = d
  await reload()
  flashFor(c.id, 2500)
}
async function planDone(p: PlanBlock): Promise<void> {
  await window.qa.planDone(day.value, p.id)
  await reload()
}
async function planDrop(p: PlanBlock): Promise<void> {
  await window.qa.deletePlan(day.value, p.id)
  await reload()
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
</script>

<template>
  <section class="feed tw:overflow-y-auto tw:min-w-0 tw:border tw:border-border tw:rounded-r3 tw:bg-panel tw:pb-6">
    <div class="cap fh tw:flex tw:items-center tw:justify-between tw:gap-8 tw:h-34 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-12 tw:border-b tw:border-b-border tw:whitespace-nowrap">
      <span v-if="feedTab === 'list'">{{ isToday ? 'Сегодня' : 'День' }} · {{ cur.entries.length }} {{ plural(cur.entries.length, 'запись', 'записи', 'записей') }}<template v-if="overlaps.length"> · <em class="ovc tw:text-warn-fg tw:not-italic">{{ overlaps.length }} {{ plural(overlaps.length, 'пересечение', 'пересечения', 'пересечений') }}</em></template></span>
      <span v-else>Заполнение · {{ weekTitle }}</span>
      <span class="ftabs tw:inline-flex tw:gap-2 tw:ml-auto">
        <button v-if="feedTab === 'list'" class="fsort tw:h-24 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:inline-flex tw:items-center tw:py-0 tw:px-6 tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:text-text-2 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg" :title="feedOrder === 'desc' ? 'Сначала новые · нажмите — сначала старые' : 'Сначала старые · нажмите — сначала новые'" @click="feedOrder = feedOrder === 'desc' ? 'asc' : 'desc'"><Icon :name="feedOrder === 'desc' ? 'sortDesc' : 'sortAsc'" :size="13" /></button>
        <button class="tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-accent-fg tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:not-[&.on]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:not-[&.on]:bg-transparent tw:[.seg_&]:not-[&.on]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.seg_&]:[&.on]:bg-accent-soft tw:[.seg_&]:[&.on]:text-accent-fg tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-[&.on]:text-text-2 tw:[&&]:[.quick_&]:hover:border-accent tw:[&&]:[.quick_&]:hover:text-accent-fg" :class="{ on: feedTab === 'list' }" title="Записи выбранного дня" @click="feedTab = 'list'">Записи</button>
        <button class="tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-accent-fg tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:not-[&.on]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:not-[&.on]:bg-transparent tw:[.seg_&]:not-[&.on]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.seg_&]:[&.on]:bg-accent-soft tw:[.seg_&]:[&.on]:text-accent-fg tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-[&.on]:text-text-2 tw:[&&]:[.quick_&]:hover:border-accent tw:[&&]:[.quick_&]:hover:text-accent-fg" :class="{ on: feedTab === 'sheet' }" title="Табель периода: часы по задачам и дням" @click="feedTab = 'sheet'">Заполнение</button>
      </span>
    </div>
    <SheetView v-if="feedTab === 'sheet'" class="wsheet tw:flex-1 tw:[&&]:min-h-0" :settings="settings" widget store="work" :range="{ from: weekStart, to: weekEnd }" @go="(_v, d, id) => d && ((day = d), (feedTab = 'list'), id && (openId = id))" />
    <template v-else>
    <template v-for="r in feed" :key="r.key">
      <div v-if="r.t === 'now'" class="nowline tw:relative tw:h-0 tw:m-6 tw:border-t tw:border-t-down"><span class="num tw:font-data tw:tabular-nums tw:absolute tw:left-0 tw:-top-9 tw:py-1 tw:px-6 tw:rounded-r2 tw:bg-down tw:text-white tw:text-[10.5px] tw:font-bold">{{ formatHM(r.at) }}</span></div>
      <button v-else-if="r.t === 'gap'" class="gap tw:group/gap tw:flex tw:items-center tw:gap-10 tw:w-[calc(100%-12px)] tw:h-26 tw:my-0 tw:mx-6 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-9 tw:border-0 tw:[&&]:border-b tw:[&&]:border-b-border tw:rounded-none tw:bg-transparent tw:text-dim tw:text-[11.5px] tw:text-left tw:hover:bg-hover tw:hover:not-[&.plan]:text-accent-fg tw:[&.plan]:text-muted tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[&&]:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:not-hover:bg-transparent tw:[.seg_&]:not-hover:not-[&.plan]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-hover:not-[&.plan]:text-text-2 tw:[&&]:[.quick_&]:hover:border-accent tw:[&&]:[.quick_&]:hover:text-accent-fg tw:hover:enabled:not-[.seg_&]:not-[.quick_&]:border-border-3" :class="{ plan: r.plan }" title="Заполнить это время" @click="fillGap(r)">
        <span class="num tw:font-data tw:tabular-nums tw:w-92">{{ formatHM(r.start) }}–{{ formatHM(r.end) }}</span>
        <span>свободно {{ formatDuration(r.end - r.start) }}</span>
        <Icon class="tw:ml-auto tw:opacity-0 tw:group-hover/gap:opacity-100" name="plus" :size="12" />
      </button>
      <div v-else-if="r.t === 'n'" class="row note tw:flex tw:items-center tw:gap-10 tw:my-0 tw:mx-6 tw:pt-4 tw:pr-8 tw:pb-4 tw:pl-6 tw:border-l-3 tw:border-l-(--c,var(--border-3)) tw:border-b tw:border-b-border tw:whitespace-nowrap tw:cursor-default tw:hover:bg-hover tw:[--c:var(--warn)] tw:min-h-32" @click="emit('openDay', day)">
        <span class="tm num tw:font-data tw:tabular-nums tw:flex-none tw:text-text-2 tw:text-[12px] tw:w-92">{{ formatHM(r.n.at) }}</span>
        <span class="kic tw:inline-flex tw:flex-none tw:text-(--c)"><Icon name="note" :size="13" /></span>
        <span class="tt tw:flex-1 tw:min-w-0 tw:flex tw:flex-col"><span class="ttl tw:overflow-hidden tw:text-ellipsis tw:text-text tw:text-[13px]">{{ r.n.text.split('\n')[0] || 'Заметка' }}</span></span>
      </div>
      <div v-else-if="r.t === 'p'" class="row plan pblock tw:group/row tw:flex tw:items-center tw:gap-10 tw:min-h-40 tw:my-0 tw:mx-6 tw:pt-4 tw:pr-8 tw:pb-4 tw:pl-6 tw:border-l-3 tw:border-l-(--c,var(--border-3)) tw:border-b tw:border-b-border tw:whitespace-nowrap tw:cursor-default tw:hover:bg-hover tw:[&&]:[border-left-style:dashed]" :style="{ '--c': kindColor(r.p.kind) }">
        <span class="tm num tw:font-data tw:tabular-nums tw:flex-none tw:w-92 tw:text-text-2 tw:text-[12px]">{{ formatHM(r.p.start) }}–{{ formatHM(r.p.end) }}</span>
        <span class="kic tw:inline-flex tw:flex-none tw:text-(--c)"><Icon :name="entryIcon(r.p)" :size="13" /></span>
        <span class="tt tw:flex-1 tw:min-w-0 tw:flex tw:flex-col"><span class="ttl tw:text-text-2 tw:overflow-hidden tw:text-ellipsis tw:text-[13px]">{{ r.p.label || kindLabel(r.p.kind) }}</span><span class="sub tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-[11.5px]">план дня</span></span>
        <span class="du num tw:font-data tw:tabular-nums tw:flex-none tw:min-w-52 tw:text-right tw:text-text-2 tw:text-[12px]">{{ formatDuration(r.p.end - r.p.start) }}</span>
        <span class="acts tw:inline-flex tw:flex-none tw:gap-2 tw:opacity-0 tw:group-hover/row:opacity-100">
          <button class="tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-hover:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-hover:text-text-2 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg" title="Сделано по плану" @click.stop="planDone(r.p)"><Icon name="check" :size="13" /></button>
          <button class="tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-hover:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-hover:text-text-2 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg" title="Убрать из плана" @click.stop="planDrop(r.p)"><Icon name="x" :size="13" /></button>
        </span>
      </div>
      <div v-else class="row tw:group/row tw:flex tw:items-center tw:gap-10 tw:min-h-40 tw:my-0 tw:mx-6 tw:pt-4 tw:pr-8 tw:pb-4 tw:pl-6 tw:border-l-3 tw:border-l-(--c,var(--border-3)) tw:border-b tw:border-b-border tw:whitespace-nowrap tw:cursor-default tw:hover:not-[&.on]:not-[&.live]:bg-hover tw:[&.on]:not-[&.live]:bg-accent-soft tw:[&.flash]:animate-[WorkBoard-flash_1.6s_ease-out] tw:[&.plan]:[border-left-style:dashed] tw:[&.live]:relative tw:[&.live]:overflow-hidden tw:[&.live]:[background:linear-gradient(90deg,color-mix(in_srgb,var(--c)_16%,transparent),transparent_70%)] tw:[&.live]:after:content-[''] tw:[&.live]:after:absolute tw:[&.live]:after:top-0 tw:[&.live]:after:bottom-0 tw:[&.live]:after:left-0 tw:[&.live]:after:w-[35%] tw:[&.live]:after:[background:linear-gradient(90deg,transparent,color-mix(in_srgb,var(--c)_22%,transparent),transparent)] tw:[&.live]:after:animate-[WorkBoard-live-sweep_2.6s_linear_infinite] tw:[&.live]:after:pointer-events-none" :class="{ plan: r.plan && !isLive(r.e), on: openId === r.e.id, flash: flash === r.e.id, live: isLive(r.e) }" :style="{ '--c': kindColor(r.e.kind) }" @mouseenter="hoverId = r.e.id" @click="openId = openId === r.e.id ? undefined : r.e.id">
        <span class="tm num tw:font-data tw:tabular-nums tw:flex-none tw:w-92 tw:text-text-2 tw:text-[12px]">{{ formatHM(r.e.start) }}–{{ formatHM(r.e.end) }}</span>
        <span class="kic tw:inline-flex tw:flex-none tw:text-(--c) tw:group-[.live]/row:animate-[WorkBoard-live-pulse_1.4s_ease-in-out_infinite]" :title="kindLabel(r.e.kind)"><Icon :name="entryIcon(r.e)" :size="13" /></span>
        <RecDot v-if="r.e.recording" />
        <AttrChips :attrs="r.e.attrs" />
        <span class="tt tw:flex-1 tw:min-w-0 tw:flex tw:flex-col">
          <span class="ttl tw:group-[.plan]/row:text-text-2 tw:overflow-hidden tw:text-ellipsis tw:text-text tw:text-[13px]">{{ r.e.label || kindLabel(r.e.kind) }}</span>
          <span v-if="r.e.description" class="sub tw:overflow-hidden tw:text-ellipsis tw:text-muted tw:text-[11.5px]">{{ r.e.description.split('\n')[0] }}</span>
        </span>
        <span v-if="isLive(r.e)" class="lv tw:inline-flex tw:items-center tw:gap-5 tw:flex-none tw:py-0 tw:px-7 tw:rounded-r2 tw:bg-[color-mix(in_srgb,var(--c)_20%,transparent)] tw:text-text-hi tw:font-data tw:text-[10.5px] tw:tracking-[0.04em] tw:uppercase"><i class="tw:[.cells_&]:[outline:1px_solid_var(--border)] tw:w-6 tw:h-6 tw:rounded-[50%] tw:[background:var(--c)] tw:[box-shadow:0_0_6px_var(--c)] tw:animate-[WorkBoard-live-blink_1s_steps(2)_infinite]"></i>идёт</span>
        <span v-if="r.e.outlook" class="badge tw:flex-none tw:py-0 tw:px-6 tw:rounded-r2 tw:bg-info/16 tw:text-info-fg tw:text-[10.5px]">Outlook</span>
        <span v-if="r.plan && !isLive(r.e)" class="badge pl tw:flex-none tw:py-0 tw:px-6 tw:rounded-r2 tw:text-[10.5px] tw:bg-accent-soft tw:text-accent-fg">план</span>
        <span v-if="r.e.task" class="tchip tw:[&.open]:border-accent/60 tw:inline-flex tw:items-center tw:gap-3 tw:flex-none tw:h-20 tw:pt-0 tw:pr-2 tw:pb-0 tw:pl-7 tw:rounded-r2 tw:bg-info/16 tw:text-info-fg tw:font-data tw:text-[11px]" :class="{ open: jiraOpen.has(r.e.id) }" :title="r.e.task.summary" @click.stop>
          <button class="jx tw:inline-flex tw:items-center tw:gap-2 tw:w-auto tw:py-0 tw:px-2 tw:text-inherit tw:[font:inherit] tw:border-0 tw:bg-transparent tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg" :title="jiraOpen.has(r.e.id) ? 'Свернуть задачу Jira' : 'Показать задачу Jira здесь'" @click="toggleJira(r.e)">{{ r.e.task.key }}<Icon name="chevronDown" :size="10" /></button><button class="tw:inline-flex tw:p-2 tw:border-0 tw:bg-transparent tw:text-inherit tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:text-text-2 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg" title="Отвязать задачу" @click="giveTask(r.e, null)"><Icon name="x" :size="10" /></button>
        </span>
        <span v-else @click.stop>
          <TaskSearch :marked="[]" placeholder="К какой задаче отнести это время?" @pick="(t) => giveTask(r.e, t)">
            <button class="give tw:inline-flex tw:items-center tw:gap-3 tw:h-20 tw:py-0 tw:px-7 tw:border tw:border-dashed tw:border-border-3 tw:bg-transparent tw:text-muted tw:text-[11px] tw:opacity-0 tw:group-hover/row:opacity-100 tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:text-text-2 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg tw:hover:enabled:not-[.seg_&]:bg-hover tw:hover:enabled:not-[.seg_&]:not-[.quick_&]:border-border-3" title="Отнести к задаче"><Icon name="plus" :size="10" />задача</button>
          </TaskSearch>
        </span>
        <NoteLinks :id="r.e.id" />
        <span class="du num tw:font-data tw:tabular-nums tw:flex-none tw:min-w-52 tw:text-right tw:text-text-2 tw:text-[12px]">{{ formatDuration(r.e.end - r.e.start) }}</span>
        <span class="acts tw:inline-flex tw:flex-none tw:gap-2 tw:opacity-0 tw:group-hover/row:opacity-100" @click.stop>
          <button class="tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-hover:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-hover:text-text-2 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg" title="Показать на таймлайне" @click="(top = 'timeline'), (openId = r.e.id)"><Icon name="timeline" :size="13" /></button>
          <EntryCopyMenu :day="day" :source="r.e" @copied="onCopied" />
          <button v-if="rec.action(r.e, now)" class="tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-down-fg tw:[&.on]:text-down-fg" :class="{ on: r.e.recording }" :title="r.e.recording ? 'Остановить запись' : 'Начать запись: конец события будет продлеваться сам (будущее — когда наступит его время)'" @click="toggleRecording(r.e)"><Icon :name="r.e.recording ? 'stop' : 'rec'" :size="13" /></button>
          <button class="tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text-hi tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-hover:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-hover:text-text-2 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg" v-if="!r.e.outlook" title="Удалить" @click="removeEntry(r.e)"><Icon name="trash" :size="13" /></button>
        </span>
      </div>
      <template v-if="r.t === 'e'">
        <div v-for="o in overlapsOf(r.e.id)" :key="`o${o.a.id}${o.b.id}`" class="orow tw:flex tw:items-center tw:gap-6 tw:mt-0 tw:mr-8 tw:mb-4 tw:ml-38 tw:py-3 tw:px-8 tw:border-l-2 tw:border-l-warn/60 tw:rounded-r2 tw:bg-warn/6 tw:text-warn-fg tw:text-[11.5px] tw:cursor-pointer tw:[&.past]:opacity-75" :class="{ past: o.end <= now }" :title="`Одновременно с «${o.a.label}»`" @click="openId = o.a.id">
          <Icon name="layers" :size="11" />
          <span class="tw:nth-2:min-w-0 tw:nth-2:overflow-hidden tw:nth-2:text-ellipsis tw:nth-2:whitespace-nowrap">пересечение с <b>{{ formatHM(o.a.start) }}–{{ formatHM(o.a.end) }}</b> {{ o.a.label || kindLabel(o.a.kind) }}</span>
          <span class="grow tw:nth-2:min-w-0 tw:nth-2:overflow-hidden tw:nth-2:text-ellipsis tw:nth-2:whitespace-nowrap tw:flex-1"></span>
          <span class="otime tw:nth-2:min-w-0 tw:nth-2:overflow-hidden tw:nth-2:text-ellipsis tw:nth-2:whitespace-nowrap tw:font-data tw:tabular-nums tw:whitespace-nowrap tw:text-muted">{{ formatHM(o.start) }}–{{ formatHM(o.end) }}</span>
          <b class="odur tw:font-data tw:tabular-nums tw:whitespace-nowrap tw:text-warn">{{ formatDuration(o.end - o.start) }}</b>
        </div>
      </template>
      <div v-if="r.t === 'e' && r.e.task && jiraOpen.has(r.e.id)" class="jdet tw:-mt-2 tw:mr-0 tw:mb-6 tw:ml-48 tw:py-8 tw:px-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-(--jira-mark) tw:rounded-r2 tw:bg-panel">
        <JiraDetails v-if="issues[r.e.task.key]" :issue="issues[r.e.task.key]!" />
        <p v-else-if="issues[r.e.task.key] === null" class="none tw:my-10 tw:mx-12 tw:text-muted tw:text-[12px]">Задачи {{ r.e.task.key }} нет среди загруженных из Jira — откройте её в Jira или проверьте подключение.</p>
        <p v-else class="none tw:my-10 tw:mx-12 tw:text-muted tw:text-[12px]">Загружаю из Jira…</p>
      </div>
    </template>
    <p v-if="!feed.some((r) => r.t !== 'now')" class="none tw:my-10 tw:mx-12 tw:text-muted tw:text-[12px]">Пусто. Добавьте запись строкой выше — нажмите N.</p>
    </template>
  </section>
</template>
