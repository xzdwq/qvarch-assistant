<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { pickableTasks, type TaskRef } from '@shared/jira'
import { useJira } from '../lib/jira'
import { useLocalTasks } from '../lib/tasks'
import { placeFloat, useAnchor } from '../lib/floating'
import Icon from './Icon.vue'

/**
 * Find a task — own (Q-n, not done) and my Jira ones — or make a new own task from the search text. The trigger is
 * the slot; the list floats over everything (teleported). `marked` — keys shown as already taken.
 */
const props = defineProps<{ marked?: string[]; placeholder?: string; width?: number }>()
const emit = defineEmits<{ pick: [task: TaskRef] }>()

const jira = useJira()
const own = useLocalTasks()
const open = ref(false)
const q = ref('')
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const style = ref<Record<string, string>>({})
const maxH = ref(320)
useAnchor(open, root, () => {
  if (!root.value) return
  const f = placeFloat(root.value, props.width ?? 420, true, 70)
  style.value = f.style
  maxH.value = f.maxH
})

type Item = { key: string; summary: string; own: boolean; note?: string }
const items = computed<Item[]>(() => {
  const s = q.value.trim().toLowerCase()
  const hit = (i: Item) => !s || i.key.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s)
  const mine = own.value
    .filter((t) => t.key && t.status !== 'done')
    .sort((a, b) => b.created - a.created)
    .map((t) => ({ key: t.key!, summary: t.title, own: true, note: t.due ? `до ${t.due.slice(8, 10)}.${t.due.slice(5, 7)}` : undefined }))
  const jiraItems = pickableTasks(jira.value).map((i) => ({ key: i.key, summary: i.summary, own: false, note: i.due ? `до ${i.due.slice(8, 10)}.${i.due.slice(5, 7)}` : undefined }))
  return [...mine, ...jiraItems].filter(hit).slice(0, 100)
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
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    open.value = false
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const first = items.value.find((i) => !marked(i.key))
    if (first) pick(first)
    else void create()
  }
}
function onDown(e: PointerEvent): void {
  const t = e.target as Node
  if (open.value && !root.value?.contains(t) && !(document.querySelector('.ts-pop')?.contains(t) ?? false)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', onDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDown, true))
</script>

<template>
  <span ref="root" class="ts" @click="toggle"><slot /></span>
  <Teleport to="body">
    <div v-if="open" class="ts-pop" :style="style" @pointerdown.stop>
      <div class="sbox">
        <Icon name="search" :size="13" />
        <input ref="input" v-model="q" :placeholder="placeholder ?? 'Найти задачу Jira или свою · Enter — выбрать'" spellcheck="false" @keydown="onKey" />
      </div>
      <div class="items" :style="{ maxHeight: `${maxH}px` }">
        <button v-if="q.trim()" class="it create" @click="create"><Icon name="plus" :size="12" />Создать свою задачу «{{ q.trim() }}»</button>
        <button v-for="i in items" :key="i.key" class="it" :class="{ taken: marked(i.key) }" :disabled="marked(i.key)" @click="pick(i)">
          <Icon :name="i.own ? 'checkSquare' : 'jira'" :size="12" class="src" :class="{ own: i.own }" />
          <b>{{ i.key }}</b>
          <span class="sum">{{ i.summary }}</span>
          <span v-if="marked(i.key)" class="note">уже в дне</span>
          <span v-else-if="i.note" class="note">{{ i.note }}</span>
        </button>
        <p v-if="!items.length && !q.trim()" class="empty">Нет задач — подключите Jira или создайте свою: введите название</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ts {
  display: inline-flex;
}
.ts-pop {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--panel);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.sbox {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--muted);
}
.sbox input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
}
.items {
  overflow-y: auto;
  padding: 4px;
}
.it {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
}
.it:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}
.it b {
  flex: none;
  font-family: var(--font-data);
  font-size: 12px;
}
.sum {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
}
.note {
  flex: none;
  color: var(--muted);
  font-size: 11px;
}
.src {
  flex: none;
  color: var(--info);
}
.src.own {
  color: var(--up);
}
.it.taken {
  opacity: 0.5;
}
.it.create {
  color: #fdba74;
}
.empty {
  margin: 10px;
  color: var(--muted);
  font-size: 12px;
}
</style>
