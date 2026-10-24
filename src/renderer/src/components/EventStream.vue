<script setup lang="ts">
import NoteLinks from './NoteLinks.vue'
import { computed, nextTick, ref, watch } from 'vue'
import { dayEnd, dayKey, dayStart, formatDuration, formatHM, MINUTE, scheduleRanges } from '@shared/timeline'
import type { Entry, Ms, WorkSchedule } from '@shared/types'
import type { RangeDay } from '../lib/useRange'
import { entryIcon, kindColor, kindLabel } from '../lib/palette'
import { todayKey } from '../lib/today'
import type { Recent } from './LabelInput.vue'
import EntryEditor, { type Draft } from './EntryEditor.vue'
import Icon from './Icon.vue'
import AttrChips from './AttrChips.vue'

/**
 * The events of a period as one stream, day by day: every block, the free time of the working day between them
 * (a click — a new event there, with that time), the open one edited right in the stream. `focusId` — scroll
 * smoothly to that event (the list next to it is hovered), `openId` — edit it.
 */
/** `order` — 'desc': the latest day and event first (the default — the earliest first). */
const props = defineProps<{ days: RangeDay[]; schedule: WorkSchedule; recent: Recent[]; now: Ms; focusId?: string; openId?: string; order?: 'asc' | 'desc' }>()
const emit = defineEmits<{ open: [id: string | undefined]; changed: [] }>()

const GAP_MIN = 15 * MINUTE
type Row = { t: 'e'; key: string; e: Entry; at: Ms } | { t: 'gap'; key: string; start: Ms; end: Ms; at: Ms; past: boolean }
const groups = computed(() => {
  const list = props.days.map((d) => {
    const rows: Row[] = d.entries.map((e) => ({ t: 'e' as const, key: e.id, e, at: e.start }))
    const busy = [...d.entries].sort((a, b) => a.start - b.start)
    const work = scheduleRanges(d.day, props.schedule).work
    const lo = Math.min(work?.[0] ?? Infinity, busy[0]?.start ?? Infinity)
    const hi = Math.max(work?.[1] ?? -Infinity, busy.reduce((m, b) => Math.max(m, b.end), -Infinity))
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      let t = lo
      const push = (a: Ms, b: Ms) => b - a >= GAP_MIN && rows.push({ t: 'gap', key: `g${d.day}${a}`, start: a, end: b, at: a, past: b <= props.now })
      for (const b of busy) {
        if (b.start > t) push(t, b.start)
        t = Math.max(t, b.end)
      }
      if (hi > t) push(t, hi)
    }
    rows.sort((a, b) => a.at - b.at)
    if (props.order === 'desc') rows.reverse()
    const total = (() => {
      let sum = 0
      let ce = -Infinity
      for (const b of busy) {
        const s = Math.max(b.start, ce)
        if (b.end > s) sum += b.end - s
        ce = Math.max(ce, b.end)
      }
      return sum
    })()
    const date = new Date(`${d.day}T12:00:00`)
    const title = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
    return { day: d.day, data: d, rows, total, title: title.charAt(0).toUpperCase() + title.slice(1), off: !props.schedule.workDays.includes(date.getDay()) }
  })
  return props.order === 'desc' ? list.reverse() : list
})

// ---------- the open event / a new one in a free gap ----------
/** A new event being filled in: in a free gap, or from the day's «+» (`head` — under the day's header). */
const draft = ref<{ day: string; entry: Draft; head?: boolean }>()
function fillGap(day: string, start: Ms, end: Ms): void {
  emit('open', undefined)
  draft.value = { day, entry: { start, end, kind: 'task', label: '', source: 'manual' } }
  void nextTick(() => scrollTo(`d${day}${start}`, false))
}
/** A new event of the day picked: the card under its header, at the time it is now (on that day), half an hour. */
const NEW_EVENT_MIN = 30
function addOn(day: string): void {
  emit('open', undefined)
  const now = Date.now()
  const at = Math.floor((now - dayStart(dayKey(now))) / MINUTE) * MINUTE
  const start = Math.min(dayStart(day) + at, dayEnd(day) - NEW_EVENT_MIN * MINUTE)
  draft.value = { day, head: true, entry: { start, end: start + NEW_EVENT_MIN * MINUTE, kind: 'task', label: '', source: 'manual' } }
  void nextTick(() => scrollTo(`n${day}`, false))
}
watch(
  () => props.openId,
  (id) => {
    if (id) draft.value = undefined
  },
)
const isLive = (e: Entry) => e.start <= props.now && e.end >= props.now - 90_000 && (e.source === 'detected' || e.end > props.now)

// ---------- scrolling to an event ----------
const box = ref<HTMLElement>()
let scrollTimer: ReturnType<typeof setTimeout> | undefined
function scrollTo(key: string, smooth = true): void {
  const el = box.value?.querySelector<HTMLElement>(`[data-k="${key}"]`)
  const b = box.value
  if (!el || !b) return
  const r = el.getBoundingClientRect()
  const br = b.getBoundingClientRect()
  // into the middle (a tall open editor — its top a little under the day's header)
  const top = b.scrollTop + r.top - br.top - (r.height > br.height * 0.6 ? 44 : (br.height - r.height) / 2)
  b.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' })
}
watch(
  () => props.focusId,
  (id) => {
    clearTimeout(scrollTimer)
    // a short pause: running the pointer down the list does not shake the stream
    if (id) scrollTimer = setTimeout(() => scrollTo(id), 140)
  },
)
watch(
  () => props.openId,
  (id) => id && void nextTick(() => scrollTo(id)),
)
// the period changed: to today (or the start)
watch(
  () => props.days.map((d) => d.day).join(),
  () =>
    void nextTick(() => {
      const t = props.days.find((d) => d.day === todayKey.value)
      if (t) scrollTo(`h${t.day}`, false)
      else box.value?.scrollTo({ top: 0 })
    }),
)
</script>

<template>
  <div ref="box" class="es tw:h-full tw:overflow-y-auto tw:overscroll-contain tw:pb-[40vh]">
    <section v-for="g in groups" :key="g.day" class="eg">
      <div class="eh tw:group/eh tw:sticky tw:top-0 tw:z-2 tw:flex tw:justify-between tw:items-center tw:h-30 tw:py-0 tw:px-12 tw:border-b tw:border-b-border tw:bg-panel-2 tw:text-[12px] tw:font-semibold tw:text-text-hi" :data-k="`h${g.day}`" :class="{ today: g.day === todayKey, off: g.off }">
        <span class="tw:group-[.off]/eh:first:not-group-[.today]/eh:text-down-fg tw:group-[.today]/eh:first:text-accent-fg">{{ g.title }}</span>
        <span class="tw:inline-flex tw:items-center tw:gap-6">
          <span class="et num tw:font-data tw:tabular-nums tw:group-[.off]/eh:first:not-group-[.today]/eh:text-down-fg tw:group-[.today]/eh:first:text-accent-fg tw:text-muted tw:text-[11px] tw:font-normal">{{ g.total ? formatDuration(g.total) : '' }}</span>
          <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-accent-fg" :title="`Новое событие на ${g.title} — с текущего времени`" @click="addOn(g.day)"><Icon name="plus" :size="13" /></button>
        </span>
      </div>
      <div v-if="draft?.head && draft.day === g.day" class="ecard draft tw:relative tw:m-6 tw:py-10 tw:px-12 tw:border tw:border-accent-line tw:[&&]:border-l-3 tw:[&&]:border-l-(--c,var(--accent)) tw:rounded-r3 tw:bg-panel-2 tw:[box-shadow:0_0_0_3px_var(--accent-soft)] tw:[&&&]:border-dashed" :data-k="`n${g.day}`">
        <EntryEditor :key="`n${g.day}`" :day="g.day" :entry="draft.entry" :recent="recent" :entries="g.data.entries" :notes="g.data.notes" :now="now" textarea @saved="(draft = undefined), emit('changed')" @close="draft = undefined" />
        <button class="ex tw:absolute tw:top-8 tw:right-8 tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Отмена" @click="draft = undefined"><Icon name="x" :size="13" /></button>
      </div>
      <template v-for="r in g.rows" :key="r.key">
        <template v-if="r.t === 'gap'">
          <div v-if="!draft?.head && draft?.day === g.day && draft.entry.start === r.start" class="ecard draft tw:relative tw:m-6 tw:py-10 tw:px-12 tw:border tw:border-accent-line tw:[&&]:border-l-3 tw:[&&]:border-l-(--c,var(--accent)) tw:rounded-r3 tw:bg-panel-2 tw:[box-shadow:0_0_0_3px_var(--accent-soft)] tw:[&&&]:border-dashed" :data-k="`d${g.day}${r.start}`">
            <EntryEditor :key="`d${r.start}`" :day="g.day" :entry="draft.entry" :recent="recent" :entries="g.data.entries" :notes="g.data.notes" :now="now" textarea @saved="(draft = undefined), emit('changed')" @close="draft = undefined" />
            <button class="ex tw:absolute tw:top-8 tw:right-8 tw:inline-flex tw:p-4 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Отмена" @click="draft = undefined"><Icon name="x" :size="13" /></button>
          </div>
          <button v-else class="egap tw:group/egap tw:flex tw:items-center tw:gap-8 tw:w-[calc(100%-12px)] tw:h-24 tw:my-0 tw:mx-6 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-9 tw:border-0 tw:[&&]:border-b tw:[&&]:[border-bottom-style:dashed] tw:[&&]:border-b-border tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:text-left tw:[&.past]:not-hover:text-dim tw:hover:bg-hover tw:hover:text-accent-fg tw:hover:enabled:border-border-3" :class="{ past: r.past }" title="Заполнить это время событием" @click="fillGap(g.day, r.start, r.end)">
            <span class="num tw:font-data tw:tabular-nums tw:w-84">{{ formatHM(r.start) }}–{{ formatHM(r.end) }}</span>
            <span>свободно {{ formatDuration(r.end - r.start) }}</span>
            <Icon class="tw:ml-auto tw:opacity-0 tw:group-hover/egap:opacity-100" name="plus" :size="12" />
          </button>
        </template>
        <div v-else-if="openId === r.e.id" class="ecard tw:relative tw:m-6 tw:py-10 tw:px-12 tw:border tw:border-accent-line tw:[&&]:border-l-3 tw:[&&]:border-l-(--c,var(--accent)) tw:rounded-r3 tw:bg-panel-2 tw:[box-shadow:0_0_0_3px_var(--accent-soft)]" :data-k="r.e.id" :style="{ '--c': kindColor(r.e.kind) }">
          <EntryEditor :key="r.e.id" :day="g.day" :entry="r.e" :recent="recent" :entries="g.data.entries" :notes="g.data.notes" :now="now" textarea @saved="emit('changed')" @copied="(c, d) => (emit('changed'), d === g.day && emit('open', c.id))" @deleted="(emit('open', undefined), emit('changed'))" @close="emit('open', undefined)" />
        </div>
        <button v-else class="erow tw:group/erow tw:flex tw:items-center tw:gap-8 tw:w-[calc(100%-12px)] tw:min-h-32 tw:my-0 tw:mx-6 tw:pt-3 tw:pr-8 tw:pb-3 tw:pl-6 tw:border-0 tw:[&&]:border-l-3 tw:[&&]:border-l-(--c) tw:[&&]:border-b tw:[&&]:border-b-border tw:rounded-none tw:bg-transparent tw:text-left tw:whitespace-nowrap tw:text-[12.5px] tw:cursor-default tw:[transition:background_0.2s] tw:hover:not-[&.focus]:not-[&.live]:bg-[color-mix(in_srgb,var(--c)_14%,transparent)] tw:[&.focus]:not-[&.live]:bg-[color-mix(in_srgb,var(--c)_14%,transparent)] tw:[&.focus]:[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--c)_60%,transparent)] tw:[&.live]:[background:linear-gradient(90deg,color-mix(in_srgb,var(--c)_16%,transparent),transparent_70%)] tw:hover:enabled:border-border-3" :data-k="r.e.id" :class="{ focus: focusId === r.e.id, live: isLive(r.e) }" :style="{ '--c': kindColor(r.e.kind) }" @click="emit('open', r.e.id)">
          <span class="num tm tw:font-data tw:tabular-nums tw:flex-none tw:w-84 tw:text-text-2 tw:text-[11.5px]">{{ formatHM(r.e.start) }}–{{ formatHM(r.e.end) }}</span>
          <Icon :name="entryIcon(r.e)" :size="13" class="ic tw:group-[.live]/erow:animate-[EventStream-es-pulse_1.4s_ease-in-out_infinite] tw:[&&]:flex-none tw:text-(--c)" />
          <span class="tl tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis">{{ r.e.label || kindLabel(r.e.kind) }}<small class="tw:text-info-fg tw:font-data" v-if="r.e.task"> · {{ r.e.task.key }}</small></span>
          <AttrChips :attrs="r.e.attrs" />
          <NoteLinks :id="r.e.id" />
          <span class="num du tw:font-data tw:tabular-nums tw:flex-none tw:text-text-2 tw:text-[11.5px]">{{ formatDuration(r.e.end - r.e.start) }}</span>
        </button>
      </template>
      <p v-if="!g.rows.length" class="none tw:my-8 tw:mx-12 tw:text-dim tw:text-[12px]">Нет событий</p>
    </section>
  </div>
</template>
