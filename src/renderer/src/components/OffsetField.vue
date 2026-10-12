<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { formatOffset, parseOffset, stepOffset } from '@shared/offset'

/**
 * How long and which way: + forward from the moment, − back (the last N minutes).
 * The wheel turns it (step 10 min, through zero to the other side), or it is typed: "-30", "1:30", "-1ч 30м".
 */
/** unsigned — a plain length (no minus): from `step` up. */
const props = withDefaults(defineProps<{ modelValue: number; step?: number; max?: number; compact?: boolean; unsigned?: boolean }>(), { step: 10, max: 720 })
const emit = defineEmits<{ 'update:modelValue': [v: number]; commit: [] }>()

const editing = ref(false)
const text = ref('')
const input = ref<HTMLInputElement>()
const bad = ref(false)

const shown = computed(() => (props.unsigned ? formatOffset(props.modelValue).slice(1) : formatOffset(props.modelValue)))
const back = computed(() => !props.unsigned && props.modelValue < 0)

function set(v: number): void {
  const c = props.unsigned ? Math.max(Math.min(props.step, 5), Math.min(props.max, Math.abs(v))) : Math.max(-props.max, Math.min(props.max, v))
  if (c && c !== props.modelValue) emit('update:modelValue', c)
}
function onWheel(e: WheelEvent): void {
  if (!e.deltaY) return
  const dir = e.deltaY < 0 ? 1 : -1
  // a length does not go through zero: it stops at one step
  set(props.unsigned && dir < 0 && props.modelValue <= props.step ? props.step : stepOffset(props.modelValue, dir, props.step, props.max))
  emit('commit')
}
async function startEdit(): Promise<void> {
  editing.value = true
  bad.value = false
  text.value = shown.value.replace('+', '')
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
function finish(apply: boolean): void {
  if (!editing.value) return
  if (apply) {
    const v = parseOffset(text.value)
    if (v === undefined) {
      bad.value = true
      return
    }
    set(v)
    emit('commit')
  }
  editing.value = false
}
function onKey(e: KeyboardEvent): void {
  e.stopPropagation()
  if (e.key === 'Enter') {
    e.preventDefault()
    finish(true)
  } else if (e.key === 'Escape') finish(false)
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    const cur = parseOffset(text.value) ?? props.modelValue
    const dir = e.key === 'ArrowUp' ? 1 : -1
    const v = props.unsigned && dir < 0 && Math.abs(cur) <= props.step ? props.step : stepOffset(Math.abs(cur) * (props.unsigned ? 1 : Math.sign(cur) || 1), dir, props.step, props.max)
    text.value = formatOffset(v).replace('+', '')
    set(v)
  }
}
</script>

<template>
  <span
    class="off"
    :class="{ back, compact, editing }"
    :title="unsigned ? 'Длительность' : back ? 'Назад' : 'Вперёд'"
    @wheel.prevent.stop="onWheel"
    @click="!editing && startEdit()"
  >
    <input v-if="editing" ref="input" v-model="text" class="in" :class="{ bad }" spellcheck="false" @keydown="onKey" @blur="finish(true)" @input="bad = false" />
    <template v-else>
      <b class="v">{{ shown }}</b>
    </template>
  </span>
</template>

<style scoped>
.off {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  min-width: 64px;
  justify-content: center;
  box-sizing: border-box;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid rgba(124, 108, 246, 0.45);
  background: rgba(124, 108, 246, 0.12);
  color: var(--text);
  font-size: 12px;
  cursor: ns-resize;
  user-select: none;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.off:hover {
  border-color: rgba(124, 108, 246, 0.85);
}
.off.back {
  border-color: rgba(56, 189, 248, 0.45);
  background: rgba(56, 189, 248, 0.1);
}
.off.back:hover {
  border-color: rgba(56, 189, 248, 0.85);
}
.off.compact {
  height: 30px;
  min-width: 64px;
}
.off.editing {
  cursor: text;
}
.v {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.cap {
  color: var(--muted);
  font-size: 11px;
}
.in {
  width: 80px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  outline: none;
}
.in.bad {
  color: #fca5a5;
}
</style>
