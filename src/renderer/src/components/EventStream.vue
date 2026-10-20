<script setup lang="ts">
import NoteLinks from './NoteLinks.vue'
import { computed, nextTick, ref, watch } from 'vue'
import { formatDuration, formatHM, MINUTE, scheduleRanges } from '@shared/timeline'
import type { Entry, Ms, WorkSchedule } from '@shared/types'
import type { RangeDay } from '../lib/useRange'
import { entryIcon, kindColor, kindLabel } from '../lib/palette'
import { todayKey } from '../lib/today'
import type { Recent } from './LabelInput.vue'
import EntryEditor, { type Draft } from './EntryEditor.vue'
import Icon from './Icon.vue'

/**
 * The events of a period as one stream, day by day: every block, the free time of the working day between them
 * (a click — a new event there, with that time), the open one edited right in the stream. `focusId` — scroll
 * smoothly to that event (the list next to it is hovered), `openId` — edit it.
 */
const props = defineProps<{ days: RangeDay[]; schedule: WorkSchedule; recent: Recent[]; now: Ms; focusId?: string; openId?: string }>()
const emit = defineEmits<{ open: [id: string | undefined]; changed: [] }>()

const GAP_MIN = 15 * MINUTE
type Row = { t: 'e'; key: string; e: Entry; at: Ms } | { t: 'gap'; key: string; start: Ms; end: Ms; at: Ms; past: boolean }
const groups = computed(() =>
  props.days.map((d) => {
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
  }),
)

// ---------- the open event / a new one in a free gap ----------
const draft = ref<{ day: string; entry: Draft }>()
function fillGap(day: string, start: Ms, end: Ms): void {
  emit('open', undefined)
  draft.value = { day, entry: { start, end, kind: 'task', label: '', source: 'manual' } }
  void nextTick(() => scrollTo(`d${day}${start}`, false))
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
  <div ref="box" class="es">
    <section v-for="g in groups" :key="g.day" class="eg">
      <div class="eh" :data-k="`h${g.day}`" :class="{ today: g.day === todayKey, off: g.off }">
        <span>{{ g.title }}</span>
        <span class="et num">{{ g.total ? formatDuration(g.total) : '' }}</span>
      </div>
      <template v-for="r in g.rows" :key="r.key">
        <template v-if="r.t === 'gap'">
          <div v-if="draft?.day === g.day && draft.entry.start === r.start" class="ecard draft" :data-k="`d${g.day}${r.start}`">
            <EntryEditor :key="`d${r.start}`" :day="g.day" :entry="draft.entry" :recent="recent" :entries="g.data.entries" :notes="g.data.notes" :now="now" textarea @saved="(draft = undefined), emit('changed')" @close="draft = undefined" />
            <button class="ex" title="Отмена" @click="draft = undefined"><Icon name="x" :size="13" /></button>
          </div>
          <button v-else class="egap" :class="{ past: r.past }" title="Заполнить это время событием" @click="fillGap(g.day, r.start, r.end)">
            <span class="num">{{ formatHM(r.start) }}–{{ formatHM(r.end) }}</span>
            <span>свободно {{ formatDuration(r.end - r.start) }}</span>
            <Icon name="plus" :size="12" />
          </button>
        </template>
        <div v-else-if="openId === r.e.id" class="ecard" :data-k="r.e.id" :style="{ '--c': kindColor(r.e.kind) }">
          <EntryEditor :key="r.e.id" :day="g.day" :entry="r.e" :recent="recent" :entries="g.data.entries" :notes="g.data.notes" :now="now" textarea @saved="emit('changed')" @copied="(c, d) => (emit('changed'), d === g.day && emit('open', c.id))" @deleted="(emit('open', undefined), emit('changed'))" @close="emit('open', undefined)" />
        </div>
        <button v-else class="erow" :data-k="r.e.id" :class="{ focus: focusId === r.e.id, live: isLive(r.e) }" :style="{ '--c': kindColor(r.e.kind) }" @click="emit('open', r.e.id)">
          <span class="num tm">{{ formatHM(r.e.start) }}–{{ formatHM(r.e.end) }}</span>
          <Icon :name="entryIcon(r.e)" :size="13" class="ic" />
          <span class="tl">{{ r.e.label || kindLabel(r.e.kind) }}<small v-if="r.e.task"> · {{ r.e.task.key }}</small></span>
          <NoteLinks :id="r.e.id" />
          <span class="num du">{{ formatDuration(r.e.end - r.e.start) }}</span>
        </button>
      </template>
      <p v-if="!g.rows.length" class="none">Нет событий</p>
    </section>
  </div>
</template>

<style scoped>
.es {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: 40vh;
}
.num {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}
.eh {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 30px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-hi);
}
.eh.off span:first-child {
  color: var(--down-fg);
}
.eh.today span:first-child {
  color: var(--accent-fg);
}
.et {
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
}
.erow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 12px);
  min-height: 32px;
  margin: 0 6px;
  padding: 3px 8px 3px 6px;
  border: 0;
  border-left: 3px solid var(--c);
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  text-align: left;
  white-space: nowrap;
  font-size: 12.5px;
  cursor: default;
  transition: background 0.2s;
}
.erow:hover,
.erow.focus {
  background: color-mix(in srgb, var(--c) 14%, transparent);
}
.erow.focus {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 60%, transparent);
}
.erow.live {
  background: linear-gradient(90deg, color-mix(in srgb, var(--c) 16%, transparent), transparent 70%);
}
.erow.live .ic {
  animation: es-pulse 1.4s ease-in-out infinite;
}
@keyframes es-pulse {
  50% {
    opacity: 0.4;
  }
}
.tm {
  flex: none;
  width: 84px;
  color: var(--text-2);
  font-size: 11.5px;
}
.ic {
  flex: none;
  color: var(--c);
}
.tl {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tl small {
  color: var(--info-fg);
  font-family: var(--font-data);
}
.du {
  flex: none;
  color: var(--text-2);
  font-size: 11.5px;
}
.egap {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 12px);
  height: 24px;
  margin: 0 6px;
  padding: 0 8px 0 9px;
  border: 0;
  border-bottom: 1px dashed var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11.5px;
  text-align: left;
}
.egap .num {
  width: 84px;
}
.egap.past {
  color: var(--dim);
}
.egap svg {
  margin-left: auto;
  opacity: 0;
}
.egap:hover {
  background: var(--hover);
  color: var(--accent-fg);
}
.egap:hover svg {
  opacity: 1;
}
.ecard {
  position: relative;
  margin: 6px;
  padding: 10px 12px;
  border: 1px solid var(--accent-line);
  border-left: 3px solid var(--c, var(--accent));
  border-radius: var(--r3);
  background: var(--panel-2);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.ecard.draft {
  border-style: dashed;
}
.ex {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.none {
  margin: 8px 12px;
  color: var(--dim);
  font-size: 12px;
}
</style>
