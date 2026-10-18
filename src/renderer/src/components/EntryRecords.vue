<script setup lang="ts">
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
  if (jiraState.value.siteUrl) window.qa.openExternal(`${jiraState.value.siteUrl}/browse/${key}`)
}
const stripKey = (label: string, key?: string) => (key && label.startsWith(key) ? label.slice(key.length).trim() : label)
const past = (end: Ms) => props.now !== undefined && end <= props.now
const going = (start: Ms, end: Ms) => props.now !== undefined && start <= props.now && props.now < end
</script>

<template>
  <div class="recs">
    <div v-if="rows.length" class="esum">
      <span title="Пересечения посчитаны один раз">Записей <b>{{ sorted.length }}</b> · <b>{{ formatDuration(totals.real) }}</b></span>
      <span v-for="k in byKind" :key="k.kind" class="kt" :title="kindLabel(k.kind)"><i :style="{ background: kindColor(k.kind) }"></i><b>{{ formatDuration(k.ms) }}</b></span>
      <span v-if="totals.parallel >= MINUTE" class="ov" title="Пересечения"><Icon name="layers" :size="12" /><b>{{ formatDuration(totals.parallel) }}</b></span>
      <span class="grow"></span>
      <button class="srt" :class="{ on: desc }" :title="desc ? 'Сначала поздние' : 'Сначала ранние'" @click="toggleSort"><Icon name="sort" :size="13" /></button>
    </div>
    <template v-for="r in rows" :key="r.id">
      <template v-if="r.kind === 'entry'">
        <div
          class="row"
          :class="{ selected: r.e.id === selectedId, par: overlapIds.has(r.e.id), past: past(r.e.end), going: going(r.e.start, r.e.end) }"
          @click="emit('select', r.e.id)"
        >
          <span class="eic" :style="{ background: kindColor(r.e.kind) }" :title="kindLabel(r.e.kind)"><Icon :name="entryIcon(r.e)" :size="12" :stroke="2.4" /></span>
          <span class="when">
            <span class="time">{{ formatHM(r.e.start) }}–{{ formatHM(r.e.end) }}</span>
            <span class="dur">{{ formatDuration(r.e.end - r.e.start) }}</span>
          </span>
          <span class="main">
            <span class="lbl"><span v-if="r.e.task" class="key">{{ r.e.task.key }}</span> {{ stripKey(r.e.label, r.e.task?.key) }}</span>
            <span v-if="r.e.description" class="desc">{{ r.e.description.split('\n')[0] }}</span>
          </span>
          <span v-if="r.e.source === 'ai'" class="ai">AI</span>
          <span v-if="r.e.outlook" class="ol" title="Встреча из Outlook">Outlook</span>
          <button v-if="isJira(r.e.task?.key) && jiraState.siteUrl" class="jl" :title="`Открыть ${r.e.task!.key} в Jira`" @click.stop="openJiraKey(r.e.task!.key)"><Icon name="external" :size="13" /></button>
        </div>
        <div v-for="o in overlapsOf(r.e.id)" :key="`o${o.a.id}${o.b.id}`" class="orow" :class="{ past: past(o.end) }" :title="`Одновременно с «${o.a.label}»`">
          <Icon name="layers" :size="11" />
          <span>пересечение с <b>{{ formatHM(o.a.start) }}–{{ formatHM(o.a.end) }}</b> {{ o.a.label }}</span>
          <span class="grow"></span>
          <span class="otime">{{ formatHM(o.start) }}–{{ formatHM(o.end) }}</span>
          <b class="odur">{{ formatDuration(o.end - o.start) }}</b>
        </div>
      </template>
      <div v-else class="row plan" :class="{ done: r.done, past: past(r.p.end) }" :style="{ '--c': kindColor(r.p.kind) }">
        <span class="eic pl" :title="`План · ${kindLabel(r.p.kind)}`"><Icon :name="entryIcon(r.p)" :size="12" :stroke="2.4" /></span>
        <span class="when">
          <span class="time">{{ formatHM(r.p.start) }}–{{ formatHM(r.p.end) }}</span>
          <span class="dur">{{ formatDuration(r.p.end - r.p.start) }}</span>
        </span>
        <span class="main">
          <span class="lbl"><span v-if="r.p.task" class="key">{{ r.p.task.key }}</span> {{ stripKey(r.p.label, r.p.task?.key) }}</span>
          <span class="desc">план</span>
        </span>
        <label class="pchk" title="Сделано по плану">
          <input type="checkbox" :checked="r.done" :disabled="r.done || busy.has(r.id)" @change="planDone(r.id)" />
          <span>{{ r.done ? 'сделано' : 'по плану' }}</span>
        </label>
      </div>
    </template>
    <p v-if="!rows.length" class="empty">Пока ничего не размечено</p>
  </div>
</template>

<style scoped>
.recs {
  display: flex;
  flex-direction: column;
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--r2);
  cursor: pointer;
  font-size: 13px;
  transition:
    background 0.15s,
    opacity 0.2s;
}
.row:hover {
  background: var(--hover);
}
.row.selected {
  background: var(--panel-2);
  box-shadow: inset 2px 0 0 var(--accent);
}
.time,
.dur {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  white-space: nowrap;
}
/* records: icon | when (time + duration) | what */
/* the header stays put while the list scrolls */
.esum {
  position: sticky;
  top: 0;
  z-index: 2;
  align-items: center;
  background: var(--panel);
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 2px 8px 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
}
.esum .kt {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.esum .kt i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.srt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.srt:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.srt.on {
  color: var(--accent-fg);
}
.srt.on :deep(svg) {
  transform: scaleY(-1);
}
.esum b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.esum .ov {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--warn);
}
.esum .ov b {
  color: var(--warn);
}
.eic {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--r2);
  color: var(--text-hi);
}
.when {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 92px;
  padding-right: 10px;
  border-right: 1px solid var(--border);
  line-height: 1.25;
}
.when .time {
  font-size: 12.5px;
  color: var(--text-2);
}
.when .dur {
  font-size: 11px;
  color: var(--muted);
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.lbl {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 11.5px;
}
.row.par .when {
  border-right-color: rgba(255, 183, 77, 0.55);
}
.ol {
  flex: none;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: var(--r2);
  background: var(--info);
}
.ai {
  flex: none;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: var(--r2);
  background: var(--accent);
}
.lnk {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  color: var(--accent-fg);
}
.jl {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--info-fg);
}
.jl:hover {
  background: rgba(68, 138, 255, 0.15);
}
.key {
  color: var(--info-fg);
  font-weight: 600;
  font-size: 12px;
}
.orow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -2px 0 4px 38px;
  padding: 4px 8px;
  border-radius: var(--r2);
  border-left: 2px solid rgba(255, 183, 77, 0.6);
  background: rgba(255, 183, 77, 0.06);
  color: var(--warn-fg);
  font-size: 11.5px;
}
.orow > span:nth-child(2) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.orow .otime {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  color: var(--muted);
  white-space: nowrap;
}
.orow .odur {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  color: var(--warn);
  white-space: nowrap;
}
.grow {
  flex: 1;
}
/* the plan: dashed, ticked "по плану" once */
.row.plan {
  margin: 2px 0;
  border: 1px dashed color-mix(in srgb, var(--c) 55%, transparent);
  cursor: default;
}
.row.plan.done {
  opacity: 0.55;
}
.eic.pl {
  background: transparent;
  border: 1px dashed var(--c);
  color: var(--c);
  box-sizing: border-box;
}
.pchk {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
  font-size: 11.5px;
  cursor: pointer;
}
.pchk input {
  accent-color: var(--up);
  margin: 0;
}
.row.plan.done .pchk {
  color: var(--up);
}
/* finished — faded; going on — a red line left of the icon */
.row.past,
.orow.past {
  opacity: 0.5;
}
.row.past:hover {
  opacity: 0.85;
}
.row.going::before {
  content: '';
  position: absolute;
  left: 1px;
  top: 5px;
  bottom: 5px;
  width: 3px;
  border-radius: 2px;
  background: var(--down);
  box-shadow: 0 0 6px rgba(255, 61, 61, 0.6);
}
.empty {
  margin: 10px 12px;
  color: var(--muted);
  font-size: 12.5px;
}
/* the dashboard's: smaller type, tighter rows */
</style>
