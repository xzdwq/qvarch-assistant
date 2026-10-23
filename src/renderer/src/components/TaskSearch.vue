<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { TaskRef } from '@shared/jira'
import { useJiraFind } from '../lib/jiraFind'
import { useLocalTasks } from '../lib/tasks'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

/**
 * Find a task — own (Q-n, not done) and my Jira ones — or make a new own task from the search text. The trigger is
 * the slot; the list floats over everything (teleported). `marked` — keys shown as already taken.
 */
const props = defineProps<{ marked?: string[]; placeholder?: string; width?: number }>()
const emit = defineEmits<{ pick: [task: TaskRef] }>()

const own = useLocalTasks()
const open = ref(false)
const q = ref('')
const { items: found, onScroll: onFindScroll } = useJiraFind(q, { page: 40, active: open, mode: 'pick' })
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()

type Item = { key: string; summary: string; own: boolean; note?: string }
const items = computed<Item[]>(() => {
  const s = q.value.trim().toLowerCase()
  const hit = (i: Item) => !s || i.key.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s)
  const mine = own.value
    .filter((t) => t.key && t.status !== 'done')
    .sort((a, b) => b.created - a.created)
    .map((t) => ({ key: t.key!, summary: t.title, own: true, note: t.due ? `до ${t.due.slice(8, 10)}.${t.due.slice(5, 7)}` : undefined }))
  // Jira: asked page by page from the main process (the search goes there too)
  const jiraItems = found.value.map((i) => ({ key: i.key, summary: i.summary, own: false, note: i.due ? `до ${i.due.slice(8, 10)}.${i.due.slice(5, 7)}` : undefined }))
  return [...mine.filter(hit), ...jiraItems]
})
const marked = (key: string) => props.marked?.includes(key) ?? false

async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  q.value = ''
  await nextTick()
  input.value?.focus({ preventScroll: true })
}
function pick(i: Item): void {
  open.value = false
  emit('pick', { key: i.key, summary: i.summary })
}
/** A new own task from the search text. */
async function create(): Promise<void> {
  const title = q.value.trim()
  if (!title) return
  const t = await window.qa.saveTask({ id: crypto.randomUUID(), title, status: 'todo', created: Date.now() })
  open.value = false
  if (t.key) emit('pick', { key: t.key, summary: t.title })
}
/** Enter — the first task not taken yet, or a new own one from the text (Esc — the popover's). */
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Enter') return
  e.preventDefault()
  const first = items.value.find((i) => !marked(i.key))
  if (first) pick(first)
  else void create()
}
</script>

<template>
  <span ref="root" class="ts tw:inline-flex" @click="toggle"><slot /></span>
  <Popover v-slot="{ room }" v-model:open="open" :anchor="root" :width="width ?? 420" align-left :chrome="70" max-height="none" class="ts-pop tw:flex tw:flex-col tw:border tw:border-border tw:rounded-[4px] tw:bg-panel tw:[box-shadow:0_16px_40px_rgba(0,0,0,0.5)] tw:overflow-hidden" @pointerdown.stop>
      <div class="sbox tw:flex tw:items-center tw:gap-8 tw:py-8 tw:px-10 tw:border-b tw:border-b-border tw:text-muted">
        <Icon name="search" :size="13" />
        <input class="tw:flex-1 tw:min-w-0 tw:border-0 tw:outline-none tw:bg-transparent tw:text-text tw:text-[13px]" ref="input" v-model="q" :placeholder="placeholder ?? 'Найти задачу Jira или свою · Enter — выбрать'" spellcheck="false" @keydown="onKey" />
      </div>
      <div class="items tw:overflow-y-auto tw:p-4" :style="{ maxHeight: `${room}px` }" @scroll.passive="onFindScroll">
        <button v-if="q.trim()" class="it create tw:flex tw:items-center tw:gap-8 tw:w-full tw:py-6 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-white/6 tw:text-(--task-create) tw:hover:enabled:border-border-3" @click="create"><Icon name="plus" :size="12" />Создать свою задачу «{{ q.trim() }}»</button>
        <button v-for="i in items" :key="i.key" class="it tw:flex tw:items-center tw:gap-8 tw:w-full tw:py-6 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-white/6 tw:[&.taken]:opacity-50 tw:hover:enabled:border-border-3" :class="{ taken: marked(i.key) }" :disabled="marked(i.key)" @click="pick(i)">
          <Icon :name="i.own ? 'checkSquare' : 'jira'" :size="12" class="src tw:[&&]:flex-none tw:text-info tw:[&.own]:text-up" :class="{ own: i.own }" />
          <b class="tw:flex-none tw:font-data tw:text-[12px]">{{ i.key }}</b>
          <span class="sum tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-text-2">{{ i.summary }}</span>
          <span v-if="marked(i.key)" class="note tw:flex-none tw:text-muted tw:text-[11px]">уже в дне</span>
          <span v-else-if="i.note" class="note tw:flex-none tw:text-muted tw:text-[11px]">{{ i.note }}</span>
        </button>
        <p v-if="!items.length && !q.trim()" class="empty tw:m-10 tw:text-muted tw:text-[12px]">Нет задач — подключите Jira или создайте свою: введите название</p>
      </div>
  </Popover>
</template>
