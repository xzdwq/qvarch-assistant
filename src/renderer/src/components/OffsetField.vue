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
/** The typed value one step further (up — more, down — less; an unsigned one never goes below a step). */
function stepTyped(e: KeyboardEvent, dir: 1 | -1): void {
  e.preventDefault()
  const cur = parseOffset(text.value) ?? props.modelValue
  const v = props.unsigned && dir < 0 && Math.abs(cur) <= props.step ? props.step : stepOffset(Math.abs(cur) * (props.unsigned ? 1 : Math.sign(cur) || 1), dir, props.step, props.max)
  text.value = formatOffset(v).replace('+', '')
  set(v)
}
/** The keys of the editing field: Enter applies, Esc drops, the arrows step. */
const KEY_ACTIONS: Partial<Record<string, (e: KeyboardEvent) => void>> = {
  Enter: (e) => {
    e.preventDefault()
    finish(true)
  },
  Escape: () => finish(false),
  ArrowUp: (e) => stepTyped(e, 1),
  ArrowDown: (e) => stepTyped(e, -1),
}
function onKey(e: KeyboardEvent): void {
  e.stopPropagation()
  KEY_ACTIONS[e.key]?.(e)
}
</script>

<template>
  <span
    class="off tw:inline-flex tw:items-center tw:gap-5 tw:h-26 tw:min-w-64 tw:justify-center tw:box-border tw:py-0 tw:px-9 tw:rounded-r2 tw:border tw:border-accent/45 tw:bg-accent/12 tw:text-text tw:text-[12px] tw:cursor-ns-resize tw:select-none tw:[transition:border-color_0.15s,background_0.15s] tw:hover:not-[&.back]:border-accent/85 tw:[&.back]:border-info/45 tw:[&.back]:bg-info/10 tw:[&.back]:hover:border-info/85 tw:[&.compact]:h-30 tw:[&.compact]:min-w-64 tw:[&.editing]:cursor-text"
    :class="{ back, compact, editing }"
    :title="unsigned ? 'Длительность' : back ? 'Назад' : 'Вперёд'"
    @wheel.prevent.stop="onWheel"
    @click="!editing && startEdit()"
  >
    <input v-if="editing" ref="input" v-model="text" class="in tw:w-80 tw:p-0 tw:border-0 tw:bg-transparent tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:[line-height:inherit] tw:[&&]:font-bold tw:tabular-nums tw:[&&]:font-data tw:outline-none tw:[&.bad]:text-down-fg" :class="{ bad }" spellcheck="false" @keydown="onKey" @blur="finish(true)" @input="bad = false" />
    <template v-else>
      <b class="v tw:font-bold tw:tabular-nums tw:font-data">{{ shown }}</b>
    </template>
  </span>
</template>

<style scoped src="./OffsetField.css"></style>
