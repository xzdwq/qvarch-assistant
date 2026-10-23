<script setup lang="ts">
import { formatDuration } from '@shared/timeline'
import Spark from '../../components/charts/Spark.vue'
import { changePct as delta } from '@shared/tracker/reportStats'
import { useReports } from './useReportsState'

/** The report's total cards (against the previous period) and a few plain sentences about it. */
const { kpi, insights } = useReports()
</script>

<template>
  <!-- the totals -->
  <div class="kpis tw:grid tw:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] tw:gap-8">
    <div v-for="k in kpi" :key="k.label" class="kpi tw:flex tw:flex-col tw:gap-2 tw:py-8 tw:px-12 tw:rounded-[4px] tw:border tw:border-border tw:bg-panel tw:[&.main]:border-accent/45 tw:[&.main]:bg-[color-mix(in_srgb,var(--accent)_10%,var(--panel))]" :class="{ main: k.main }">
      <span class="kl tw:inline-flex tw:items-center tw:gap-5 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap"><i class="tw:w-8 tw:h-8 tw:rounded-[2px]" v-if="k.color" :style="{ background: k.color }"></i>{{ k.label }}</span>
      <span class="kv tw:flex tw:items-baseline tw:gap-8">
        <b class="tw:text-[18px] tw:tabular-nums tw:font-data">{{ formatDuration(k.ms) }}</b>
        <span v-if="delta(k) !== undefined" class="kd tw:font-data tw:text-[11px] tw:font-semibold tw:[&.up]:not-[&.down]:text-up-fg tw:[&.down]:text-down-fg" :class="delta(k)! >= 0 ? 'up' : 'down'" :title="`Прошлый период: ${formatDuration(k.prev)}`">{{ delta(k)! >= 0 ? '▲' : '▼' }} {{ Math.abs(delta(k)!) }}%</span>
      </span>
      <Spark v-if="k.spark.length > 1" :values="k.spark" :color="k.color ?? 'var(--accent)'" :w="150" :h="20" class="ksp tw:mt-4 tw:w-full" />
    </div>
  </div>

  <!-- plain words -->
  <div v-if="insights.length" class="ins tw:flex tw:flex-wrap tw:gap-6">
    <span v-for="x in insights" :key="x.k" class="in tw:[&.none]:m-8 tw:inline-flex tw:items-baseline tw:gap-7 tw:py-5 tw:px-10 tw:border tw:border-border tw:[&&]:border-l-2 tw:[&&]:border-l-accent tw:rounded-r2 tw:bg-panel tw:text-[12.5px] tw:text-text tw:[&.up]:not-[&.down]:not-[&.warn]:border-l-up tw:[&.down]:not-[&.warn]:border-l-down tw:[&&]:[&.warn]:border-l-warn" :class="x.tone"><em class="tw:not-italic tw:font-data tw:text-[10px] tw:tracking-[0.06em] tw:uppercase tw:text-muted">{{ x.k }}</em>{{ x.v }}</span>
  </div>
</template>
