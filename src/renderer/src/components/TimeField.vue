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

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    nudge((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1))
  } else if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
}
</script>

<template>
  <span class="tf" :class="{ compact }" @wheel.prevent="nudge(($event.deltaY < 0 ? 1 : -1) * ($event.shiftKey ? 5 : 1))">
    <button tabindex="-1" title="−1 мин (Shift — 5)" @click="nudge($event.shiftKey ? -5 : -1)"><Icon name="chevronLeft" :size="13" /></button>
    <input
      v-if="!live || editing"
      v-model="text"
      maxlength="5"
      @focus="editing = true"
      @blur="commit"
      @keydown="onKey"
    />
    <span v-else class="live" title="Следует за текущим временем" @click="editing = true">сейчас</span>
    <button tabindex="-1" title="+1 мин (Shift — 5)" @click="nudge($event.shiftKey ? 5 : 1)"><Icon name="chevronRight" :size="13" /></button>
  </span>
</template>

<style scoped>
.tf {
  display: inline-flex;
  align-items: center;
  background: var(--field-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.15s;
}
.tf:focus-within {
  border-color: var(--accent);
}
button {
  display: inline-flex;
  align-items: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 4px 7px;
  color: var(--muted);
  line-height: 1;
}
button:hover {
  color: var(--text);
  background: var(--hover);
}
input,
.live {
  width: 46px;
  border: 0;
  background: transparent;
  padding: 4px 0;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.live {
  color: #86efac;
  cursor: text;
  font-weight: 500;
  font-size: 12px;
}
.compact input,
.compact .live {
  width: 42px;
  font-size: 12px;
  padding: 2px 0;
}
.compact button {
  padding: 2px 5px;
}
</style>
