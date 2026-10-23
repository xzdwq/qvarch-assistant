<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue'
import type { VaultNode } from '@shared/vault'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

/**
 * «В блокнот ▾»: where something goes — a new note, or any note there is (the recent first; a search over names and
 * folders; ↑ ↓ Enter). Over everything, kept by its button.
 */
const props = withDefaults(defineProps<{ label?: string; title?: string; newLabel?: string; disabled?: boolean }>(), { label: 'В блокнот', newLabel: 'Новая заметка' })
// two roots (the button, its list): the classes it is given (`primary`, `sm`) go onto the button
defineOptions({ inheritAttrs: false })
const emit = defineEmits<{ pick: [path: string | null] }>()
const open = ref(false)
const btn = ref<HTMLElement>()
/** At least 220px tall (the search and a few notes), more when there is room. */
const fitHeight = (room: number) => Math.max(220, room)
const q = ref('')
const input = ref<HTMLInputElement>()
const notes = shallowRef<Array<{ path: string; name: string; dir: string; mtime: number }>>([])
const idx = ref(0)
async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  q.value = ''
  idx.value = 0
  const out: typeof notes.value = []
  const walk = (ns: VaultNode[]) => {
    for (const n of ns) {
      if (n.dir) {
        if (!n.name.startsWith('.')) walk(n.children ?? [])
      } else if (/\.md$/i.test(n.path)) out.push({ path: n.path, name: n.name.replace(/\.md$/i, ''), dir: n.path.split('/').slice(0, -1).join(' / '), mtime: n.mtime })
    }
  }
  walk(await window.qa.vaultTree())
  notes.value = out.sort((a, b) => b.mtime - a.mtime)
  await nextTick()
  input.value?.focus()
}
const shown = computed(() => {
  const w = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return notes.value.filter((n) => w.every((x) => `${n.name} ${n.dir}`.toLowerCase().includes(x))).slice(0, 80)
})
/** The rows: «new» first, then the notes found. */
const total = computed(() => shown.value.length + 1)
function choose(i: number): void {
  open.value = false
  emit('pick', i === 0 ? null : shown.value[i - 1].path)
}
/** The list's keys: ↑ ↓ move round it, Enter picks. */
const LIST_KEYS: Record<string, () => void> = {
  ArrowDown: () => (idx.value = (idx.value + 1) % total.value),
  ArrowUp: () => (idx.value = (idx.value - 1 + total.value) % total.value),
  Enter: () => choose(idx.value),
}
function onKey(e: KeyboardEvent): void {
  if (!Object.hasOwn(LIST_KEYS, e.key)) return
  LIST_KEYS[e.key]()
  e.preventDefault()
}
</script>

<template>
  <button ref="btn" v-bind="$attrs" class="np tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-28 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-10 tw:whitespace-nowrap" :class="{ on: open }" :disabled="disabled" :title="title" @mousedown.prevent @click="toggle"><Icon name="note" :size="12" />{{ props.label }}<Icon name="chevronDown" :size="10" /></button>
  <Popover v-model:open="open" :anchor="btn" :width="340" :chrome="0" :max-height="fitHeight" class="np-pop tw:flex tw:flex-col tw:overflow-hidden tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]" @keydown="onKey">
      <input class="tw:h-28 tw:m-6 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font:inherit]" ref="input" v-model="q" placeholder="Найти заметку…" spellcheck="false" @input="idx = 0" />
      <div class="np-list tw:flex tw:min-h-0 tw:flex-col tw:pt-0 tw:pr-4 tw:pb-4 tw:pl-4 tw:overflow-y-auto">
        <button class="new tw:flex tw:flex-none tw:items-center tw:gap-8 tw:h-28 tw:py-0 tw:px-8 tw:overflow-hidden tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:whitespace-nowrap tw:[&.cur]:bg-hover tw:text-accent-fg" :class="{ cur: idx === 0 }" @mousemove="idx = 0" @click="choose(0)"><Icon name="plus" :size="13" />{{ props.newLabel }}</button>
        <button class="tw:flex tw:flex-none tw:items-center tw:gap-8 tw:h-28 tw:py-0 tw:px-8 tw:overflow-hidden tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-left tw:whitespace-nowrap tw:[&.cur]:bg-hover" v-for="(n, i) in shown" :key="n.path" :class="{ cur: idx === i + 1 }" :title="n.path" @mousemove="idx = i + 1" @click="choose(i + 1)">
          <Icon name="note" :size="12" /><span class="nm tw:flex-none tw:max-w-[60%] tw:overflow-hidden tw:text-ellipsis">{{ n.name }}</span><span v-if="n.dir" class="dir tw:overflow-hidden tw:text-muted tw:text-[11.5px] tw:text-ellipsis">{{ n.dir }}</span>
        </button>
        <p v-if="!shown.length && q" class="muted tw:my-6 tw:mx-8 tw:text-muted">Не найдено</p>
      </div>
  </Popover>
</template>
