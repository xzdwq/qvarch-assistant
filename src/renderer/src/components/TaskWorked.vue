<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDuration, formatHM } from '@shared/timeline'
import { todayKey } from '../lib/today'
import { openEventInWork } from '../lib/mentions'
import { besidePlace } from '../lib/usePopover'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

/**
 * When a task was / will be worked on: a timeline icon with the number of its blocks; a click — the list (the day,
 * the period, how long; the latest first), a block opened in «Моя работа» on its day. Nothing when there is none.
 */
export type Worked = { day: string; id: string; start: number; end: number }
const props = defineProps<{ blocks: Worked[] }>()
const list = computed(() => [...props.blocks].sort((a, b) => b.start - a.start))
const total = computed(() => props.blocks.reduce((s, b) => s + Math.max(0, b.end - b.start), 0))
const open = ref(false)
/** The chip it opened from: the list stays by it, closes when it is out of sight. */
const anchor = ref<HTMLElement>()
const place = besidePlace(300, 320, true)
function toggle(e: Event): void {
  anchor.value = e.currentTarget as HTMLElement
  open.value = !open.value
}
const dayText = (d: string) => {
  const s = new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', ...(d.slice(0, 4) !== todayKey.value.slice(0, 4) ? { year: 'numeric' } : {}) })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function go(b: Worked): void {
  open.value = false
  openEventInWork(b.day, b.id)
}
</script>

<template>
  <button v-if="blocks.length" class="twk tw:inline-flex tw:items-center tw:[justify-self:start] tw:gap-4 tw:h-22 tw:py-0 tw:px-7 tw:border tw:border-border-2 tw:rounded-[11px] tw:bg-transparent tw:text-text-2 tw:text-[11px] tw:hover:not-[&.on]:border-accent tw:[&.on]:border-accent tw:hover:not-[&.on]:text-accent-fg tw:[&.on]:text-accent-fg tw:hover:enabled:bg-hover" :class="{ on: open }" :title="`На таймлайне: ${blocks.length} · всего ${formatDuration(total)}`" @click.stop="toggle">
    <Icon name="timeline" :size="13" /><b class="tw:font-semibold">{{ blocks.length }}</b>
  </button>
  <span v-else></span>
  <Popover v-model:open="open" :anchor="anchor" :place="place" class="twk-pop tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-1 tw:w-300 tw:max-h-320 tw:p-6 tw:overflow-auto tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" @pointerdown.stop>
    <p class="cap tw:mt-2 tw:mr-6 tw:mb-6 tw:ml-6 tw:text-muted tw:text-[11px] tw:tracking-[0.04em] tw:uppercase">На таймлайне · {{ formatDuration(total) }}</p>
    <button class="tw:group/g28 tw:grid tw:grid-cols-[1fr_auto_52px] tw:items-center tw:gap-10 tw:py-6 tw:px-8 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-hover" v-for="b in list" :key="b.id" :class="{ fut: b.day > todayKey }" @click="go(b)">
      <span class="d tw:group-[.fut]/g28:text-info-fg">{{ dayText(b.day) }}</span>
      <span class="t tw:group-[.fut]/g28:text-info-fg tw:font-data tw:tabular-nums">{{ formatHM(b.start) }}–{{ formatHM(b.end) }}</span>
      <span class="u tw:font-data tw:tabular-nums tw:text-muted tw:text-right">{{ formatDuration(b.end - b.start) }}</span>
    </button>
  </Popover>
</template>
