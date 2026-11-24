<script setup lang="ts">
import { computed, ref } from 'vue'
import { linePath, nearestIndex, niceMax, stackPaths } from '@shared/browser/inspect/chartPaths'
import { clockText } from '@shared/browser/inspect/perfMonitor'
import { kb } from '@shared/browser/inspect/siteFacts'
import type { ActionGroup, MonitorSample } from '@shared/browser/inspect/types'

/**
 * The page's performance over the last minutes (as DevTools' «Performance monitor»), small multiples — each chart
 * its own axis: the main thread's load stacked by what it did (scripts, layout, styles, the rest), the JS memory,
 * the DOM's elements, the event listeners. The person's acts marked on the load; one crosshair over all of them,
 * its values in the charts' heads.
 */
const props = defineProps<{ samples: MonitorSample[]; groups: ActionGroup[] }>()
const W = 300
const H = 54
const hover = ref<number>()
const n = computed(() => props.samples.length)
const at = computed(() => (hover.value !== undefined ? props.samples[hover.value] : props.samples[n.value - 1]))
/** The load's parts, in the slots' order (the rest — gray): % of each second. */
const LOAD = [
  { key: 'script', name: 'скрипты', color: 'var(--viz-1)' },
  { key: 'layout', name: 'раскладка', color: 'var(--viz-2)' },
  { key: 'style', name: 'стили', color: 'var(--viz-3)' },
  { key: 'rest', name: 'прочее', color: 'var(--viz-rest)' },
] as const
const loadOf = (s: MonitorSample) => {
  const script = Math.min(100, s.script / 10)
  const layout = Math.min(100 - script, s.layout / 10)
  const style = Math.min(100 - script - layout, s.style / 10)
  return { script, layout, style, rest: Math.max(0, s.cpu - script - layout - style) }
}
const loads = computed(() => props.samples.map(loadOf))
const loadMax = computed(() => niceMax(Math.max(...props.samples.map((s) => s.cpu), 10), 10))
const loadPaths = computed(() => stackPaths(LOAD.map((l) => loads.value.map((v) => v[l.key])), W, H, loadMax.value))
/** The single-measure charts: each its own axis. */
const LINES = [
  { key: 'heap', title: 'Память JS', text: (v: number) => kb(v), color: 'var(--viz-5)' },
  { key: 'nodes', title: 'Элементы DOM', text: (v: number) => String(Math.round(v)), color: 'var(--viz-4)' },
  { key: 'listeners', title: 'Обработчики событий', text: (v: number) => String(Math.round(v)), color: 'var(--viz-7)' },
] as const
const lines = computed(() =>
  LINES.map((l) => {
    const vals = props.samples.map((s) => s[l.key])
    const max = niceMax(Math.max(...vals, 1))
    return { ...l, path: linePath(vals, W, 28, max), max }
  }),
)
/** The acts on the load chart: their place across the time shown. */
const marks = computed(() => {
  const s = props.samples
  if (s.length < 2) return []
  const from = s[0].at
  const to = s[s.length - 1].at
  return props.groups.filter((g) => g.kind !== 'background' && g.at >= from && g.at <= to).map((g) => ({ id: g.id, x: ((g.at - from) / (to - from)) * W, label: g.label }))
})
const crossX = computed(() => (hover.value === undefined || n.value < 2 ? undefined : (hover.value / (n.value - 1)) * W))
function onMove(e: PointerEvent): void {
  const r = (e.currentTarget as SVGElement).getBoundingClientRect()
  hover.value = nearestIndex(((e.clientX - r.left) / r.width) * W, W, n.value)
}
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-8 tw:px-10 tw:py-8">
    <p v-if="n < 2" class="tw:m-0 tw:text-[12px] tw:text-muted">Замеры идут раз в секунду — график появится через пару секунд.</p>
    <template v-else>
      <div class="tw:flex tw:justify-between tw:text-[11px] tw:text-muted tw:font-data">
        <span>{{ clockText(samples[0].at) }}</span>
        <span v-if="at">{{ hover !== undefined ? clockText(at.at) : 'сейчас' }}</span>
      </div>
      <div class="tw:flex tw:flex-col tw:gap-3">
        <div class="tw:flex tw:items-baseline tw:gap-8 tw:min-w-0 tw:text-[11.5px]">
          <b class="tw:font-normal tw:text-text-2 tw:whitespace-nowrap">Загрузка потока</b>
          <span class="tw:font-data tw:text-text">{{ at?.cpu ?? 0 }}%</span>
          <span class="tw:flex tw:gap-8 tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-muted">
            <span v-for="l in LOAD" :key="l.key"><i class="tw:inline-block tw:w-8 tw:h-8 tw:mr-3 tw:rounded-[2px]" :style="{ background: l.color }"></i>{{ l.name }}{{ at ? ' ' + Math.round(loadOf(at)[l.key]) + '%' : '' }}</span>
          </span>
        </div>
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="tw:w-full tw:h-54 tw:overflow-visible" @pointermove="onMove" @pointerleave="hover = undefined">
          <line v-for="k in [0.5, 1]" :key="k" x1="0" :x2="W" :y1="H * (1 - k)" :y2="H * (1 - k)" class="tw:stroke-border" vector-effect="non-scaling-stroke" stroke-width="1" />
          <path v-for="(d, i) in loadPaths" :key="LOAD[i].key" :d="d" :style="{ fill: LOAD[i].color }" class="tw:stroke-panel" stroke-width="1" vector-effect="non-scaling-stroke" />
          <line v-for="m in marks" :key="m.id" :x1="m.x" :x2="m.x" y1="0" :y2="H" class="tw:stroke-text-2" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" stroke-width="1"><title>{{ m.label }}</title></line>
          <line v-if="crossX !== undefined" :x1="crossX" :x2="crossX" y1="0" :y2="H" class="tw:stroke-text" vector-effect="non-scaling-stroke" stroke-width="1" />
        </svg>
        <span class="tw:text-[10.5px] tw:text-muted tw:font-data">шкала 0–{{ loadMax }}% · пунктир — ваши действия</span>
      </div>
      <div v-for="l in lines" :key="l.key" class="tw:flex tw:flex-col tw:gap-3">
        <div class="tw:flex tw:items-baseline tw:gap-8 tw:text-[11.5px]">
          <b class="tw:font-normal tw:text-text-2">{{ l.title }}</b>
          <span class="tw:font-data tw:text-text">{{ at ? l.text(at[l.key]) : '' }}</span>
          <span class="tw:ml-auto tw:font-data tw:text-[10.5px] tw:text-muted">до {{ l.text(l.max) }}</span>
        </div>
        <svg :viewBox="`0 0 ${W} 28`" preserveAspectRatio="none" class="tw:w-full tw:h-28 tw:overflow-visible" @pointermove="onMove" @pointerleave="hover = undefined">
          <path :d="l.path" fill="none" :style="{ stroke: l.color }" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
          <line v-if="crossX !== undefined" :x1="crossX" :x2="crossX" y1="0" y2="28" class="tw:stroke-text" vector-effect="non-scaling-stroke" stroke-width="1" />
        </svg>
      </div>
      <div v-if="at" class="tw:flex tw:flex-wrap tw:gap-x-12 tw:gap-y-2 tw:text-[11px] tw:text-muted tw:font-data">
        <span>раскладок/с {{ at.layouts }}</span><span>пересчётов стилей/с {{ at.recalcs }}</span><span>документов {{ at.documents }}</span><span>фреймов {{ at.frames }}</span>
      </div>
    </template>
  </div>
</template>
