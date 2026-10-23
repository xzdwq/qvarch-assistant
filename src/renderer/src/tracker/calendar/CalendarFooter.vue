<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { useCalendarState } from './useTaskCalendar'

/** The footer under the strip: per day — done, productive, planned, the plan against the fact, counts. */
const { stats, colW, isOff, xOf, widthOf, fmt, formatDuration } = useCalendarState()
</script>

<template>
  <div class="sfoot tw:flex-none tw:flex tw:h-50 tw:border-t tw:border-t-border">
    <div class="corner fl tw:flex-none tw:w-50 tw:border-r tw:border-r-border tw:flex tw:items-center tw:justify-end tw:pr-6 tw:box-border tw:text-[10.5px] tw:text-muted">Итого</div>
    <div class="fcanvas tw:relative tw:flex-1 tw:min-w-0 tw:overflow-hidden">
      <template v-for="st in stats" :key="`f${st.n}`">
        <div
          v-if="colW >= 34 && (st.done || st.planned || st.notes || st.plan)"
          class="fcell tw:absolute tw:top-0 tw:bottom-0 tw:box-border tw:flex tw:flex-col tw:justify-center tw:py-0 tw:px-5 tw:border-l tw:border-l-white/5 tw:text-[10.5px] tw:leading-[12px] tw:whitespace-nowrap tw:overflow-hidden tw:[&.off]:bg-down/5"
          :class="{ off: isOff(st.n) }"
          :style="{ left: `${xOf(st.n)}px`, width: `${widthOf(st.n)}px` }"
          :title="`${fmt(st.day, { weekday: 'long', day: 'numeric', month: 'long' })}\nсделано ${formatDuration(st.done)} · продуктивно ${formatDuration(st.productive)}\nзапланировано ${formatDuration(st.planned)}\nсобытий ${st.count} · задач ${st.tasks} · встреч и созвонов ${st.meetings} · заметок ${st.notes}`"
        >
          <template v-if="st.plan && widthOf(st.n) >= 170">
            <span class="frow tw:flex tw:gap-6 tw:items-baseline"><span class="muted">План</span><b class="tw:text-[11.5px]">{{ formatDuration(st.plan) }}</b><span class="muted">Факт</span><b class="tw:text-[11.5px]">{{ formatDuration(st.done) }}</b></span>
            <span class="fbar tw:relative tw:flex tw:items-center tw:gap-6 tw:h-10"><span class="tw:block tw:h-4 tw:rounded-[2px] tw:bg-info tw:max-w-[calc(100%-34px)]" :style="{ width: `${Math.min(100, (st.done / st.plan) * 100)}%` }"></span><em class="tw:not-italic tw:text-[10px] tw:text-muted">{{ Math.round((st.done / st.plan) * 100) }}%</em></span>
          </template>
          <span v-else class="frow tw:flex tw:gap-6 tw:items-baseline">
            <b class="tw:text-[11.5px]" v-if="st.done">{{ formatDuration(st.done) }}</b>
            <span v-if="colW >= 110 && st.productive && st.productive !== st.done" class="fp tw:text-up-fg">прод. {{ formatDuration(st.productive) }}</span>
          </span>
          <span v-if="colW >= 70 && st.planned" class="fpl tw:text-muted">+{{ formatDuration(st.planned) }} план</span>
          <span v-if="colW >= 60" class="fcount tw:flex tw:gap-7 tw:text-muted tw:text-[10px]">
            <span class="tw:inline-flex tw:items-center tw:gap-2" :title="'Событий'"><Icon name="list" :size="9" />{{ st.count }}</span>
            <span class="tw:inline-flex tw:items-center tw:gap-2" v-if="st.tasks" :title="'Задач'"><Icon name="checkSquare" :size="9" />{{ st.tasks }}</span>
            <span class="tw:inline-flex tw:items-center tw:gap-2" v-if="colW >= 96 && st.meetings" :title="'Встреч и созвонов'"><Icon name="users" :size="9" />{{ st.meetings }}</span>
            <span class="tw:inline-flex tw:items-center tw:gap-2" v-if="colW >= 120 && st.notes" :title="'Заметок'"><Icon name="note" :size="9" />{{ st.notes }}</span>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
