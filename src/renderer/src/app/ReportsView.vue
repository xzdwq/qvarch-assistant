<script setup lang="ts">
import ReportsBar from '../tracker/reports/ReportsBar.vue'
import ReportsTotals from '../tracker/reports/ReportsTotals.vue'
import ReportsAnalytics from '../tracker/reports/ReportsAnalytics.vue'
import ReportsChart from '../tracker/reports/ReportsChart.vue'
import ReportsBreakdown from '../tracker/reports/ReportsBreakdown.vue'
import ReportsAttrs from '../tracker/reports/ReportsAttrs.vue'
import { provideReports } from '../tracker/reports/useReportsState'

/**
 * Отчёты — where the time went over a period: totals, a chart by day / week / month, the events' attributes
 * (each one's values: time, events, share) and a breakdown by kind / task / day / week / an attribute (two levels
 * deep, down to the blocks). Filters and the view are remembered;
 * a view can be saved under a name.
 */
const emit = defineEmits<{ go: [day: string, entryId?: string] }>()
provideReports()
</script>

<template>
  <div class="rep tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <!-- the bar: period · filters · grouping, actions -->
    <ReportsBar />

    <div class="body tw:flex-1 tw:min-h-0 tw:overflow-auto tw:@container tw:pt-10 tw:pr-12 tw:pb-20 tw:pl-12 tw:flex tw:flex-col tw:gap-10">
      <ReportsTotals />

      <ReportsAnalytics />

      <!-- the chart -->
      <ReportsChart @go="(d) => emit('go', d)" />

      <!-- by the events' attributes -->
      <ReportsAttrs />

      <!-- the breakdown -->
      <ReportsBreakdown @go="(d, id) => emit('go', d, id)" />
    </div>
  </div>
</template>
