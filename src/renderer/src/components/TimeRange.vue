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

/** Which of the two times. */
type Part = 'start' | 'end'

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
function nudge(part: Part, minutes: number): void {
  const step = Math.abs(minutes)
  if (part === 'start') setStart(round(props.start, step) + minutes * MINUTE)
  else setEnd(round(props.end, step) + minutes * MINUTE)
}
function onWheel(part: Part, e: WheelEvent): void {
  if (props.disabled) return
  e.preventDefault()
  // up — later, down — earlier
  const up = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) < 0
  nudge(part, (up ? 1 : -1) * (e.shiftKey ? 1 : 5))
}
const editing = ref<Part>()
/** An arrow moves the time by 5 min (1 with Shift): up — later, down — earlier. */
function nudgeByKey(part: Part, e: KeyboardEvent, dir: 1 | -1): void {
  e.preventDefault()
  nudge(part, dir * (e.shiftKey ? 1 : 5))
}
/** The keys of a time input: the arrows nudge, Enter applies (by leaving), Esc puts the shown time back. */
const KEY_ACTIONS: Partial<Record<string, (part: Part, e: KeyboardEvent, input: HTMLInputElement) => void>> = {
  ArrowUp: (part, e) => nudgeByKey(part, e, 1),
  ArrowDown: (part, e) => nudgeByKey(part, e, -1),
  Enter: (_part, e, input) => {
    e.preventDefault()
    input.blur()
  },
  Escape: (part, e, input) => {
    e.stopPropagation()
    input.value = shown(part)
    input.blur()
  },
}
function onKey(part: Part, e: KeyboardEvent): void {
  KEY_ACTIONS[e.key]?.(part, e, e.target as HTMLInputElement)
}
/** Typed: «9», «930», «9:30», «09.30». */
function typed(part: Part, v: string): void {
  editing.value = undefined
  const m = v.trim().match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/)
  if (!m || +m[1] > 24 || +(m[2] ?? 0) > 59) return
  const t = base.value + (+m[1] * 60 + +(m[2] ?? 0)) * MINUTE
  if (part === 'start') setStart(t)
  else setEnd(t)
}
const shown = (part: Part) =>
  editing.value !== part && (part === 'start' ? props.liveStart : props.liveEnd) ? 'сейчас' : formatHM(part === 'start' ? props.start : props.end)
</script>

<template>
  <span class="tr tw:group/tr tw:inline-flex tw:items-center tw:gap-1 tw:flex-none tw:whitespace-nowrap tw:font-data tw:tabular-nums tw:text-text tw:[&.boxed]:h-30 tw:[&.boxed]:pt-0 tw:[&.boxed]:pr-10 tw:[&.boxed]:pb-0 tw:[&.boxed]:pl-6 tw:[&.boxed]:border tw:[&.boxed]:border-border-2 tw:[&.boxed]:rounded-r2 tw:[&.boxed]:bg-field tw:[&.boxed]:text-[13px] tw:[&.boxed]:focus-within:border-accent" :class="{ boxed, disabled }">
    <input
      class="tp tw:w-[5.2ch] tw:h-20 tw:p-0 tw:border-0 tw:rounded-r1 tw:bg-transparent tw:text-inherit tw:[font:inherit] tw:text-center tw:cursor-ns-resize tw:group-[.boxed]/tr:h-22 tw:[&.live]:w-[7ch] tw:[&.live]:text-up-fg tw:hover:enabled:bg-hover tw:focus:bg-hover tw:hover:enabled:[outline:1px_solid_var(--accent-line)] tw:focus:[outline:1px_solid_var(--accent-line)] tw:disabled:cursor-default"
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
      class="tp tw:w-[5.2ch] tw:h-20 tw:p-0 tw:border-0 tw:rounded-r1 tw:bg-transparent tw:text-inherit tw:[font:inherit] tw:text-center tw:cursor-ns-resize tw:group-[.boxed]/tr:h-22 tw:[&.live]:w-[7ch] tw:[&.live]:text-up-fg tw:hover:enabled:bg-hover tw:focus:bg-hover tw:hover:enabled:[outline:1px_solid_var(--accent-line)] tw:focus:[outline:1px_solid_var(--accent-line)] tw:disabled:cursor-default"
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
