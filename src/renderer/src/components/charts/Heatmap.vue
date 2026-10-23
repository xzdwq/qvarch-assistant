<script setup lang="ts">
import { computed } from 'vue'
import { formatDuration } from '@shared/timeline'

/** When the time is spent: weekdays × hours, the brighter the more; under it — the day's profile by hour. */
const props = defineProps<{ matrix: number[][] }>()
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
/** The hours shown: the working ones at least, more if anything happened outside. */
const hours = computed(() => {
  let lo = 8
  let hi = 20
  for (const row of props.matrix)
    row.forEach((v, h) => {
      if (v > 0) {
        lo = Math.min(lo, h)
        hi = Math.max(hi, h)
      }
    })
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
})
const max = computed(() => Math.max(1, ...props.matrix.flat()))
const byHour = computed(() => hours.value.map((h) => props.matrix.reduce((s, r) => s + r[h], 0)))
const maxHour = computed(() => Math.max(1, ...byHour.value))
const peak = computed(() => {
  const i = byHour.value.indexOf(Math.max(...byHour.value))
  return byHour.value[i] ? hours.value[i] : undefined
})
</script>

<template>
  <div class="hm tw:flex tw:flex-col tw:gap-8">
    <div class="cells tw:grid tw:gap-2 tw:items-center" :style="{ gridTemplateColumns: `28px repeat(${hours.length}, minmax(0, 1fr))` }">
      <template v-for="(row, d) in matrix" :key="d">
        <span class="wd tw:text-muted tw:font-data tw:text-[10.5px] tw:[&.off]:text-down-fg" :class="{ off: d >= 5 }">{{ WD[d] }}</span>
        <i v-for="h in hours" :key="h" class="c tw:h-18 tw:rounded-[2px] tw:bg-[rgb(var(--accent-rgb)/var(--a))] tw:[outline:1px_solid_var(--border)] tw:[outline-offset:-1px]" :style="{ '--a': row[h] ? 0.12 + (row[h] / max) * 0.88 : 0 }" :title="`${WD[d]} ${h}:00–${h + 1}:00 — ${row[h] ? formatDuration(row[h]) : 'ничего'}`"></i>
      </template>
      <span></span>
      <span v-for="h in hours" :key="`h${h}`" class="hl tw:text-dim tw:font-data tw:text-[10px] tw:text-center">{{ h % 2 === 0 ? h : '' }}</span>
    </div>
    <div class="prof tw:grid tw:gap-2 tw:h-46 tw:items-end" :style="{ gridTemplateColumns: `28px repeat(${hours.length}, minmax(0, 1fr))` }">
      <span class="pk tw:self-center tw:text-cyan tw:font-data tw:text-[10px]">{{ peak !== undefined ? `пик ${peak}ч` : '' }}</span>
      <i class="tw:relative tw:h-full tw:flex tw:items-end" v-for="(v, i) in byHour" :key="i" :title="`${hours[i]}:00 — ${formatDuration(v)}`"><b class="tw:w-full tw:min-h-1 tw:rounded-[2px_2px_0_0] tw:bg-cyan tw:opacity-75" :style="{ height: `${(v / maxHour) * 100}%` }"></b></i>
    </div>
  </div>
</template>
