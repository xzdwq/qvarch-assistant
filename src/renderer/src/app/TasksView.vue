<script setup lang="ts">
import { ref, watch } from 'vue'
import type { LinkStyle } from '@shared/linkpath'
import TaskCalendar from '../components/TaskCalendar.vue'
import TaskList from './TaskList.vue'

/** "Задачи": a calendar of the work (like Outlook: day / week / month) and the list (own tasks + Jira). */
defineProps<{ linkStyle: LinkStyle; workDays: number[] }>()
const emit = defineEmits<{ settings: []; openDay: [day: string] }>()

const tab = ref<'board' | 'list'>(read())
function read(): 'board' | 'list' {
  try {
    return localStorage.getItem('qa.tasksTab') === 'list' ? 'list' : 'board'
  } catch {
    return 'board'
  }
}
watch(tab, (v) => {
  try {
    localStorage.setItem('qa.tasksTab', v)
  } catch {
    // not remembered — fine
  }
})
</script>

<template>
  <div class="tv">
    <nav class="tabs">
      <button :class="{ on: tab === 'board' }" @click="tab = 'board'">Календарь</button>
      <button :class="{ on: tab === 'list' }" @click="tab = 'list'">Список · Jira</button>
    </nav>
    <TaskCalendar v-if="tab === 'board'" :link-style="linkStyle" :work-days="workDays" @open-day="(d) => emit('openDay', d)" />
    <TaskList v-else class="list" @settings="emit('settings')" @open-day="(d) => emit('openDay', d)" />
  </div>
</template>

<style scoped>
.tv {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px 24px;
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}
.tabs button {
  padding: 6px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  margin-bottom: -1px;
  background: transparent;
  color: var(--muted);
}
.tabs button.on {
  border-bottom-color: var(--accent);
  color: var(--text);
}
.list :deep(.tasks),
.list {
  padding: 0;
}
</style>
