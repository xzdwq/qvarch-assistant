<script setup lang="ts">
import { computed } from 'vue'
import { bars, groupItems } from '@shared/report'
import { HOUR } from '@shared/timeline'
import { barCaption, barSegments, barTooltip, chartUnit, isWeekendBar, seriesOrder, seriesScheme, yScale, yTicks as ticksOf, type Bar } from '@shared/tracker/reportChart'
import { KIND_LOOK, todayDay as today, useReports } from './useReportsState'

/** The report's chart: a bar per day / week / month, split by kind or by the top tasks. */
const emit = defineEmits<{ go: [view: 'day', day?: string, entryId?: string] }>()
const { st, allDays, items } = useReports()

/** The 9 biggest tasks get their colours, the rest are "другое". */
const topTasks = computed(() => groupItems(items.value, 'task').filter((g) => g.key).slice(0, 9).map((g) => g.key))
const scheme = computed(() => seriesScheme(st.value.color, topTasks.value, KIND_LOOK))
const seriesColor = (s: string) => scheme.value.color(s)
const seriesLabel = (s: string) => scheme.value.label(s)
const unit = computed(() => chartUnit(allDays.value.length))
const chart = computed(() => bars(items.value, allDays.value, unit.value, scheme.value.of))
const series = computed(() => seriesOrder(chart.value))
const yMax = computed(() => yScale(chart.value))
const yTicks = computed(() => ticksOf(yMax.value))
const segs = (b: Bar) => barSegments(b, series.value, yMax.value.top)
const barLabel = (key: string) => barCaption(key, unit.value, allDays.value.length)
const isOff = (key: string) => isWeekendBar(key, unit.value)
const barTitle = (b: Bar) => barTooltip(b, unit.value, series.value, seriesLabel)
/** A day bar opens the day; a week / month bar narrows the report to it. */
function openBar(key: string): void {
  if (unit.value === 'day') emit('go', 'day', key)
  else {
    st.value.period = unit.value === 'week' ? 'week' : 'month'
    st.value.anchor = unit.value === 'week' ? key : `${key}-01`
  }
}
</script>

<template>
  <section v-if="allDays.length > 1" class="card tw:py-10 tw:px-12 tw:rounded-r3 tw:border tw:border-border tw:bg-panel">
    <div class="ch tw:flex tw:items-center tw:gap-8 tw:mb-8">
      <span class="ct tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">{{ unit === 'day' ? 'По дням' : unit === 'week' ? 'По неделям' : 'По месяцам' }}</span>
      <span class="sp tw:flex-1"></span>
      <div class="seg sm tw:inline-flex tw:p-2 tw:rounded-[4px] tw:bg-white/4 tw:border tw:border-border">
        <button class="tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:whitespace-nowrap tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/25 tw:[&.on]:text-text-hi tw:h-22 tw:py-0 tw:px-8 tw:text-[11.5px]" :class="{ on: st.color === 'kind' }" @click="st.color = 'kind'">Вид</button>
        <button class="tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:whitespace-nowrap tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/25 tw:[&.on]:text-text-hi tw:h-22 tw:py-0 tw:px-8 tw:text-[11.5px]" :class="{ on: st.color === 'task' }" @click="st.color = 'task'">Задача</button>
      </div>
    </div>
    <div class="chart tw:flex tw:h-200">
      <div class="yax tw:relative tw:flex-none tw:w-34 tw:mb-30">
        <span class="tw:absolute tw:right-6 tw:[transform:translateY(50%)] tw:text-muted tw:text-[10.5px] tw:tabular-nums tw:font-data" v-for="v in yTicks" :key="v" :style="{ bottom: `${(v / yMax.top) * 100}%` }">{{ v ? `${v / HOUR}ч` : '' }}</span>
      </div>
      <div class="plot tw:relative tw:flex-1 tw:min-w-0 tw:flex tw:items-stretch tw:gap-3">
        <div class="gridlines tw:absolute tw:inset-[0_0_30px_0] tw:pointer-events-none"><div v-for="v in yTicks" :key="`g${v}`" class="gl tw:absolute tw:left-0 tw:right-0 tw:border-t tw:[border-top-style:dashed] tw:border-t-white/6" :style="{ bottom: `${(v / yMax.top) * 100}%` }"></div></div>
        <button v-for="b in chart" :key="b.key" class="col tw:group/col tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:cursor-pointer tw:hover:bg-white/4 tw:hover:enabled:border-border-3" :class="{ off: isOff(b.key), today: b.key === today() }" :title="barTitle(b)" @click="openBar(b.key)">
          <span class="stack tw:flex-1 tw:flex tw:flex-col-reverse tw:items-center">
            <i class="tw:w-[min(70%,34px)] tw:min-h-0 tw:first:not-last:rounded-[0_0_var(--r2)_var(--r2)] tw:last:rounded-tl-[4px] tw:last:rounded-tr-[4px]" v-for="p in segs(b)" :key="p.s" :style="{ height: `${p.h}%`, background: seriesColor(p.s) }"></i>
          </span>
          <span class="xl tw:group-[.off]/col:not-group-[.today]/col:text-dim tw:group-[.today]/col:text-accent-fg tw:group-[.today]/col:font-semibold tw:flex-none tw:h-30 tw:flex tw:flex-col tw:items-center tw:justify-center tw:text-muted tw:text-[11px] tw:leading-[1.15] tw:tabular-nums tw:font-data tw:overflow-hidden tw:whitespace-nowrap">{{ barLabel(b.key).top }}<small class="tw:text-muted tw:text-[10px]" v-if="barLabel(b.key).sub">{{ barLabel(b.key).sub }}</small></span>
        </button>
      </div>
    </div>
    <div class="legend tw:flex tw:flex-wrap tw:gap-y-4 tw:gap-x-14 tw:mt-6 tw:text-muted tw:text-[11.5px]">
      <span class="tw:inline-flex tw:items-center tw:gap-5" v-for="s in series" :key="s"><i class="tw:w-9 tw:h-9 tw:rounded-r2" :style="{ background: seriesColor(s) }"></i>{{ seriesLabel(s) }}</span>
    </div>
  </section>
</template>
