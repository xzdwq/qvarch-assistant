<script setup lang="ts">
import { openUrl } from '../lib/links'
import { computed, ref } from 'vue'
import { formatDuration, formatHM, MINUTE, overlapPairs, unionMs } from '@shared/timeline'
import type { DayData, Ms } from '@shared/types'
import { entryIcon, kindColor, kindLabel } from '../lib/palette'
import { useJira } from '../lib/jira'
import Icon from './Icon.vue'

/**
 * "Записи": the day's blocks in time order with the plan between them (dashed, "по плану" makes the block once),
 * the totals and where blocks ran at the same time. With `now` the
 * finished blocks fade and the one going on is marked.
 */
const props = defineProps<{ data: DayData; selectedId?: string; now?: Ms }>()
const emit = defineEmits<{ select: [id: string]; changed: [] }>()

const sorted = computed(() => [...props.data.entries].sort((a, b) => a.start - b.start || (a.lane ?? 0) - (b.lane ?? 0)))
/** Blocks running at the same time — the stretch is shown under the later one. */
const overlaps = computed(() => overlapPairs(sorted.value))
const overlapsOf = (id: string) => overlaps.value.filter((o) => o.b.id === id)
const overlapIds = computed(() => new Set(overlaps.value.flatMap((o) => [o.a.id, o.b.id])))
/** The day's time in blocks (parallel time counted once) and how much of it ran in parallel. */
const totals = computed(() => {
  const sum = sorted.value.reduce((a, e) => a + (e.end - e.start), 0)
  const real = unionMs(sorted.value)
  return { sum, real, parallel: sum - real }
})
/** Per kind: its blocks' time (its own overlaps counted once), the biggest first. */
const byKind = computed(() => {
  const m = new Map<string, typeof sorted.value>()
  for (const e of sorted.value) m.set(e.kind, [...(m.get(e.kind) ?? []), e])
  return [...m].map(([kind, list]) => ({ kind, ms: unionMs(list) })).filter((k) => k.ms >= MINUTE).sort((a, b) => b.ms - a.ms)
})
/** Latest first (remembered). */
const SORT_KEY = 'qa.recs.desc'
const desc = ref(readDesc())
function readDesc(): boolean {
  try {
    return localStorage.getItem(SORT_KEY) === '1'
  } catch {
    return false
  }
}
function toggleSort(): void {
  desc.value = !desc.value
  try {
    localStorage.setItem(SORT_KEY, desc.value ? '1' : '0')
  } catch {
    // not remembered — fine
  }
}
const madeIds = computed(() => new Set((props.data.plan ?? []).filter((p) => p.doneEntryId && props.data.entries.some((e) => e.id === p.doneEntryId)).map((p) => p.id)))
const rows = computed(() =>
  [
    ...sorted.value.map((e) => ({ kind: 'entry' as const, id: e.id, t: e.start, e })),
    ...(props.data.plan ?? []).map((p) => ({ kind: 'plan' as const, id: p.id, t: p.start, p, done: madeIds.value.has(p.id) })),
  ].sort((a, b) => (desc.value ? b.t - a.t : a.t - b.t)),
)
const busy = ref(new Set<string>())
async function planDone(id: string): Promise<void> {
  // the box is locked while main makes the block (main itself makes it only once)
  if (busy.value.has(id)) return
  busy.value = new Set([...busy.value, id])
  try {
    await window.qa.planDone(props.data.day, id)
    emit('changed')
  } finally {
    busy.value = new Set([...busy.value].filter((x) => x !== id))
  }
}

const jiraState = useJira()
const isJira = (key?: string) => !!key && !key.startsWith('Q-')
function openJiraKey(key: string): void {
  if (jiraState.value.siteUrl) openUrl(`${jiraState.value.siteUrl}/browse/${key}`)
}
const stripKey = (label: string, key?: string) => (key && label.startsWith(key) ? label.slice(key.length).trim() : label)
const past = (end: Ms) => props.now !== undefined && end <= props.now
const going = (start: Ms, end: Ms) => props.now !== undefined && start <= props.now && props.now < end
</script>

<template>
  <div class="recs tw:flex tw:flex-col">
    <div v-if="rows.length" class="esum tw:sticky tw:top-0 tw:z-2 tw:items-center tw:bg-panel tw:flex tw:flex-wrap tw:gap-y-6 tw:gap-x-16 tw:pt-2 tw:pr-8 tw:pb-10 tw:pl-8 tw:mb-4 tw:border-b tw:border-b-border tw:text-muted tw:text-[12px]">
      <span title="Пересечения посчитаны один раз">Записей <b class="tw:text-text tw:tabular-nums tw:font-data">{{ sorted.length }}</b> · <b class="tw:text-text tw:tabular-nums tw:font-data">{{ formatDuration(totals.real) }}</b></span>
      <span v-for="k in byKind" :key="k.kind" class="kt tw:inline-flex tw:items-center tw:gap-5" :title="kindLabel(k.kind)"><i class="tw:w-8 tw:h-8 tw:rounded-[2px]" :style="{ background: kindColor(k.kind) }"></i><b class="tw:text-text tw:tabular-nums tw:font-data">{{ formatDuration(k.ms) }}</b></span>
      <span v-if="totals.parallel >= MINUTE" class="ov tw:inline-flex tw:items-center tw:gap-4 tw:text-warn" title="Пересечения"><Icon name="layers" :size="12" /><b class="tw:tabular-nums tw:font-data tw:text-warn">{{ formatDuration(totals.parallel) }}</b></span>
      <span class="grow tw:flex-1"></span>
      <button class="srt tw:inline-flex tw:items-center tw:justify-center tw:w-24 tw:h-22 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:not-[&.on]:text-text tw:[&.on]:text-accent-fg tw:hover:enabled:border-border-3" :class="{ on: desc }" :title="desc ? 'Сначала поздние' : 'Сначала ранние'" @click="toggleSort"><Icon name="sort" :size="13" /></button>
    </div>
    <template v-for="r in rows" :key="r.id">
      <template v-if="r.kind === 'entry'">
        <div
          class="row tw:group/row tw:relative tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:rounded-r2 tw:cursor-pointer tw:text-[13px] tw:[transition:background_0.15s,opacity_0.2s] tw:hover:not-[&.selected]:bg-hover tw:[&.selected]:bg-panel-2 tw:[&.selected]:[box-shadow:inset_2px_0_0_var(--accent)] tw:[&.past]:opacity-50 tw:[&.past]:hover:opacity-85 tw:[&.going]:before:content-[''] tw:[&.going]:before:absolute tw:[&.going]:before:left-1 tw:[&.going]:before:top-5 tw:[&.going]:before:bottom-5 tw:[&.going]:before:w-3 tw:[&.going]:before:rounded-[2px] tw:[&.going]:before:bg-down tw:[&.going]:before:[box-shadow:0_0_6px_color-mix(in_srgb,var(--down)_60%,transparent)]"
          :class="{ selected: r.e.id === selectedId, par: overlapIds.has(r.e.id), past: past(r.e.end), going: going(r.e.start, r.e.end) }"
          @click="emit('select', r.e.id)"
        >
          <span class="eic tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:rounded-r2 tw:text-text-hi" :style="{ background: kindColor(r.e.kind) }" :title="kindLabel(r.e.kind)"><Icon :name="entryIcon(r.e)" :size="12" :stroke="2.4" /></span>
          <span class="when tw:flex-none tw:flex tw:flex-col tw:items-start tw:w-92 tw:pr-10 tw:border-r tw:border-r-border tw:leading-[1.25] tw:group-[.par]/row:border-r-warn/55">
            <span class="time tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:text-[12.5px] tw:text-text-2">{{ formatHM(r.e.start) }}–{{ formatHM(r.e.end) }}</span>
            <span class="dur tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:text-[11px] tw:text-muted">{{ formatDuration(r.e.end - r.e.start) }}</span>
          </span>
          <span class="main tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-1">
            <span class="lbl tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-medium"><span v-if="r.e.task" class="key tw:text-info-fg tw:font-semibold tw:text-[12px]">{{ r.e.task.key }}</span> {{ stripKey(r.e.label, r.e.task?.key) }}</span>
            <span v-if="r.e.description" class="desc tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11.5px]">{{ r.e.description.split('\n')[0] }}</span>
          </span>
          <span v-if="r.e.source === 'ai'" class="ai tw:flex-none tw:text-[10px] tw:py-1 tw:px-5 tw:rounded-r2 tw:bg-accent">AI</span>
          <span v-if="r.e.outlook" class="ol tw:flex-none tw:text-[10px] tw:py-1 tw:px-5 tw:rounded-r2 tw:bg-info" title="Встреча из Outlook">Outlook</span>
          <button v-if="isJira(r.e.task?.key) && jiraState.siteUrl" class="jl tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-info-fg tw:hover:bg-info/15 tw:hover:enabled:border-border-3" data-link :title="`Открыть ${r.e.task!.key} в Jira`" @click.stop="openJiraKey(r.e.task!.key)"><Icon name="external" :size="13" /></button>
        </div>
        <div v-for="o in overlapsOf(r.e.id)" :key="`o${o.a.id}${o.b.id}`" class="orow tw:flex tw:items-center tw:gap-6 tw:-mt-2 tw:mr-0 tw:mb-4 tw:ml-38 tw:py-4 tw:px-8 tw:rounded-r2 tw:border-l-2 tw:border-l-warn/60 tw:bg-warn/6 tw:text-warn-fg tw:text-[11.5px] tw:[&.past]:opacity-50" :class="{ past: past(o.end) }" :title="`Одновременно с «${o.a.label}»`">
          <Icon name="layers" :size="11" />
          <span class="tw:nth-2:min-w-0 tw:nth-2:overflow-hidden tw:nth-2:text-ellipsis tw:nth-2:whitespace-nowrap">пересечение с <b>{{ formatHM(o.a.start) }}–{{ formatHM(o.a.end) }}</b> {{ o.a.label }}</span>
          <span class="grow tw:nth-2:min-w-0 tw:nth-2:overflow-hidden tw:nth-2:text-ellipsis tw:nth-2:whitespace-nowrap tw:flex-1"></span>
          <span class="otime tw:nth-2:min-w-0 tw:nth-2:overflow-hidden tw:nth-2:text-ellipsis tw:nth-2:whitespace-nowrap tw:tabular-nums tw:font-data tw:text-muted tw:whitespace-nowrap">{{ formatHM(o.start) }}–{{ formatHM(o.end) }}</span>
          <b class="odur tw:tabular-nums tw:font-data tw:text-warn tw:whitespace-nowrap">{{ formatDuration(o.end - o.start) }}</b>
        </div>
      </template>
      <div v-else class="row plan tw:group/row tw:relative tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:[transition:background_0.15s,opacity_0.2s] tw:hover:bg-hover tw:my-2 tw:mx-0 tw:border tw:border-dashed tw:border-[color-mix(in_srgb,var(--c)_55%,transparent)] tw:cursor-default tw:[&.done]:opacity-[0.55] tw:[&.past]:not-[&.done]:opacity-50 tw:[&&]:[&.past]:hover:opacity-85" :class="{ done: r.done, past: past(r.p.end) }" :style="{ '--c': kindColor(r.p.kind) }">
        <span class="eic pl tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:rounded-r2 tw:bg-transparent tw:border tw:border-dashed tw:border-(--c) tw:text-(--c) tw:box-border" :title="`План · ${kindLabel(r.p.kind)}`"><Icon :name="entryIcon(r.p)" :size="12" :stroke="2.4" /></span>
        <span class="when tw:flex-none tw:flex tw:flex-col tw:items-start tw:w-92 tw:pr-10 tw:border-r tw:border-r-border tw:leading-[1.25]">
          <span class="time tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:text-[12.5px] tw:text-text-2">{{ formatHM(r.p.start) }}–{{ formatHM(r.p.end) }}</span>
          <span class="dur tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:text-[11px] tw:text-muted">{{ formatDuration(r.p.end - r.p.start) }}</span>
        </span>
        <span class="main tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-1">
          <span class="lbl tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-medium"><span v-if="r.p.task" class="key tw:text-info-fg tw:font-semibold tw:text-[12px]">{{ r.p.task.key }}</span> {{ stripKey(r.p.label, r.p.task?.key) }}</span>
          <span class="desc tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11.5px]">план</span>
        </span>
        <label class="pchk tw:flex-none tw:inline-flex tw:items-center tw:gap-5 tw:text-muted tw:text-[11.5px] tw:cursor-pointer tw:group-[.done]/row:text-up" title="Сделано по плану">
          <input class="tw:[accent-color:var(--up)] tw:m-0" type="checkbox" :checked="r.done" :disabled="r.done || busy.has(r.id)" @change="planDone(r.id)" />
          <span>{{ r.done ? 'сделано' : 'по плану' }}</span>
        </label>
      </div>
    </template>
    <p v-if="!rows.length" class="empty tw:my-10 tw:mx-12 tw:text-muted tw:text-[12.5px]">Пока ничего не размечено</p>
  </div>
</template>

<style scoped src="./EntryRecords.css"></style>
