<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDuration } from '@shared/timeline'
import Icon from '../../components/Icon.vue'
import DatePick from '../../components/DatePick.vue'
import DateRangePicker from '../../components/DateRangePicker.vue'
import { periodTotals } from '@shared/tracker/boardTime'
import { useWorkBoard } from './useWorkBoard'

/** The board's head: the period with its arrows and range picker, the day, timeline follow, the period's sums. */
const { day, per, weekStart, weekEnd, weekTitle, shiftPeriod, onNavWheel, toWeek, days, now, top, isToday, following, tlRef } = useWorkBoard()

const rangeOpen = ref(false)
const rangeEl = ref<HTMLElement>()
function applyRange(a: string, b: string): void {
  rangeOpen.value = false
  per.value = { mode: 'range', from: a, to: b }
}
const totals = computed(() => periodTotals(days.value, now.value))
</script>

<template>
  <div class="whead tw:flex tw:items-center tw:gap-12 tw:whitespace-nowrap tw:overflow-hidden tw:flex-none">
    <span class="wnav tw:inline-flex tw:items-center tw:gap-2" title="Колесо мыши — на неделю (период) вперёд или назад" @wheel.prevent="onNavWheel">
      <button class="ib tw:inline-flex tw:p-6 tw:border-0 tw:bg-transparent tw:text-muted tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:text-text-2 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg tw:hover:enabled:not-[.seg_&]:bg-hover tw:hover:enabled:not-[.seg_&]:not-[.quick_&]:border-border-3" :title="per.mode === 'week' ? 'Предыдущая неделя' : 'Предыдущий период'" @click="shiftPeriod(-1)"><Icon name="chevronLeft" :size="14" /></button>
      <button ref="rangeEl" class="wt num tw:font-data tw:tabular-nums tw:inline-flex tw:items-center tw:gap-6 tw:min-w-120 tw:justify-center tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-field tw:text-[12px] tw:text-text-hi tw:[&.on]:not-hover:not-[&.rng]:border-accent tw:hover:not-[&.rng]:border-accent tw:[&.rng]:border-accent-line tw:[&.rng]:text-accent-fg tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:not-[&.on]:not-hover:not-[&.rng]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-[&.rng]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.seg_&]:[&.on]:bg-accent-soft tw:[&&&]:[.seg_&]:[&.on]:text-accent-fg tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-[&.rng]:text-text-2 tw:[&&]:[.quick_&]:hover:border-accent tw:[&&&&]:[.quick_&]:hover:text-accent-fg tw:hover:enabled:not-[.seg_&]:bg-hover" :class="{ on: rangeOpen, rng: per.mode === 'range' }" title="Выбрать период" @click="rangeOpen = !rangeOpen"><Icon class="tw:text-muted" name="calendar" :size="12" />{{ weekTitle }}</button>
      <button class="ib tw:inline-flex tw:p-6 tw:border-0 tw:bg-transparent tw:text-muted tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:text-text-2 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg tw:hover:enabled:not-[.seg_&]:bg-hover tw:hover:enabled:not-[.seg_&]:not-[.quick_&]:border-border-3" :title="per.mode === 'week' ? 'Следующая неделя' : 'Следующий период'" @click="shiftPeriod(1)"><Icon name="chevronRight" :size="14" /></button>
    </span>
    <DateRangePicker v-if="rangeOpen" :from="weekStart" :to="weekEnd" :anchor="rangeEl" :max="62" @apply="applyRange" @close="rangeOpen = false" />
    <button v-if="per.mode === 'range'" class="toweek tw:h-28 tw:py-0 tw:px-10 tw:text-[12px] tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:text-text-2 tw:[.quick_&]:hover:border-accent tw:[.quick_&]:hover:text-accent-fg" title="Показывать неделю выбранного дня" @click="toWeek">Неделя</button>
    <DatePick v-model="day" />
    <!-- always there (hidden when not for this day / the week): the bar never changes its size -->
    <button class="follow tw:inline-flex tw:items-center tw:justify-center tw:w-30 tw:h-30 tw:p-0 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-accent-fg tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:not-[&.on]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:not-[&.on]:bg-transparent tw:[.seg_&]:not-[&.on]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.seg_&]:[&.on]:bg-accent-soft tw:[.seg_&]:[&.on]:text-accent-fg tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-[&.on]:text-text-2 tw:[&&]:[.quick_&]:hover:border-accent tw:[&&]:[.quick_&]:hover:text-accent-fg tw:hover:enabled:not-[&.on]:not-[.seg_&]:bg-hover tw:hover:enabled:not-[&.on]:not-[.seg_&]:not-[.quick_&]:border-border-3" :style="{ visibility: top === 'timeline' && isToday ? 'visible' : 'hidden' }" :class="{ on: following }" :title="following ? 'Автопрокрутка включена: таймлайн следует за текущим временем' : 'Автопрокрутка: таймлайн следует за текущим временем'" @click="tlRef?.toggleFollow()"><Icon name="follow" :size="13" /></button>
    <span class="tots tw:inline-flex tw:gap-16 tw:ml-auto tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.05em]">
      <span>СДЕЛАНО <b class="tw:text-text-hi tw:text-[12px]">{{ formatDuration(totals.done) }}</b></span>
      <span class="o1 tw:@max-[720px]:hidden">ЗАДАЧИ <b class="tw:text-text-hi tw:text-[12px]">{{ formatDuration(totals.tasks) }}</b></span>
      <span class="o1 tw:@max-[720px]:hidden">ВСТРЕЧИ <b class="tw:text-text-hi tw:text-[12px]">{{ formatDuration(totals.meetings) }}</b></span>
      <span class="o2 tw:@max-[900px]:hidden">ПЛАН <b class="pl tw:text-[12px] tw:text-accent-fg">{{ formatDuration(totals.plan) }}</b></span>
    </span>
  </div>
</template>
