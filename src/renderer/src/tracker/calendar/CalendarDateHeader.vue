<script setup lang="ts">
import { useCalendarState } from './useTaskCalendar'

/** The dates over the strip: day columns, month bands, day labels (a click opens the day in the timeline). */
const { els, visibleNums, isOff, todayNum, toKey, colW, hover, xOf, widthOf, months, dayLabel, openDay } = useCalendarState()
</script>

<template>
  <div class="shead tw:flex-none tw:flex tw:h-46 tw:border-b tw:border-b-border">
    <div class="corner tw:flex-none tw:w-50 tw:border-r tw:border-r-border"></div>
    <div :ref="els.head" class="hcanvas tw:relative tw:flex-1 tw:min-w-0 tw:overflow-hidden">
      <div
        v-for="n in visibleNums"
        :key="`hc${n}`"
        class="col tw:absolute tw:top-0 tw:bottom-0 tw:box-border tw:pointer-events-none tw:[&.sep]:not-[&.month]:border-l tw:[&.sep]:not-[&.month]:border-l-white/5 tw:[&&]:group-[.roomy]/strip:[&.sep]:border-l-white/7 tw:[&.off]:not-[&.today]:not-[&.hov]:bg-down/5 tw:[&.month]:border-l tw:[&.month]:border-l-muted/45 tw:[&.today]:not-[&.hov]:bg-info/10 tw:[&.hov]:bg-accent/16 tw:[&.hov]:[box-shadow:var(--shadow-underline)]"
        :class="{ off: isOff(n), today: n === todayNum, month: toKey(n).endsWith('-01'), sep: colW >= 8, hov: hover?.n === n }"
        :style="{ left: `${xOf(n)}px`, width: `${widthOf(n)}px` }"
      ></div>
      <div class="mrow tw:absolute tw:left-0 tw:right-0 tw:h-22 tw:pointer-events-none tw:top-0">
        <span v-for="m in months" :key="m.key" class="mlabel tw:absolute tw:top-3 tw:py-0 tw:px-8 tw:text-[12px] tw:font-semibold tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis" :style="{ left: `${m.x}px`, maxWidth: `${Math.max(0, m.w)}px` }">{{ m.label }}</span>
      </div>
      <div class="drow tw:absolute tw:left-0 tw:right-0 tw:h-22 tw:pointer-events-none tw:top-22">
        <template v-for="n in visibleNums" :key="`d${n}`">
          <button
            v-if="dayLabel(n)"
            class="dlabel tw:[&.hov]:not-hover:not-[&.off]:not-[&.today]:text-text-hi tw:[&.hov]:not-[&.today]:font-bold tw:absolute tw:top-0 tw:h-22 tw:flex tw:items-center tw:py-0 tw:px-4 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-text tw:text-[11.5px] tw:whitespace-nowrap tw:overflow-hidden tw:pointer-events-auto tw:cursor-pointer tw:hover:not-[&.off]:not-[&.today]:text-accent-fg tw:[&.off]:not-[&.today]:text-down-fg tw:[&.today]:text-info-fg tw:[&.today]:font-bold tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3"
            :class="{ today: n === todayNum, off: isOff(n), hov: hover?.n === n }"
            :style="{ left: `${xOf(n)}px`, width: `${Math.max(widthOf(n), 18)}px` }"
            title="Открыть день в таймлайне"
            @click.stop="openDay(toKey(n))"
          >
            {{ dayLabel(n) }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
