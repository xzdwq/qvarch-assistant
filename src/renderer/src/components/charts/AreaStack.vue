<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatDuration } from '@shared/timeline'

/**
 * Day by day, stacked by series (a kind): filled areas with a line on top, an hour grid, and a crosshair
 * that reads every series of the day under the pointer.
 */
const props = withDefaults(
  defineProps<{ labels: string[]; series: Array<{ key: string; label: string; color: string }>; rows: Array<Record<string, number>>; height?: number }>(),
  { height: 200 },
)
const el = ref<HTMLElement>()
const width = ref(600)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(() => (width.value = el.value?.clientWidth ?? 600))
  if (el.value) ro.observe(el.value)
})
onBeforeUnmount(() => ro?.disconnect())

const PL = 34
const PB = 18
const PT = 6
const HOUR = 3_600_000
const plotW = computed(() => Math.max(10, width.value - PL - 6))
const plotH = computed(() => props.height - PB - PT)
const totals = computed(() => props.rows.map((r) => props.series.reduce((s, x) => s + (r[x.key] ?? 0), 0)))
const yMax = computed(() => {
  const max = Math.max(HOUR, ...totals.value)
  const step = [1, 2, 4, 5, 10].map((x) => x * HOUR).find((s) => max / s <= 4) ?? 25 * HOUR
  return { top: Math.ceil(max / step) * step, step }
})
const x = (i: number) => PL + (props.rows.length > 1 ? (i / (props.rows.length - 1)) * plotW.value : plotW.value / 2)
const y = (v: number) => PT + plotH.value - (v / yMax.value.top) * plotH.value
const layers = computed(() => {
  const base = props.rows.map(() => 0)
  return props.series.map((s) => {
    const lo = [...base]
    props.rows.forEach((r, i) => (base[i] += r[s.key] ?? 0))
    const hi = [...base]
    const top = hi.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    const bottom = lo.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).reverse()
    return { ...s, area: [...top, ...bottom].join(' '), line: top.join(' ') }
  })
})
const ticks = computed(() => {
  const out: number[] = []
  for (let v = 0; v <= yMax.value.top; v += yMax.value.step) out.push(v)
  return out
})
const every = computed(() => Math.max(1, Math.ceil(props.labels.length / Math.max(1, Math.floor(plotW.value / 46)))))
const hov = ref<number>()
function onMove(e: MouseEvent): void {
  const r = el.value!.getBoundingClientRect()
  const px = e.clientX - r.left - PL
  const n = props.rows.length
  hov.value = n ? Math.max(0, Math.min(n - 1, Math.round((px / plotW.value) * (n - 1)))) : undefined
}
</script>

<template>
  <div ref="el" class="ar tw:relative tw:w-full" @mousemove="onMove" @mouseleave="hov = undefined">
    <svg class="tw:block" :width="width" :height="height">
      <g v-for="v in ticks" :key="v">
        <line :x1="PL" :x2="PL + plotW" :y1="y(v)" :y2="y(v)" class="gl tw:[stroke:var(--border)] tw:[stroke-dasharray:2_3]" />
        <text :x="PL - 6" :y="y(v) + 3" class="yl tw:[fill:var(--dim)] tw:font-data tw:text-[10px] tw:[text-anchor:end]">{{ v ? `${v / HOUR}ч` : '0' }}</text>
      </g>
      <g v-for="l in layers" :key="l.key">
        <polygon :points="l.area" :style="{ fill: l.color }" class="fa tw:opacity-[0.28]" />
        <polyline :points="l.line" :style="{ stroke: l.color }" class="ln tw:fill-none tw:stroke-[1.5] tw:[stroke-linejoin:round]" />
      </g>
      <template v-for="(lb, i) in labels" :key="i">
        <text v-if="i % every === 0" :x="x(i)" :y="height - 4" class="xl tw:[fill:var(--dim)] tw:font-data tw:text-[10px] tw:[text-anchor:middle]">{{ lb }}</text>
      </template>
      <line v-if="hov !== undefined" :x1="x(hov)" :x2="x(hov)" :y1="PT" :y2="PT + plotH" class="cross tw:[stroke:var(--text-2)] tw:[stroke-dasharray:3_3]" />
    </svg>
    <div v-if="hov !== undefined" class="tip tw:absolute tw:top-4 tw:z-2 tw:flex tw:flex-col tw:gap-2 tw:min-w-170 tw:py-6 tw:px-8 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-pop tw:shadow-pop tw:text-[11.5px] tw:pointer-events-none" :style="{ left: `${Math.min(x(hov) + 10, width - 190)}px` }">
      <b class="tw:font-data tw:text-[11.5px] tw:text-text-hi">{{ labels[hov] }} · {{ formatDuration(totals[hov]) }}</b>
      <span class="tw:flex tw:items-center tw:gap-6 tw:text-text-2" v-for="s in series.filter((s) => rows[hov!]?.[s.key])" :key="s.key"><i class="tw:w-7 tw:h-7 tw:rounded-[2px]" :style="{ background: s.color }"></i>{{ s.label }}<em class="tw:ml-auto tw:not-italic tw:font-data tw:text-text">{{ formatDuration(rows[hov!][s.key]) }}</em></span>
    </div>
  </div>
</template>
