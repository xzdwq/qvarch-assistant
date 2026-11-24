<script setup lang="ts">
import { computed } from 'vue'
import { ms } from '@shared/browser/inspect/inspectReport'
import type { NavTiming } from '@shared/browser/inspect/types'

/**
 * The page's opening as one bar of its phases, in their order (redirect, DNS, connection, TLS, the server's wait,
 * the download — the slots' colours, each named in the legend), with the moments after: DOMContentLoaded, the first
 * and the largest paint, load.
 */
const props = defineProps<{ t: NavTiming }>()
const PHASES = [
  { key: 'redirect', name: 'редирект', color: 'var(--viz-7)' },
  { key: 'dns', name: 'DNS', color: 'var(--viz-1)' },
  { key: 'connect', name: 'соединение', color: 'var(--viz-2)' },
  { key: 'tls', name: 'TLS', color: 'var(--viz-3)' },
  { key: 'wait', name: 'ожидание сервера', color: 'var(--viz-4)' },
  { key: 'download', name: 'загрузка HTML', color: 'var(--viz-5)' },
] as const
const end = computed(() => Math.max(1, props.t.load, props.t.lcp ?? 0, props.t.dcl))
const pct = (v: number) => `${(v / end.value) * 100}%`
/** The phases one after another from the start (a gap between them is not drawn). */
const bars = computed(() => {
  let x = 0
  return PHASES.filter((p) => props.t[p.key] > 0).map((p) => {
    const b = { ...p, left: pct(x), width: pct(props.t[p.key]), value: props.t[p.key] }
    x += props.t[p.key]
    return b
  })
})
const moments = computed(() =>
  [
    { name: 'DOMContentLoaded', at: props.t.dcl },
    { name: 'первая отрисовка', at: props.t.fcp },
    { name: 'главная отрисовка', at: props.t.lcp },
    { name: 'load', at: props.t.load },
  ].filter((m): m is { name: string; at: number } => !!m.at),
)
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-4 tw:px-10 tw:py-6">
    <div class="tw:flex tw:items-baseline tw:gap-8 tw:text-[11.5px]">
      <b class="tw:font-normal tw:text-text-2">Открытие страницы</b>
      <span class="tw:font-data tw:text-text">{{ ms(t.load || t.dcl) }}</span>
      <span v-if="t.protocol" class="tw:ml-auto tw:font-data tw:text-[11px] tw:text-muted">{{ t.protocol }}</span>
    </div>
    <div class="tw:relative tw:h-14 tw:rounded-[3px] tw:bg-panel-3">
      <i v-for="b in bars" :key="b.key" class="tw:absolute tw:top-0 tw:bottom-0 tw:border-r-2 tw:border-r-panel" :style="{ left: b.left, width: b.width, background: b.color }" :title="`${b.name}: ${ms(b.value)}`"></i>
      <i v-for="m in moments" :key="m.name" class="tw:absolute tw:-top-2 tw:-bottom-2 tw:w-px tw:bg-text" :style="{ left: pct(m.at) }" :title="`${m.name}: ${ms(m.at)}`"></i>
    </div>
    <div class="tw:flex tw:flex-wrap tw:gap-x-10 tw:gap-y-2 tw:text-[11px] tw:text-muted">
      <span v-for="b in bars" :key="b.key" class="tw:whitespace-nowrap"><i class="tw:inline-block tw:w-8 tw:h-8 tw:mr-3 tw:rounded-[2px]" :style="{ background: b.color }"></i>{{ b.name }} <span class="tw:font-data tw:text-text-2">{{ ms(b.value) }}</span></span>
    </div>
    <div class="tw:flex tw:flex-wrap tw:gap-x-10 tw:gap-y-2 tw:text-[11px] tw:text-muted">
      <span v-for="m in moments" :key="m.name" class="tw:whitespace-nowrap">│ {{ m.name }} <span class="tw:font-data tw:text-text-2">{{ ms(m.at) }}</span></span>
    </div>
  </div>
</template>
