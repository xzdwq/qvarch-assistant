<script lang="ts">
/** The last outside ask handled (the section comes and goes; the ask must not come back with it). */
let focusSeen = 0
</script>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PublicSettings } from '@shared/types'
import TaskList from './TaskList.vue'
import ReportsView from './ReportsView.vue'
import TaskCalendar from '../components/TaskCalendar.vue'
import WorkBoard from './WorkBoard.vue'
import WorkList from './WorkList.vue'

/**
 * Моя работа: the week and the day in one place (Работа), everything as a filtered list (Список), Jira, the
 * calendar of the weeks (Календарь) and the analytics (Аналитика).
 */
const props = defineProps<{ settings: PublicSettings; focus?: { day: string; entryId?: string; n: number } }>()
const emit = defineEmits<{ settings: [] }>()
/** The tabs of «Моя работа» in their row order (the first one is the default). */
const TABS = [
  { id: 'work', label: 'Работа' },
  { id: 'list', label: 'Список' },
  { id: 'reports', label: 'Аналитика' },
  { id: 'calendar', label: 'Календарь' },
  { id: 'jira', label: 'Jira' },
] as const
type Tab = (typeof TABS)[number]['id']
const KEY = 'qa.work.tab'
const read = (): Tab => {
  try {
    const v = localStorage.getItem(KEY)
    return TABS.find((t) => t.id === v)?.id ?? 'work'
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
/** A day (a block on it) opened from here or from outside: Работа shows it — the block picked on the timeline. */
const boardFocus = ref<{ day: string; entryId?: string; n: number }>()
let n = 0
const open = (day: string, entryId?: string) => {
  boardFocus.value = { day, entryId, n: ++n }
  tab.value = 'work'
}
// a day asked for from outside — once: coming back to the section later keeps what was chosen here
watch(
  () => props.focus?.n,
  (n) => {
    if (!props.focus || !n || n <= focusSeen) return
    focusSeen = n
    open(props.focus.day, props.focus.entryId)
  },
  { immediate: true },
)
</script>

<template>
  <div class="work tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <div class="wtabs tw:flex-none tw:flex tw:gap-0 tw:py-0 tw:px-14 tw:border-b tw:border-b-border">
      <button class="tw:relative tw:h-34 tw:py-0 tw:px-14 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:hover:not-[&.on]:text-text tw:hover:bg-transparent tw:[&.on]:text-accent-fg tw:[&.on]:after:content-[''] tw:[&.on]:after:absolute tw:[&.on]:after:left-8 tw:[&.on]:after:right-8 tw:[&.on]:after:-bottom-1 tw:[&.on]:after:h-2 tw:[&.on]:after:bg-accent" v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
    </div>
    <WorkBoard v-if="tab === 'work'" class="wbody tw:flex-1 tw:[&&]:min-h-0" :settings="settings" :focus="boardFocus" @open-day="open" />
    <WorkList v-else-if="tab === 'list'" class="wbody tw:flex-1 tw:[&&]:min-h-0" @open-day="open" />
    <TaskList v-else-if="tab === 'jira'" class="wbody tw:flex-1 tw:min-h-0" @settings="emit('settings')" @open-day="(d) => open(d)" />
    <TaskCalendar v-else-if="tab === 'calendar'" class="wbody tw:flex-1 tw:min-h-0" fill :work-days="settings.schedule.workDays" @open-day="(d) => open(d)" />
    <ReportsView v-else class="wbody rep-in tw:flex-1 tw:[&&]:min-h-0" @go="(_v, d, id) => d && open(d, id)" />
  </div>
</template>
