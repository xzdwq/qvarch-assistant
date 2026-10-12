<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EntryKind } from '@shared/types'

export interface Recent {
  label: string
  kind: EntryKind
}

/** Description field with suggestions from recently used labels (and their kinds). */
const props = defineProps<{ recent: Recent[]; placeholder?: string; autofocus?: boolean; dropUp?: boolean; noRecent?: boolean; multiline?: boolean }>()
const label = defineModel<string>({ required: true })
const emit = defineEmits<{ submit: []; pick: [s: Recent]; focus: []; blur: [] }>()

const open = ref(false)
const active = ref(-1)
const input = ref<HTMLInputElement | HTMLTextAreaElement>()
/** Multiline: grows with its text (up to 4 lines). */
const rows = computed(() => Math.min(4, Math.max(1, label.value.split('\n').length)))

defineExpose({ focus: () => input.value?.focus() })

const suggestions = computed<Recent[]>(() => {
  if (props.noRecent) return []
  const q = label.value.trim().toLowerCase()
  return props.recent.filter((r) => r.label && (!q || r.label.toLowerCase().includes(q)) && r.label !== label.value).slice(0, 6)
})

function onFocus(): void {
  open.value = true
  active.value = -1
  emit('focus')
}

function onBlur(): void {
  // let a click on a suggestion land first
  setTimeout(() => (open.value = false), 150)
  emit('blur')
}

function pick(s: Recent): void {
  label.value = s.label
  open.value = false
  emit('pick', s)
}

function onKey(e: KeyboardEvent): void {
  const n = suggestions.value.length
  if (e.key === 'ArrowDown' && n) {
    e.preventDefault()
    open.value = true
    active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault()
    active.value = (active.value - 1 + n) % n
  } else if (e.key === 'Enter') {
    // multiline: Shift+Enter is a new line (the first line is the title, the rest — the description)
    if (props.multiline && e.shiftKey) return
    e.preventDefault()
    if (open.value && active.value >= 0 && suggestions.value[active.value]) pick(suggestions.value[active.value])
    else {
      open.value = false
      emit('submit')
    }
  } else if (e.key === 'Escape') {
    open.value = false
  }
}
</script>

<template>
  <div class="label-input">
    <div class="field">
      <textarea
        v-if="multiline"
        ref="input"
        v-model="label"
        class="ml"
        :class="{ scroll: rows >= 4 }"
        :rows="rows"
        :placeholder="placeholder ?? 'Что делал?'"
        :autofocus="autofocus"
        spellcheck="false"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKey"
      ></textarea>
      <input
        v-else
        ref="input"
        v-model="label"
        :placeholder="placeholder ?? 'Что делал?'"
        :autofocus="autofocus"
        spellcheck="false"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKey"
      />
    </div>
    <ul v-if="open && suggestions.length" class="dropdown" :class="{ up: dropUp }">
      <li
        v-for="(s, i) in suggestions"
        :key="`${s.kind}-${s.label}`"
        :class="{ active: i === active }"
        @mousedown.prevent="pick(s)"
        @mouseenter="active = i"
      >
        <span class="text">{{ s.label }}</span>
        <span class="hint">недавнее</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
textarea.ml {
  flex: 1;
  min-width: 0;
  resize: none;
  /* a scrollbar only once the text outgrows the 4 lines */
  overflow-y: hidden;
  padding: 8px 0;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text);
  font: inherit;
  line-height: 1.4;
}
textarea.ml.scroll {
  overflow-y: auto;
}
textarea.ml::first-line {
  font-weight: 600;
}
.label-input {
  position: relative;
  flex: 1;
  min-width: 0;
}
.field {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--field-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 8px;
}
.field:focus-within {
  border-color: var(--accent);
}
input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text);
  font: inherit;
  padding: 7px 0;
}
.dropdown {
  position: absolute;
  z-index: 50;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  max-height: 220px;
  overflow: auto;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  animation: drop-in 0.14s ease-out;
}
.dropdown.up {
  top: auto;
  bottom: calc(100% + 4px);
  max-height: 180px;
}
@keyframes drop-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
li.active {
  background: var(--hover);
}
.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hint {
  flex: none;
  color: var(--muted);
  font-size: 11px;
}
</style>
