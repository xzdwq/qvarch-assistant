<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDuration } from '@shared/timeline'
import { dailyByKind, type EventStat } from '@shared/analytics'
import { groupItems } from '@shared/report'
import { kindColor, kindLabel } from '../../lib/palette'
import Spark from '../../components/charts/Spark.vue'
import Treemap, { type TreeItem } from '../../components/charts/Treemap.vue'
import Heatmap from '../../components/charts/Heatmap.vue'
import Donut from '../../components/charts/Donut.vue'
import AreaStack from '../../components/charts/AreaStack.vue'
import { fmtDay } from '@shared/tracker/reportPeriod'
import { eventLabel } from '@shared/tracker/reportStats'
import { useReports } from './useReportsState'

/** The report's analytics cards: where the time went, by kind, the dynamics, when I work, the top events. */
const { st, allDays, loading, items, fKinds, total, events, heat } = useReports()

const evLabel = (ev: EventStat) => eventLabel(ev, kindLabel)
const treeItems = computed<TreeItem[]>(() =>
  events.value.slice(0, 30).map((ev) => ({ label: ev.task ? ev.task.key : ev.label || kindLabel(ev.kind), sub: ev.task ? ev.task.summary : kindLabel(ev.kind), value: ev.ms, text: formatDuration(ev.ms), color: kindColor(ev.kind), title: `${evLabel(ev)} — ${formatDuration(ev.ms)} · ${ev.count} раз` })),
)
/** A tile → the report narrows to that event. */
function pickEvent(i: number): void {
  const ev = events.value[i]
  if (!ev) return
  if (ev.task) st.value.filter = { ...st.value.filter, tasks: [ev.task.key] }
  else st.value.filter = { ...st.value.filter, text: ev.label }
}
const donut = computed(() => groupItems(items.value, 'kind').map((g) => ({ key: g.key, label: kindLabel(g.key), value: g.ms, color: kindColor(g.key) })))
const daily = computed(() => dailyByKind(items.value, allDays.value))
const areaSeries = computed(() => daily.value.kinds.map((k) => ({ key: k, label: kindLabel(k), color: kindColor(k) })))
const areaLabels = computed(() => allDays.value.map((d) => fmtDay(d, { day: 'numeric', month: 'short' }).replace('.', '')))
const evSort = ref<'ms' | 'count' | 'avg'>('ms')
const evAll = ref(false)
const evShown = computed(() => [...events.value].sort((a, b) => b[evSort.value] - a[evSort.value]).slice(0, evAll.value ? 200 : 15))
const evMax = computed(() => Math.max(1, ...events.value.map((e) => e.ms)))
</script>

<template>
  <div class="ana tw:grid tw:grid-cols-3 tw:gap-12 tw:[&&]:@max-[980px]:grid-cols-[minmax(0,1fr)]">
    <section class="card s2 tw:py-10 tw:px-12 tw:rounded-r3 tw:border tw:border-border tw:bg-panel tw:m-0 tw:min-w-0 tw:col-[span_2] tw:[&&]:@max-[980px]:col-auto">
      <div class="ch tw:flex tw:items-center tw:gap-8 tw:mb-8"><span class="ct tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Куда ушло время</span><span class="sp tw:flex-1"></span><span class="cm tw:text-dim tw:text-[11px]">{{ events.length }} событий · клик — отфильтровать</span></div>
      <Treemap :items="treeItems" :height="270" @pick="pickEvent" />
    </section>
    <section class="card tw:py-10 tw:px-12 tw:rounded-r3 tw:border tw:border-border tw:bg-panel tw:m-0 tw:min-w-0">
      <div class="ch tw:flex tw:items-center tw:gap-8 tw:mb-8"><span class="ct tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">По видам</span></div>
      <Donut :parts="donut" @pick="(k) => (fKinds = [k])" />
    </section>
    <section v-if="allDays.length > 1" class="card s2 tw:py-10 tw:px-12 tw:rounded-r3 tw:border tw:border-border tw:bg-panel tw:m-0 tw:min-w-0 tw:col-[span_2] tw:[&&]:@max-[980px]:col-auto">
      <div class="ch tw:flex tw:items-center tw:gap-8 tw:mb-8"><span class="ct tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Динамика по видам</span></div>
      <AreaStack :labels="areaLabels" :series="areaSeries" :rows="daily.rows" :height="210" />
    </section>
    <section class="card tw:py-10 tw:px-12 tw:rounded-r3 tw:border tw:border-border tw:bg-panel tw:m-0 tw:min-w-0 tw:[&.s3]:col-span-full" :class="{ s3: allDays.length <= 1 }">
      <div class="ch tw:flex tw:items-center tw:gap-8 tw:mb-8"><span class="ct tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Когда я работаю</span></div>
      <Heatmap :matrix="heat" />
    </section>
    <section class="card s3 tw:py-10 tw:px-12 tw:rounded-r3 tw:border tw:border-border tw:bg-panel tw:m-0 tw:min-w-0 tw:col-span-full">
      <div class="ch tw:flex tw:items-center tw:gap-8 tw:mb-8">
        <span class="ct tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Топ событий</span>
        <span class="sp tw:flex-1"></span>
        <div class="seg sm tw:inline-flex tw:p-2 tw:rounded-[4px] tw:bg-white/4 tw:border tw:border-border">
          <button class="tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:whitespace-nowrap tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/25 tw:[&.on]:text-text-hi tw:h-22 tw:py-0 tw:px-8 tw:text-[11.5px]" :class="{ on: evSort === 'ms' }" @click="evSort = 'ms'">Время</button>
          <button class="tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:whitespace-nowrap tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/25 tw:[&.on]:text-text-hi tw:h-22 tw:py-0 tw:px-8 tw:text-[11.5px]" :class="{ on: evSort === 'count' }" @click="evSort = 'count'">Раз</button>
          <button class="tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:whitespace-nowrap tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/25 tw:[&.on]:text-text-hi tw:h-22 tw:py-0 tw:px-8 tw:text-[11.5px]" :class="{ on: evSort === 'avg' }" @click="evSort = 'avg'">Среднее</button>
        </div>
      </div>
      <div class="evt tw:flex tw:flex-col">
        <div class="evh tw:grid tw:grid-cols-[minmax(0,1fr)_100px_44px_44px_70px_150px_70px_100px] tw:items-center tw:gap-10 tw:py-0 tw:px-6 tw:h-26 tw:border-b tw:border-b-border tw:text-muted tw:font-data tw:text-[10px] tw:tracking-[0.06em] tw:uppercase"><span>Событие</span><span>Вид</span><span class="r tw:text-right">Раз</span><span class="r tw:text-right">Дней</span><span class="r tw:text-right">Среднее</span><span>Доля</span><span class="r tw:text-right">Всего</span><span>По дням</span></div>
        <button v-for="ev in evShown" :key="ev.key" class="evr tw:grid tw:grid-cols-[minmax(0,1fr)_100px_44px_44px_70px_150px_70px_100px] tw:items-center tw:gap-10 tw:py-0 tw:px-6 tw:h-32 tw:border-0 tw:[&&]:border-b tw:[&&]:border-b-border tw:rounded-none tw:bg-transparent tw:text-[12.5px] tw:text-left tw:cursor-default tw:hover:bg-hover tw:hover:enabled:border-border-3" :title="evLabel(ev)" @click="ev.task ? (st.filter = { ...st.filter, tasks: [ev.task.key] }) : (st.filter = { ...st.filter, text: ev.label })">
          <span class="evn tw:flex tw:items-center tw:gap-7 tw:min-w-0 tw:whitespace-nowrap">
            <i class="tw:flex-none tw:w-3 tw:h-16 tw:rounded-[2px]" :style="{ background: kindColor(ev.kind) }"></i>
            <b v-if="ev.task" class="evk tw:flex-none tw:font-data tw:text-[11.5px] tw:text-text-hi">{{ ev.task.key }}</b>
            <span class="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis">{{ ev.task ? ev.task.summary : ev.label || kindLabel(ev.kind) }}</span>
          </span>
          <span class="evkind tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11.5px]">{{ kindLabel(ev.kind) }}</span>
          <span class="r num tw:text-right tw:font-data tw:tabular-nums tw:text-[12px]">{{ ev.count }}</span>
          <span class="r num tw:text-right tw:font-data tw:tabular-nums tw:text-[12px]">{{ ev.days }}</span>
          <span class="r num tw:text-right tw:font-data tw:tabular-nums tw:text-[12px]">{{ formatDuration(ev.avg) }}</span>
          <span class="evb tw:flex tw:items-center tw:gap-6"><i class="tw:h-6 tw:min-w-2 tw:rounded-[1px]" :style="{ width: `${(ev.ms / evMax) * 100}%`, background: kindColor(ev.kind) }"></i><small class="tw:text-muted tw:font-data tw:text-[10.5px]">{{ total ? Math.round((ev.ms / total) * 100) : 0 }}%</small></span>
          <b class="r num tw:text-right tw:font-data tw:tabular-nums tw:text-[12px] tw:text-text-hi">{{ formatDuration(ev.ms) }}</b>
          <Spark :values="ev.perDay" :color="kindColor(ev.kind)" :w="96" :h="18" />
        </button>
        <button v-if="events.length > 15" class="more tw:self-start tw:mt-8 tw:mr-6 tw:mb-0 tw:ml-6 tw:py-4 tw:px-10 tw:text-[12px]" @click="evAll = !evAll">{{ evAll ? 'Свернуть' : `Показать все ${events.length}` }}</button>
        <p v-if="!events.length" class="none tw:m-8 tw:text-muted tw:text-[12px]">{{ loading ? 'Загрузка…' : 'Нет записей за период' }}</p>
      </div>
    </section>
  </div>
</template>
