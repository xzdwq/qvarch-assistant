<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { pickableTasks, tasksWord, type TaskRef } from '@shared/jira'
import { useJira } from '../lib/jira'
import { placeFloat, useAnchor, type Float } from '../lib/floating'
import { OWN_PREFIX } from '@shared/board'
import Icon from './Icon.vue'

/**
 * Pick the task(s) a block of time belongs to: own tasks (Q-n) + my open Jira tasks + the ones picked by hand.
 * Taking an existing task again (another day) keeps it one task — its time adds up; a new own task can be
 * made right here from the search text.
 * Several tasks (checkboxes) → one parallel block per task for the same time; `single` → just one.
 * The list fits into the space the host leaves (the island clips — and clicks outside it go through).
 */
const props = defineProps<{ single?: boolean; compact?: boolean }>()
const tasks = defineModel<TaskRef[]>({ default: () => [] })

const jira = useJira()
const open = ref(false)
const q = ref('')
const root = ref<HTMLElement>()
const search = ref<HTMLInputElement>()
/** Where the list opens and how tall it may be (measured on open). */
const place = ref<{ up: boolean; maxH: number }>({ up: true, maxH: 240 })

type Item = { key: string; summary: string; due?: string; own: boolean }
/** Jira tasks only (own tasks are gone: a note becomes a "Задача" block, not a task of its own). */
const list = computed<Item[]>(() => {
  const s = q.value.trim().toLowerCase()
  return pickableTasks(jira.value)
    .map((i) => ({ key: i.key, summary: i.summary, due: i.due, own: false }))
    .filter((i) => !s || i.key.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s))
    .slice(0, 80)
})
const isOwn = (key?: string) => !!key?.startsWith(OWN_PREFIX)
const chosen = (key: string) => tasks.value.some((t) => t.key === key)
const label = computed(() => (!tasks.value.length ? 'Jira' : tasks.value.length === 1 ? tasks.value[0].key : `${tasks.value[0].key} +${tasks.value.length - 1}`))

/** Where the list opens: over everything in the main window, inside the shell in the island. */
const fl = ref<Float>({ teleport: false, up: true, maxH: 240, style: {} })
const dd = ref<HTMLElement>()
function measure(): void {
  if (!root.value) return
  // from the button itself: the wrapper may be stretched by its row (the mini island)
  fl.value = placeFloat((root.value.firstElementChild as HTMLElement | null) ?? root.value, 440)
  place.value = { up: fl.value.up, maxH: fl.value.maxH }
}
useAnchor(open, root, measure)
// a floating list does not follow a scrolling page — it closes instead
function onScroll(e: Event): void {
  if (open.value && fl.value.teleport && !dd.value?.contains(e.target as Node)) open.value = false
}
onMounted(() => window.addEventListener('scroll', onScroll, true))
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll, true))

async function toggle(): Promise<void> {
  open.value = !open.value
  if (open.value) {
    q.value = ''
    measure()
    await nextTick()
    search.value?.focus({ preventScroll: true })
  }
}
function pick(i: TaskRef): void {
  const t = { key: i.key, summary: i.summary }
  if (props.single) {
    tasks.value = chosen(i.key) ? [] : [t]
    open.value = false
    return
  }
  tasks.value = chosen(i.key) ? tasks.value.filter((x) => x.key !== i.key) : [...tasks.value, t]
}
function onDown(e: MouseEvent): void {
  if (open.value && !root.value?.contains(e.target as Node) && !dd.value?.contains(e.target as Node)) open.value = false
}
onMounted(() => window.addEventListener('mousedown', onDown, true))
onBeforeUnmount(() => window.removeEventListener('mousedown', onDown, true))
</script>

<template>
  <div ref="root" class="tp" :class="{ compact: props.compact }">
    <button
      class="chip"
      :class="{ on: tasks.length }"
      :title="tasks.length ? tasks.map((t) => `${t.key} — ${t.summary}`).join('\n') : 'Задача'"
      @click="toggle"
    >
      <Icon :name="isOwn(tasks[0]?.key) ? 'checkSquare' : 'jira'" :size="13" />
      <span class="lbl">{{ label }}</span>
      <span v-if="tasks.length" class="x" title="Отвязать" @click.stop="tasks = []"><Icon name="x" :size="11" /></span>
    </button>
    <Teleport to="body" :disabled="!fl.teleport">
    <div v-if="open" ref="dd" class="dd" :class="{ up: place.up }" :style="fl.style">
      <input
        ref="search"
        v-model="q"
        :placeholder="single ? 'Найти задачу Jira' : 'Найти задачу Jira · можно отметить несколько'"
        spellcheck="false"
        @keydown.esc.stop="open = false"
        @keydown.enter.prevent="list[0] && pick(list[0])"
      />
      <div class="items" :style="{ maxHeight: `${place.maxH}px` }">
        <button v-for="i in list" :key="i.key" class="it" :class="{ cur: chosen(i.key) }" @click="pick(i)">
          <span v-if="!single" class="cb" :class="{ on: chosen(i.key) }"><Icon v-if="chosen(i.key)" name="check" :size="11" :stroke="3" /></span>
          <Icon :name="i.own ? 'checkSquare' : 'jira'" :size="11" class="src" :class="{ own: i.own }" />
          <b :class="{ own: i.own }">{{ i.key }}</b>
          <span class="sum">{{ i.summary }}</span>
          <span v-if="i.due" class="due">до {{ i.due.slice(8, 10) }}.{{ i.due.slice(5, 7) }}</span>
        </button>
        <p v-if="!list.length" class="empty">{{ q.trim() ? 'Не найдено' : 'Нет задач Jira — подключите Jira в настройках' }}</p>
      </div>
      <div v-if="!single && tasks.length > 1" class="foot">{{ tasksWord(tasks.length) }} — на это время будет столько же параллельных блоков</div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tp {
  position: relative;
  flex: none;
}
/* same look as the text field next to it */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--field-bg);
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s;
}
.chip:hover {
  border-color: var(--accent);
  color: var(--text);
}
.chip.on {
  border-color: rgba(38, 132, 255, 0.7);
  background: rgba(38, 132, 255, 0.14);
  color: #bfdbfe;
}
.lbl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.x {
  display: inline-flex;
  opacity: 0.7;
}
.x:hover {
  opacity: 1;
}
.dd {
  position: absolute;
  z-index: 60;
  top: calc(100% + 4px);
  right: 0;
  width: 440px;
  padding: 6px;
  border-radius: 10px;
  background: #1c2030;
  border: 1px solid var(--border);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.dd.up {
  top: auto;
  bottom: calc(100% + 4px);
}
.dd input {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 4px;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.25);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.items {
  overflow: auto;
}
.it {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}
.it:hover,
.it.cur {
  background: rgba(38, 132, 255, 0.16);
}
.cb {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #fff;
}
.cb.on {
  background: #2684ff;
  border-color: #2684ff;
}
.it b {
  flex: none;
  color: #93c5fd;
}
.it b.own,
.src.own,
.it.create {
  color: #c4b5fd;
}
.src {
  flex: none;
  color: #93c5fd;
}
.sum {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.due {
  flex: none;
  color: var(--muted);
  font-size: 11px;
}
.empty {
  margin: 6px 8px;
  color: var(--muted);
  font-size: 12px;
}
.foot {
  margin: 4px 6px 0;
  font-size: 11px;
  color: #93c5fd;
}
</style>
