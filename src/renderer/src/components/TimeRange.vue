<script setup lang="ts">
import { computed, ref } from 'vue'
import { dayKey, dayStart, formatDuration, formatHM, MINUTE } from '@shared/timeline'
import type { Ms } from '@shared/types'

/**
 * The one "from – to" of the app: «15:35 – 16:20 · 45м», both times right in the text. The wheel over a time — up
 * later, down earlier (by 5 min, Shift — 1); ↑/↓ the same; a click — type it («9», «930», «9:30»).
 * Nothing blocks: a moved start takes the end along (the length kept); an end moved before the start pulls the
 * start back (the length kept). `liveStart` / `liveEnd` — «сейчас» (follows the clock) until changed.
 */
const props = withDefaults(
  defineProps<{ start: Ms; end: Ms; liveStart?: boolean; liveEnd?: boolean; dur?: boolean; boxed?: boolean; disabled?: boolean }>(),
  { dur: true },
)
const emit = defineEmits<{ 'update:start': [t: Ms]; 'update:end': [t: Ms]; change: [r: { start: Ms; end: Ms }] }>()

const length = computed(() => Math.max(MINUTE, props.end - props.start))
/** The day the range is on (its start's day) and its bounds. */
const base = computed(() => dayStart(dayKey(props.start)))
const clampDay = (t: Ms) => Math.max(base.value, Math.min(base.value + 24 * 3_600_000, t))

function apply(start: Ms, end: Ms): void {
  if (end !== props.end) emit('update:end', end)
  if (start !== props.start) emit('update:start', start)
  emit('change', { start, end })
}
/** A new start: the end goes along — the length is kept (a range is filled from its start). */
function setStart(t: Ms): void {
  const s = clampDay(t)
  const e = clampDay(s + length.value)
  apply(Math.min(s, e - MINUTE), e)
}
/** A new end: before the start — the start goes back, the length kept. */
function setEnd(t: Ms): void {
  const e = clampDay(t)
  let s = props.start
  if (e - s < MINUTE) s = clampDay(e - length.value)
  apply(s, Math.max(e, s + MINUTE))
}
const round = (t: Ms, step: number) => Math.round(t / (step * MINUTE)) * step * MINUTE
function nudge(part: 'start' | 'end', minutes: number): void {
  const step = Math.abs(minutes)
  if (part === 'start') setStart(round(props.start, step) + minutes * MINUTE)
  else setEnd(round(props.end, step) + minutes * MINUTE)
}
function onWheel(part: 'start' | 'end', e: WheelEvent): void {
  if (props.disabled) return
  e.preventDefault()
  // up — later, down — earlier
  const up = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) < 0
  nudge(part, (up ? 1 : -1) * (e.shiftKey ? 1 : 5))
}
const editing = ref<'start' | 'end'>()
function onKey(part: 'start' | 'end', e: KeyboardEvent): void {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    nudge(part, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 5))
  } else if (e.key === 'Enter') {
    e.preventDefault()
    ;(e.target as HTMLInputElement).blur()
  } else if (e.key === 'Escape') {
    e.stopPropagation()
    ;(e.target as HTMLInputElement).value = shown(part)
    ;(e.target as HTMLInputElement).blur()
  }
}
/** Typed: «9», «930», «9:30», «09.30». */
function typed(part: 'start' | 'end', v: string): void {
  editing.value = undefined
  const m = v.trim().match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/)
  if (!m || +m[1] > 24 || +(m[2] ?? 0) > 59) return
  const t = base.value + (+m[1] * 60 + +(m[2] ?? 0)) * MINUTE
  if (part === 'start') setStart(t)
  else setEnd(t)
}
const shown = (part: 'start' | 'end') =>
  editing.value !== part && (part === 'start' ? props.liveStart : props.liveEnd) ? 'сейчас' : formatHM(part === 'start' ? props.start : props.end)
</script>

<template>
  <span class="tr" :class="{ boxed, disabled }">
    <input
      class="tp"
      :class="{ live: liveStart && editing !== 'start' }"
      :value="shown('start')"
      :disabled="disabled"
      title="Начало: колесо или ↑↓ — по 5 мин (Shift — по 1), можно ввести"
      spellcheck="false"
      @wheel="onWheel('start', $event)"
      @keydown="onKey('start', $event)"
      @focus="((editing = 'start'), ($event.target as HTMLInputElement).select())"
      @change="typed('start', ($event.target as HTMLInputElement).value)"
      @blur="editing = undefined"
    />–<input
      class="tp"
      :class="{ live: liveEnd && editing !== 'end' }"
      :value="shown('end')"
      :disabled="disabled"
      title="Конец: колесо или ↑↓ — по 5 мин (Shift — по 1), можно ввести"
      spellcheck="false"
      @wheel="onWheel('end', $event)"
      @keydown="onKey('end', $event)"
      @focus="((editing = 'end'), ($event.target as HTMLInputElement).select())"
      @change="typed('end', ($event.target as HTMLInputElement).value)"
      @blur="editing = undefined"
    />
    <template v-if="dur"> · {{ formatDuration(end - start) }}</template>
    <slot />
  </span>
</template>

<style scoped>
.tr {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: none;
  white-space: nowrap;
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.tr.boxed {
  height: 30px;
  padding: 0 10px 0 6px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--field-bg);
  font-size: 13px;
}
.tr.boxed:focus-within {
  border-color: var(--accent);
}
.tp {
  width: 5.2ch;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--r1);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: center;
  cursor: ns-resize;
}
.tr.boxed .tp {
  height: 22px;
}
.tp.live {
  width: 7ch;
  color: var(--up-fg);
}
.tp:hover:not(:disabled),
.tp:focus {
  background: var(--hover);
  outline: 1px solid var(--accent-line);
}
.tp:disabled {
  cursor: default;
}
</style>
