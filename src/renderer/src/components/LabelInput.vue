<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EntryKind } from '@shared/types'
import { placeFloat, useAnchor } from '../lib/floating'

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

/** The suggestions: over everything (teleported), as wide as the field, kept by it; `dropUp` — always over it. */
const root = ref<HTMLElement>()
// (the field scrolled out of sight — closed)
const shown = computed({ get: () => open.value && suggestions.value.length > 0, set: (v) => void (v || (open.value = false)) })
const style = ref<Record<string, string>>({ position: 'fixed', left: '-10000px', top: '0px' })
useAnchor(shown, root, () => {
  if (!root.value) return
  const r = root.value.getBoundingClientRect()
  const f = placeFloat(root.value, r.width, true, 0)
  const up: Record<string, string> = props.dropUp ? { bottom: `${window.innerHeight - r.top + 4}px`, top: 'auto' } : {}
  const maxH = props.dropUp ? Math.min(180, Math.max(60, r.top - 12)) : Math.min(220, f.maxH)
  style.value = { ...f.style, ...up, maxHeight: `${maxH}px` }
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
  <div ref="root" class="label-input">
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
    <Teleport to="body">
      <ul v-if="shown" class="li-pop" :style="style">
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
    </Teleport>
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
  border-radius: 4px;
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
/* the suggestions — teleported to <body> (placed by placeFloat; a click outside blurs the field and closes them) */
.li-pop {
  box-sizing: border-box;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: auto;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  animation: drop-in 0.14s ease-out;
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
  border-radius: var(--r2);
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
