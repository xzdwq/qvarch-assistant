<script setup lang="ts">
import { computed, ref } from 'vue'
import Popover from './Popover.vue'

/**
 * A field with suggestions under it (instead of a native <datalist>, whose list stays where it opened when the page
 * scrolls): the list is over everything, kept by the field, closed when the field scrolls out of sight. Typing
 * narrows it; ↑ ↓ Enter, a click — take one; Enter / leaving the field — `commit`; Esc — `cancel`.
 */
// (two roots — the field and its list: the class / style given go to the field)
defineOptions({ inheritAttrs: false })
const props = defineProps<{ modelValue: string; options: string[]; placeholder?: string; title?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string]; commit: [v: string]; cancel: [] }>()
const el = ref<HTMLInputElement>()
const open = ref(false)
const idx = ref(-1)
/** The list: a little wider than the field, up to 280px tall; the field owns the keys (Esc too). */
const listWidth = (field: HTMLElement) => Math.max(180, field.offsetWidth + 40)
const listHeight = (room: number) => Math.min(280, room)
const listOpen = computed({ get: () => open.value && shown.value.length > 0, set: (v) => void (v || (open.value = false)) })
const shown = computed(() => {
  const q = props.modelValue.trim().toLowerCase()
  const all = props.options.filter((o) => o.toLowerCase().includes(q))
  // (the value typed in full is still offered with the others — the list does not go away under the cursor)
  return (all.length === 1 && all[0].toLowerCase() === q ? props.options : all).slice(0, 60)
})
let done = false
function take(v: string): void {
  done = true
  open.value = false
  emit('update:modelValue', v)
  emit('commit', v)
  el.value?.blur()
}
/** The list opened and the pick moved by `step` (from nothing picked: ↓ — the first, ↑ — the last). */
function movePick(step: 1 | -1): void {
  open.value = true
  const n = shown.value.length
  if (n) idx.value = idx.value < 0 ? (step > 0 ? 0 : n - 1) : (idx.value + step + n) % n
}
/** What the field's keys do (each one handled stops its default). */
const KEY_ACTIONS = new Map<string, () => void>([
  ['ArrowDown', () => movePick(1)],
  ['ArrowUp', () => movePick(-1)],
  ['Enter', () => take(open.value && idx.value >= 0 ? (shown.value[idx.value] ?? props.modelValue) : props.modelValue)],
  [
    'Escape',
    () => {
      done = true
      open.value = false
      emit('cancel')
      el.value?.blur()
    },
  ],
])
function onKey(e: KeyboardEvent): void {
  const action = KEY_ACTIONS.get(e.key)
  if (!action) return
  e.preventDefault()
  action()
}
function onBlur(): void {
  open.value = false
  if (!done) emit('commit', props.modelValue)
  done = false
}
</script>

<template>
  <input
    v-bind="$attrs"
    ref="el"
    :value="modelValue"
    :placeholder="placeholder"
    :title="title"
    spellcheck="false"
    autocomplete="off"    @focus="((open = true), (idx = -1))"
    @input="(emit('update:modelValue', ($event.target as HTMLInputElement).value), (open = true), (idx = -1))"
    @keydown="onKey"
    @blur="onBlur"
  />
  <Popover v-model:open="listOpen" :anchor="el" :width="listWidth" align-left :chrome="0" :max-height="listHeight" :esc="false" class="sg-pop tw:flex tw:flex-col tw:p-4 tw:overflow-y-auto tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" @mousedown.prevent>
      <button class="tw:flex-none tw:h-26 tw:py-0 tw:px-8 tw:overflow-hidden tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:font-data tw:text-[12px] tw:text-left tw:text-ellipsis tw:whitespace-nowrap tw:[&.cur]:bg-hover" v-for="(o, i) in shown" :key="o" :class="{ cur: i === idx }" @mousemove="idx = i" @click="take(o)">{{ o }}</button>
  </Popover>
</template>
