<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import type { SideItem } from './useCalendarSideList'
import { useCalendarState } from './useTaskCalendar'

/** One day of the side list: the date on the left, its events and notes (a click opens one). */
defineProps<{ g: { day: string; items: SideItem[] } }>()
const { isOff, toNum, fmt } = useCalendarState()
</script>

<template>
  <div class="ngroup tw:pb-6 tw:border-b tw:border-b-border tw:grid tw:grid-cols-[38px_minmax(0,1fr)] tw:gap-6 tw:items-start">
    <div class="gday tw:group/gday tw:sticky tw:top-0 tw:flex tw:flex-col tw:items-center tw:pt-2 tw:leading-[1.1] tw:text-muted tw:text-[10px] tw:lowercase tw:[&.off]:text-down-fg" :class="{ off: isOff(toNum(g.day)) }"><span>{{ fmt(g.day, { weekday: 'short' }) }}</span><b class="tw:text-[17px] tw:text-text tw:group-[.off]/gday:text-down-fg">{{ +g.day.slice(8) }}</b><small>{{ fmt(g.day, { month: 'short' }) }}</small></div>
    <div class="gitems tw:flex tw:flex-col tw:gap-3">
      <button v-for="x in g.items" :key="x.key" class="nbr tw:flex tw:items-center tw:gap-6 tw:w-full tw:min-w-0 tw:py-4 tw:px-8 tw:border-0 tw:[&&]:border-l-3 tw:[&&]:border-l-(--c) tw:rounded-r2 tw:bg-white/3 tw:text-muted tw:text-[11.5px] tw:text-left tw:opacity-80 tw:hover:bg-white/7 tw:hover:text-text tw:hover:opacity-100 tw:hover:enabled:border-border-3" :style="{ '--c': x.color }" @click="x.open()">
        <Icon :name="x.icon" :size="10" :stroke="2.4" /><span class="nt tw:flex-none tw:tabular-nums tw:font-data">{{ x.time }}</span><span class="nx tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ x.text }}</span>
      </button>
    </div>
  </div>
</template>
