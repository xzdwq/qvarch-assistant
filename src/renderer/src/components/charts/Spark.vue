<script setup lang="ts">
import { computed } from 'vue'

/** A tiny line of a series (a terminal's sparkline): the shape only, the area under it faded. */
const props = withDefaults(defineProps<{ values: number[]; color?: string; w?: number; h?: number }>(), { color: 'var(--accent)', w: 84, h: 22 })
const pts = computed(() => {
  const v = props.values
  if (!v.length) return ''
  const max = Math.max(...v, 1e-9)
  const step = v.length > 1 ? props.w / (v.length - 1) : props.w
  return v.map((x, i) => `${(i * step).toFixed(1)},${(props.h - 2 - (x / max) * (props.h - 4)).toFixed(1)}`).join(' ')
})
const area = computed(() => (pts.value ? `0,${props.h} ${pts.value} ${props.w},${props.h}` : ''))
const id = `sp${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <svg class="spark tw:block tw:flex-none" :width="w" :height="h" :viewBox="`0 0 ${w} ${h}`" preserveAspectRatio="none">
    <defs>
      <linearGradient :id="id" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" :style="{ stopColor: color, stopOpacity: 0.35 }" />
        <stop offset="1" :style="{ stopColor: color, stopOpacity: 0 }" />
      </linearGradient>
    </defs>
    <polygon v-if="area" :points="area" :fill="`url(#${id})`" />
    <polyline v-if="pts" :points="pts" fill="none" :style="{ stroke: color }" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
  </svg>
</template>
