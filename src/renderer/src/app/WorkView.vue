<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PublicSettings } from '@shared/types'
import TaskList from './TaskList.vue'
import WorkBoard from './WorkBoard.vue'
import WorkList from './WorkList.vue'

/** Моя работа: the week and the day in one place (Работа), everything as a filtered list (Список), Jira. */
defineProps<{ settings: PublicSettings }>()
const emit = defineEmits<{ go: [view: 'day', day?: string, entryId?: string]; settings: []; openDay: [day: string] }>()
type Tab = 'work' | 'list' | 'jira'
const KEY = 'qa.work.tab'
const read = (): Tab => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'list' || v === 'jira' ? v : 'work'
  } catch {
    return 'work'
  }
}
const tab = ref<Tab>(read())
watch(tab, (v) => {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // fine
  }
})
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'work', label: 'Работа' },
  { id: 'list', label: 'Список' },
  { id: 'jira', label: 'Jira' },
]
/** A row / a day opened from here goes to the timeline (with the block in focus). */
const open = (day: string, entryId?: string) => emit('go', 'day', day, entryId)
</script>

<template>
  <div class="work">
    <div class="wtabs">
      <button v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
    </div>
    <WorkBoard v-if="tab === 'work'" class="wbody" :settings="settings" @open-day="open" />
    <WorkList v-else-if="tab === 'list'" class="wbody" @open-day="open" />
    <TaskList v-else class="wbody" @settings="emit('settings')" @open-day="(d) => emit('openDay', d)" />
  </div>
</template>

<style scoped>
.work {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.wtabs {
  flex: none;
  display: flex;
  gap: 0;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}
.wtabs button {
  position: relative;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.wtabs button:hover {
  color: var(--text);
  background: transparent;
}
.wtabs button.on {
  color: var(--accent-fg);
}
.wtabs button.on::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 2px;
  background: var(--accent);
}
.wbody {
  flex: 1;
  min-height: 0;
}
</style>
