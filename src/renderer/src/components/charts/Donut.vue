<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDuration } from '@shared/timeline'

/** Shares of a whole: a ring with the total inside and a legend with the percentages. */
const props = defineProps<{ parts: Array<{ key: string; label: string; value: number; color: string }> }>()
const emit = defineEmits<{ pick: [key: string] }>()
const R = 54
const C = 2 * Math.PI * R
const total = computed(() => props.parts.reduce((s, p) => s + p.value, 0))
const arcs = computed(() => {
  let off = 0
  return props.parts
    .filter((p) => p.value > 0)
    .map((p) => {
      const len = (p.value / (total.value || 1)) * C
      const a = { ...p, dash: `${Math.max(0, len - 1.5)} ${C}`, off: -off }
      off += len
      return a
    })
})
const hover = ref<string>()
const shown = computed(() => props.parts.find((p) => p.key === hover.value))
</script>

<template>
  <div class="dn tw:flex tw:items-center tw:gap-16 tw:min-w-0">
    <svg viewBox="0 0 140 140" class="donut tw:flex-none tw:w-150 tw:h-150 tw:[transform:rotate(-90deg)]">
      <circle cx="70" cy="70" :r="R" class="bg tw:fill-none tw:[stroke:var(--panel-3)] tw:stroke-16" />
      <circle
        v-for="a in arcs"
        :key="a.key"
        cx="70"
        cy="70"
        :r="R"
        class="arc tw:fill-none tw:stroke-16 tw:cursor-default tw:[transition:stroke-width_0.12s] tw:[&.on]:stroke-20"
        :class="{ on: hover === a.key }"
        :style="{ stroke: a.color }"
        :stroke-dasharray="a.dash"
        :stroke-dashoffset="a.off"
        @mouseenter="hover = a.key"
        @mouseleave="hover = undefined"
        @click="emit('pick', a.key)"
      />
      <text x="70" y="66" class="t1 tw:[transform:rotate(90deg)] tw:origin-[70px_70px] tw:[text-anchor:middle] tw:[fill:var(--text-hi)] tw:font-data tw:text-[15px] tw:font-bold">{{ shown ? `${Math.round((shown.value / (total || 1)) * 100)}%` : formatDuration(total) }}</text>
      <text x="70" y="84" class="t2 tw:[transform:rotate(90deg)] tw:origin-[70px_70px] tw:[text-anchor:middle] tw:[fill:var(--muted)] tw:text-[10px]">{{ shown ? shown.label : 'всего' }}</text>
    </svg>
    <div class="lg tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:gap-2">
      <button v-for="p in parts" :key="p.key" class="li tw:flex tw:items-center tw:gap-8 tw:py-3 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-[12px] tw:text-left tw:whitespace-nowrap tw:cursor-default tw:[&.on]:bg-hover tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:border-border-3" :class="{ on: hover === p.key }" @mouseenter="hover = p.key" @mouseleave="hover = undefined" @click="emit('pick', p.key)">
        <i class="tw:flex-none tw:w-8 tw:h-8 tw:rounded-[2px]" :style="{ background: p.color }"></i>
        <span class="ll tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-text-2">{{ p.label }}</span>
        <b class="tw:font-data tw:text-[12px] tw:text-text-hi">{{ formatDuration(p.value) }}</b>
        <span class="lp tw:w-34 tw:text-right tw:text-muted tw:font-data tw:text-[11px]">{{ Math.round((p.value / (total || 1)) * 100) }}%</span>
      </button>
    </div>
  </div>
</template>
