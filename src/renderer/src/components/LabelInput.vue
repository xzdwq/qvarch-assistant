<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EntryKind } from '@shared/types'
import { placeFloat } from '../lib/floating'
import { usePopover, type Placement } from '../lib/usePopover'

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
const placeList: Placement = ({ el, rect: r }) => {
  const f = placeFloat(el!, r.width, true, 0)
  const up: Record<string, string> = props.dropUp ? { bottom: `${window.innerHeight - r.top + 4}px`, top: 'auto' } : {}
  const maxH = props.dropUp ? Math.min(180, Math.max(60, r.top - 12)) : Math.min(220, f.maxH)
  return { style: { ...f.style, ...up, maxHeight: `${maxH}px` } }
}
// (the field scrolled out of sight — closed; the field owns the keys, Esc too)
const shown = computed({ get: () => open.value && suggestions.value.length > 0, set: (v) => void (v || (open.value = false)) })
const { panelRef, style } = usePopover(root, { place: placeList, esc: false }, shown)

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

/** What the field's keys do: ↑ ↓ move through the suggestions, Enter takes one (or submits), Esc closes them. */
const KEY_ACTIONS = new Map<string, (e: KeyboardEvent) => void>([
  [
    'ArrowDown',
    (e) => {
      const n = suggestions.value.length
      if (!n) return
      e.preventDefault()
      open.value = true
      active.value = (active.value + 1) % n
    },
  ],
  [
    'ArrowUp',
    (e) => {
      const n = suggestions.value.length
      if (!n) return
      e.preventDefault()
      active.value = (active.value - 1 + n) % n
    },
  ],
  [
    'Enter',
    (e) => {
      // multiline: Shift+Enter is a new line (the first line is the title, the rest — the description)
      if (props.multiline && e.shiftKey) return
      e.preventDefault()
      const s = open.value && active.value >= 0 ? suggestions.value[active.value] : undefined
      if (s) return pick(s)
      open.value = false
      emit('submit')
    },
  ],
  ['Escape', () => (open.value = false)],
])
const onKey = (e: KeyboardEvent): void => KEY_ACTIONS.get(e.key)?.(e)
</script>

<template>
  <div ref="root" class="label-input tw:relative tw:flex-1 tw:min-w-0">
    <div class="field tw:flex tw:items-center tw:gap-6 tw:bg-field tw:border tw:border-border tw:rounded-[4px] tw:py-0 tw:px-8 tw:focus-within:border-accent">
      <textarea
        v-if="multiline"
        ref="input"
        v-model="label"
        class="ml tw:flex-1 tw:min-w-0 tw:resize-none tw:overflow-y-hidden tw:py-8 tw:px-0 tw:bg-transparent tw:border-0 tw:outline-none tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[font-size:inherit] tw:font-[inherit] tw:[&&]:leading-[1.4] tw:[&.scroll]:overflow-y-auto tw:first-line:font-semibold"
        :class="{ scroll: rows >= 4 }"
        :rows="rows"
        :placeholder="placeholder ?? 'Что делал?'"
        :autofocus="autofocus"
        spellcheck="false"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKey"
      ></textarea>
      <input class="tw:flex-1 tw:min-w-0 tw:bg-transparent tw:border-0 tw:outline-none tw:text-text tw:[font:inherit] tw:py-7 tw:px-0"
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
      <ul v-if="shown" :ref="panelRef" class="li-pop tw:box-border tw:m-0 tw:p-4 tw:[list-style:none] tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:overflow-auto tw:[box-shadow:0_10px_30px_rgba(0,0,0,0.4)] tw:animate-[LabelInput-drop-in_0.14s_ease-out]" :style="style">
        <li class="tw:flex tw:gap-8 tw:items-baseline tw:py-5 tw:px-8 tw:rounded-r2 tw:cursor-pointer tw:text-[13px] tw:[&.active]:bg-hover"
          v-for="(s, i) in suggestions"
          :key="`${s.kind}-${s.label}`"
          :class="{ active: i === active }"
          @mousedown.prevent="pick(s)"
          @mouseenter="active = i"
        >
          <span class="text tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ s.label }}</span>
          <span class="hint tw:flex-none tw:text-muted tw:text-[11px]">недавнее</span>
        </li>
      </ul>
    </Teleport>
  </div>
</template>
