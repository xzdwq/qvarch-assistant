<script setup lang="ts">
import { ref, watch } from 'vue'
import { atTime, dayKey, formatHM, MINUTE } from '@shared/timeline'
import type { Ms } from '@shared/types'
import Icon from './Icon.vue'

/**
 * HH:MM field tuned for minute-precise nudging: ‹ › buttons, mouse wheel and ↑/↓ change by one minute
 * (Shift — by five). `live` shows "сейчас" while the value follows the current time.
 */
const props = defineProps<{ modelValue: Ms; min?: Ms; max?: Ms; live?: boolean; compact?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [t: Ms] }>()

const text = ref(formatHM(props.modelValue))
const editing = ref(false)
watch(
  () => props.modelValue,
  (v) => !editing.value && (text.value = formatHM(v)),
)

function set(t: Ms): void {
  const v = Math.min(Math.max(t, props.min ?? -Infinity), props.max ?? Infinity)
  emit('update:modelValue', v)
  text.value = formatHM(v)
}

function nudge(minutes: number): void {
  set(Math.round(props.modelValue / MINUTE) * MINUTE + minutes * MINUTE)
}

function commit(): void {
  editing.value = false
  const m = /^(\d{1,2}):?(\d{2})$/.exec(text.value.trim())
  if (!m) {
    text.value = formatHM(props.modelValue)
    return
  }
  set(atTime(dayKey(props.modelValue), `${m[1]}:${m[2]}`))
}

/** An arrow moves the time by a minute (5 with Shift): up — later, down — earlier. */
function nudgeByKey(e: KeyboardEvent, dir: 1 | -1): void {
  e.preventDefault()
  nudge(dir * (e.shiftKey ? 5 : 1))
}
/** The keys of the field: the arrows nudge, Enter applies (by leaving). */
const KEY_ACTIONS: Partial<Record<string, (e: KeyboardEvent) => void>> = {
  ArrowUp: (e) => nudgeByKey(e, 1),
  ArrowDown: (e) => nudgeByKey(e, -1),
  Enter: (e) => (e.target as HTMLInputElement).blur(),
}
function onKey(e: KeyboardEvent): void {
  KEY_ACTIONS[e.key]?.(e)
}
</script>

<template>
  <span class="tf tw:group/tf tw:inline-flex tw:items-center tw:bg-field tw:border tw:border-border tw:rounded-[4px] tw:overflow-hidden tw:[transition:border-color_0.15s] tw:focus-within:border-accent" :class="{ compact }" @wheel.prevent="nudge(($event.deltaY < 0 ? 1 : -1) * ($event.shiftKey ? 5 : 1))">
    <button class="tw:inline-flex tw:items-center tw:border-0 tw:rounded-none tw:bg-transparent tw:py-4 tw:px-7 tw:text-muted tw:leading-none tw:hover:text-text tw:hover:bg-hover tw:group-[.compact]/tf:py-2 tw:group-[.compact]/tf:px-5 tw:hover:enabled:border-border-3" tabindex="-1" title="−1 мин (Shift — 5)" @click="nudge($event.shiftKey ? -5 : -1)"><Icon name="chevronLeft" :size="13" /></button>
    <input class="tw:w-46 tw:border-0 tw:bg-transparent tw:py-4 tw:px-0 tw:text-center tw:tabular-nums tw:font-data tw:font-semibold tw:group-[.compact]/tf:w-42 tw:group-[.compact]/tf:text-[12px] tw:group-[.compact]/tf:py-2 tw:group-[.compact]/tf:px-0"
      v-if="!live || editing"
      v-model="text"
      maxlength="5"
      @focus="editing = true"
      @blur="commit"
      @keydown="onKey"
    />
    <span v-else class="live tw:w-46 tw:border-0 tw:bg-transparent tw:py-4 tw:px-0 tw:text-center tw:tabular-nums tw:font-data tw:text-up-fg tw:cursor-text tw:font-medium tw:text-[12px] tw:group-[.compact]/tf:w-42 tw:group-[.compact]/tf:text-[12px] tw:group-[.compact]/tf:py-2 tw:group-[.compact]/tf:px-0" title="Следует за текущим временем" @click="editing = true">сейчас</span>
    <button class="tw:inline-flex tw:items-center tw:border-0 tw:rounded-none tw:bg-transparent tw:py-4 tw:px-7 tw:text-muted tw:leading-none tw:hover:text-text tw:hover:bg-hover tw:group-[.compact]/tf:py-2 tw:group-[.compact]/tf:px-5 tw:hover:enabled:border-border-3" tabindex="-1" title="+1 мин (Shift — 5)" @click="nudge($event.shiftKey ? 5 : 1)"><Icon name="chevronRight" :size="13" /></button>
  </span>
</template>
