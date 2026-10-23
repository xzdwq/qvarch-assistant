<script setup lang="ts">
import { formatDuration } from '@shared/timeline'
import Icon from '../../components/Icon.vue'
import { kindColor, kindIcon, kindLabel } from '../../lib/palette'
import { useIsland } from '../islandState'

/** Under the track: what runs at the hovered moment, otherwise the day's totals per kind / task and the % useful. */
const { island, day, track } = useIsland()
const { ui } = island
const { kindTotals, taskTotals, workMs, pctTitle, productivePct } = day
const { hoverInfo } = track
</script>

<template>
  <div class="legend tw:h-20 tw:mt-6 tw:text-[12px] tw:overflow-hidden">
    <Transition name="fade" mode="out-in">
      <span v-if="hoverInfo" key="h" class="hover tw:block tw:text-text-2 tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ hoverInfo }}</span>
      <span v-else-if="ui.island.totals" key="l" class="items totals tw:flex tw:gap-12 tw:items-center tw:whitespace-nowrap tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">
        <span class="tw:inline-flex tw:items-center tw:gap-5 tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" v-for="[k, ms] in kindTotals" :key="k" :title="`${kindLabel(k)} — всего за день`">
          <Icon :name="kindIcon(k)" :size="13" :stroke="2.2" :style="{ color: kindColor(k) }" /><b class="tw:text-text tw:font-semibold tw:tabular-nums tw:font-data">{{ formatDuration(ms) }}</b>
        </span>
        <span v-for="[key, t] in taskTotals" :key="key" class="jt tw:text-info-fg tw:inline-flex tw:items-center tw:gap-5 tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :title="`${key} — ${t.summary}: всего за день`">
          <Icon name="jira" :size="13" />{{ key }} <b class="tw:text-text tw:font-semibold tw:tabular-nums tw:font-data">{{ formatDuration(t.ms) }}</b>
        </span>
        <span v-if="workMs" class="pct tw:inline-flex tw:items-center tw:gap-5 tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :title="pctTitle"><b class="tw:font-semibold tw:tabular-nums tw:font-data tw:text-up-fg">{{ productivePct }}%</b> полезного</span>
      </span>
    </Transition>
  </div>
</template>
