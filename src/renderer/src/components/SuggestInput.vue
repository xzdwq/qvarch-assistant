<script setup lang="ts">
import { computed, ref } from 'vue'
import { placeFloat, useAnchor } from '../lib/floating'

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
const style = ref<Record<string, string>>({ position: 'fixed', left: '-10000px', top: '0px' })
useAnchor(open, el, () => {
  if (!el.value) return
  const f = placeFloat(el.value, Math.max(180, el.value.offsetWidth + 40), true, 0)
  style.value = { ...f.style, maxHeight: `${Math.min(280, f.maxH)}px` }
})
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
function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    open.value = true
    const n = shown.value.length
    if (n) idx.value = (idx.value + (e.key === 'ArrowDown' ? 1 : n - 1) + (idx.value < 0 && e.key === 'ArrowUp' ? 1 : 0)) % n
  } else if (e.key === 'Enter') {
    e.preventDefault()
    take(open.value && idx.value >= 0 ? (shown.value[idx.value] ?? props.modelValue) : props.modelValue)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    done = true
    open.value = false
    emit('cancel')
    el.value?.blur()
  }
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
  <Teleport to="body">
    <div v-if="open && shown.length" class="sg-pop" :style="style" @mousedown.prevent>
      <button v-for="(o, i) in shown" :key="o" :class="{ cur: i === idx }" @mousemove="idx = i" @click="take(o)">{{ o }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
.sg-pop {
  display: flex;
  flex-direction: column;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.sg-pop button {
  flex: none;
  height: 26px;
  padding: 0 8px;
  overflow: hidden;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sg-pop button.cur {
  background: var(--hover);
}
</style>
