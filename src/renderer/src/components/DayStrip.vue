<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatDuration, formatHM } from '@shared/timeline'
import type { Entry, Ms } from '@shared/types'
import { entryIcon, kindColor } from '../lib/palette'
import Icon from './Icon.vue'

/**
 * The day as a chain under the timeline: what was (faded, joined by a dotted line) · now · in
 * how long the next one starts · what is next (joined by plain lines). Flat cards with a coloured edge;
 * overflow scrolls sideways (the arrows move it).
 */
const props = defineProps<{ entries: Entry[]; now: Ms; countdown: 'any' | 'outlook' }>()

/** Only Outlook meetings when the countdown is to meetings (the setting); else every block. */
const sorted = computed(() =>
  [...props.entries].filter((e) => props.countdown === 'any' || !!e.outlook).sort((a, b) => a.start - b.start),
)
// what has finished (a live block — a call still growing — is not "past": it would blink in and out)
const past = computed(() => sorted.value.filter((e) => e.end <= props.now - 2 * 60_000).slice(-2))
const upcoming = computed(() => sorted.value.filter((e) => e.start > props.now).slice(0, 8))
/** What the countdown is to: the nearest one. */
const target = computed(() => upcoming.value[0])
const leftText = computed(() => {
  if (!target.value) return ''
  const m = Math.max(1, Math.round((target.value.start - props.now) / 60_000))
  return m < 60 ? `${m} мин` : formatDuration(m * 60_000)
})
const soon = computed(() => !!target.value && target.value.start - props.now <= 10 * 60_000)

// sideways: arrows when it does not fit
const row = ref<HTMLElement>()
const canL = ref(false)
const canR = ref(false)
function measure(): void {
  const el = row.value
  if (!el) return
  canL.value = el.scrollLeft > 2
  canR.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
}
function scrollBy(dir: 1 | -1): void {
  row.value?.scrollBy({ left: dir * Math.max(200, (row.value.clientWidth ?? 400) * 0.6), behavior: 'smooth' })
}
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(measure)
  if (row.value) ro.observe(row.value)
  measure()
})
onBeforeUnmount(() => ro?.disconnect())
const tint = (c: string) => ({ '--c': c })
const NOW = 'var(--daystrip-now)'
const NEXT = 'var(--accent)'
const SOON = 'var(--daystrip-soon)'
</script>

<template>
  <div class="ds tw:relative tw:flex tw:items-center tw:border-t tw:border-t-border">
    <button v-if="canL" class="arr l tw:absolute tw:top-[50%] tw:z-2 tw:inline-flex tw:items-center tw:justify-center tw:w-30 tw:h-30 tw:-mt-15 tw:p-0 tw:border-0 tw:rounded-[50%] tw:bg-border-2 tw:text-text-2 tw:[box-shadow:0_4px_14px_rgba(0,0,0,0.45)] tw:left-6 tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="scrollBy(-1)"><Icon name="chevronLeft" :size="16" /></button>
    <div ref="row" class="chain tw:flex-1 tw:min-w-0 tw:flex tw:items-center tw:py-7 tw:px-10 tw:overflow-x-auto tw:scrollbar-none tw:[&::-webkit-scrollbar]:hidden" @scroll="measure">
      <!-- what was: faded, a dotted line on to the next -->
      <template v-for="e in past" :key="e.id">
        <div class="card past tw:[--c:var(--accent)] tw:flex-none tw:flex tw:items-center tw:gap-9 tw:max-w-260 tw:h-40 tw:box-border tw:pt-0 tw:pr-14 tw:pb-0 tw:pl-8 tw:rounded-r2 tw:border-l-3 tw:border-l-(--c) tw:[&&]:border-l-transparent tw:bg-panel tw:opacity-60" :style="tint(kindColor(e.kind))" :title="e.label">
          <span class="ic tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:rounded-[50%] tw:bg-transparent tw:text-muted"><Icon :name="entryIcon(e)" :size="15" :stroke="2" /></span>
          <span class="tx tw:min-w-0 tw:flex tw:flex-col tw:leading-[1.2]"><small class="tw:text-muted tw:text-[11px] tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">{{ formatHM(e.start) }} – {{ formatHM(e.end) }}</small><b class="tw:text-[12.5px] tw:font-semibold tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">{{ e.label }}</b></span>
        </div>
        <span class="link dotted tw:[--c:var(--accent)] tw:[--d:var(--c)] tw:flex-none tw:relative tw:w-44 tw:h-2 tw:mr-4 tw:[background:radial-gradient(circle,var(--c)_1px,transparent_1.5px)_0_50%/6px_2px_repeat-x]" style="--c: var(--daystrip-past-line)"><i class="tw:absolute tw:-right-4 tw:top-[50%] tw:w-9 tw:h-9 tw:-mt-4.5 tw:rounded-[50%] tw:[background:var(--d)]"></i></span>
      </template>

      <!-- now -->
      <div class="card now tw:[--c:var(--accent)] tw:flex-none tw:flex tw:items-center tw:gap-9 tw:max-w-260 tw:h-40 tw:box-border tw:pt-0 tw:pr-14 tw:pb-0 tw:pl-8 tw:rounded-r2 tw:border-l-3 tw:border-l-(--c) tw:bg-panel-2" :style="tint(NOW)">
        <span class="ic tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:rounded-[50%] tw:text-text-hi tw:[background:var(--c)]"><Icon name="clock" :size="15" :stroke="2.2" /></span>
        <span class="tx tw:min-w-0 tw:flex tw:flex-col tw:leading-[1.2]"><b class="big tw:font-semibold tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis tw:text-[14px] tw:tabular-nums tw:font-data">{{ formatHM(now) }}</b><small class="tw:text-muted tw:text-[11px] tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">Сейчас</small></span>
      </div>

      <!-- in how long the next one starts -->
      <template v-if="target">
        <span class="link dashed tw:[--c:var(--accent)] tw:[--d:var(--c)] tw:flex-none tw:relative tw:h-2 tw:mr-4 tw:w-28 tw:[background:linear-gradient(90deg,var(--c)_50%,transparent_50%)_0_0/6px_2px_repeat-x]" :style="tint(NOW)"><i class="tw:absolute tw:-right-4 tw:top-[50%] tw:w-9 tw:h-9 tw:-mt-4.5 tw:rounded-[50%] tw:[background:var(--d)]"></i></span>
        <div class="card cd tw:[--c:var(--accent)] tw:flex-none tw:flex tw:items-center tw:gap-9 tw:max-w-260 tw:h-40 tw:box-border tw:pt-0 tw:pr-14 tw:pb-0 tw:pl-8 tw:rounded-r2 tw:border-l-3 tw:border-l-(--c) tw:bg-panel-2" :class="{ soon }" :style="tint(soon ? SOON : NEXT)" :title="countdown === 'outlook' ? 'До встречи' : 'До следующего события'">
          <span class="ic tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:rounded-[50%] tw:bg-[color-mix(in_srgb,var(--c)_32%,var(--panel-2))] tw:text-text-hi"><Icon :name="entryIcon(target)" :size="15" :stroke="2.2" /></span>
          <span class="tx tw:min-w-0 tw:flex tw:flex-col tw:leading-[1.2]"><b class="tw:font-semibold tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis tw:text-[13px]">через {{ leftText }}</b></span>
        </div>
      </template>

      <!-- what is next: plain lines -->
      <template v-for="(e, i) in upcoming" :key="e.id">
        <span class="link tw:[--c:var(--accent)] tw:[--d:var(--c)] tw:flex-none tw:relative tw:w-44 tw:h-2 tw:mr-4 tw:bg-[color-mix(in_srgb,var(--c)_75%,transparent)]" :style="{ '--c': i === 0 ? NEXT : kindColor(upcoming[i - 1].kind), '--d': kindColor(e.kind) }"><i class="tw:absolute tw:-right-4 tw:top-[50%] tw:w-9 tw:h-9 tw:-mt-4.5 tw:rounded-[50%] tw:[background:var(--d)]"></i></span>
        <div class="card tw:[--c:var(--accent)] tw:flex-none tw:flex tw:items-center tw:gap-9 tw:max-w-260 tw:h-40 tw:box-border tw:pt-0 tw:pr-14 tw:pb-0 tw:pl-8 tw:rounded-r2 tw:border-l-3 tw:border-l-(--c) tw:bg-panel-2" :style="tint(kindColor(e.kind))" :title="e.label">
          <span class="ic tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:rounded-[50%] tw:bg-[color-mix(in_srgb,var(--c)_32%,var(--panel-2))] tw:text-text-hi"><Icon :name="entryIcon(e)" :size="15" :stroke="2.2" /></span>
          <span class="tx tw:min-w-0 tw:flex tw:flex-col tw:leading-[1.2]"><small class="tw:text-muted tw:text-[11px] tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">{{ formatHM(e.start) }} – {{ formatHM(e.end) }}</small><b class="tw:text-[12.5px] tw:font-semibold tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis">{{ e.label }}</b></span>
        </div>
      </template>
      <span v-if="!upcoming.length && !target" class="none tw:ml-14 tw:text-muted tw:text-[12px]">Дальше событий нет</span>
    </div>
    <button v-if="canR" class="arr r tw:absolute tw:top-[50%] tw:z-2 tw:inline-flex tw:items-center tw:justify-center tw:w-30 tw:h-30 tw:-mt-15 tw:p-0 tw:border-0 tw:rounded-[50%] tw:bg-border-2 tw:text-text-2 tw:[box-shadow:0_4px_14px_rgba(0,0,0,0.45)] tw:right-6 tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" @click="scrollBy(1)"><Icon name="chevronRight" :size="16" /></button>
  </div>
</template>
