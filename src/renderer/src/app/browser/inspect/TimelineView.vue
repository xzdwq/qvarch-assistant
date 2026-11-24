<script setup lang="ts">
import { computed } from 'vue'
import { niceMax, stackPaths } from '@shared/browser/inspect/chartPaths'
import { ANIM_COST_WORDS, REQ_CAT_WORDS, reqCat, TASK_KINDS, TASK_WORDS, type AnimCost, type TaskKind } from '@shared/browser/inspect/constants'
import { ms } from '@shared/browser/inspect/inspectReport'
import { kb } from '@shared/browser/inspect/siteFacts'
import { packLanes, taskLabel } from '@shared/browser/inspect/timeline'
import type { ActionGroup, MonitorSample } from '@shared/browser/inspect/types'

/**
 * A span of time as tracks, one under another (as DevTools' Performance — lightly): the main thread's load (the
 * monitor's seconds), the acts, the main thread's long frames by what started them, the network by source, the
 * animations by what they cost, the scrolls, the layout shifts. What followed what is seen down the tracks; each bar
 * tells itself on hover. An act's bar picked — the span zooms to it.
 */
const props = defineProps<{ groups: ActionGroup[]; monitor: MonitorSample[]; from: number; to: number; compact?: boolean }>()
const emit = defineEmits<{ zoom: [g: ActionGroup] }>()
const span = computed(() => Math.max(1, props.to - props.from))
const pos = (at: number) => ((at - props.from) / span.value) * 100
const box = (a: number, b: number) => {
  const l = Math.max(0, pos(a))
  const r = Math.min(100, pos(Math.max(b, a)))
  return { left: `${l}%`, width: `${Math.max(0.25, r - l)}%` }
}
const inRange = (a: number, b: number) => b >= props.from && a <= props.to
/** The axis' marks: a round step for the span. */
const ticks = computed(() => {
  const step = niceMax(span.value / 6, 1)
  const out: Array<{ x: number; label: string }> = []
  for (let t = 0; t <= span.value; t += step) out.push({ x: (t / span.value) * 100, label: ms(t) })
  return out
})
// ---------- the load (the monitor's seconds within the span) ----------
const W = 300
const H = 30
const samples = computed(() => props.monitor.filter((s) => s.at >= props.from - 1000 && s.at <= props.to + 1000))
/** The load's parts in the slots' order: scripts, rendering (layout and styles), the rest. */
const LOAD = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-rest)']
const load = computed(() => {
  const s = samples.value
  if (s.length < 2) return { paths: [] as string[], left: '0%', width: '0%' }
  const parts = [s.map((x) => Math.min(100, x.script / 10)), s.map((x) => Math.min(100, (x.layout + x.style) / 10)), s.map((x) => Math.max(0, x.cpu - (x.script + x.layout + x.style) / 10))]
  return { paths: stackPaths(parts, W, H, 100), ...box(s[0].at, s[s.length - 1].at) }
})
// ---------- the tracks ----------
const acts = computed(() => props.groups.filter((g) => g.kind !== 'background' && inRange(g.at, g.end)))
const TASK_COLOR: Record<TaskKind, string> = { event: 'var(--viz-1)', promise: 'var(--viz-2)', callback: 'var(--viz-3)', script: 'var(--viz-4)', other: 'var(--viz-rest)' }
const tasks = computed(() => props.groups.flatMap((g) => g.tasks).filter((t) => inRange(t.at, t.at + t.ms)))
const items = computed(() => {
  const list = tasks.value.flatMap((t) => t.items).filter((i) => inRange(i.at, i.at + i.ms)).sort((a, b) => a.at - b.at)
  const lanes = packLanes(list.map((i) => ({ start: i.at, end: i.at + i.ms })), 3)
  return list.map((i, k) => ({ i, lane: lanes[k] }))
})
const reqs = computed(() => {
  const list = props.groups.flatMap((g) => g.reqs).filter((r) => inRange(r.start, r.end ?? props.to)).sort((a, b) => a.start - b.start)
  const lanes = packLanes(list.map((r) => ({ start: r.start, end: r.end ?? props.to })), 8)
  return list.map((r, k) => ({ r, lane: lanes[k] }))
})
const COST_COLOR: Record<AnimCost, string> = { composite: 'var(--up)', paint: 'var(--warn)', layout: 'var(--down)' }
const anims = computed(() => {
  const list = props.groups.flatMap((g) => g.anims).filter((a) => inRange(a.at, a.end ?? props.to)).sort((a, b) => a.at - b.at)
  const lanes = packLanes(list.map((a) => ({ start: a.at, end: a.end ?? props.to })), 4)
  return list.map((a, k) => ({ a, lane: lanes[k] }))
})
const scrolls = computed(() => props.groups.filter((g) => g.scroll && inRange(g.at, g.at + g.scroll.ms)))
const shifts = computed(() => props.groups.flatMap((g) => g.shifts).filter((s) => inRange(s.at, s.at)))
const lanesOf = (list: Array<{ lane: number }>) => Math.max(1, ...list.map((x) => x.lane + 1))
const LANE = 9
const ROW = 'tw:relative tw:min-w-0'
const NAME = 'tw:w-74 tw:flex-none tw:truncate tw:text-[11px] tw:text-muted'
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-3 tw:min-w-0 tw:select-none">
    <!-- the axis -->
    <div class="tw:flex tw:gap-6">
      <span :class="NAME"></span>
      <div :class="ROW" class="tw:flex-1 tw:h-14 tw:border-b tw:border-b-border">
        <span v-for="t in ticks" :key="t.x" class="tw:absolute tw:top-0 tw:text-[10px] tw:font-data tw:text-muted tw:whitespace-nowrap tw:-translate-x-1/2 tw:first:translate-x-0" :style="{ left: `${t.x}%` }">{{ t.label }}</span>
      </div>
    </div>
    <div v-if="!compact && load.paths.length" class="tw:flex tw:gap-6">
      <span :class="NAME" title="Загрузка главного потока по секундам: скрипты, отрисовка (раскладка и стили), прочее">Поток, %</span>
      <div :class="ROW" class="tw:flex-1 tw:h-30 tw:bg-panel-2 tw:rounded-[2px]">
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="tw:absolute tw:top-0 tw:h-full" :style="{ left: load.left, width: load.width }">
          <path v-for="(d, i) in load.paths" :key="i" :d="d" :style="{ fill: LOAD[i] }" />
        </svg>
      </div>
    </div>
    <div v-if="acts.length" class="tw:flex tw:gap-6">
      <span :class="NAME">Действия</span>
      <div :class="ROW" class="tw:flex-1 tw:h-16">
        <button v-for="g in acts" :key="g.id" class="tw:absolute tw:top-0 tw:h-16 tw:px-3 tw:border-0 tw:rounded-[3px] tw:bg-accent/30 tw:text-[10.5px] tw:text-text-hi tw:text-left tw:truncate tw:hover:bg-accent/50" :style="box(g.at, g.end)" :title="`${g.label} — ${ms(g.end - g.at)}`" @click="emit('zoom', g)">{{ g.label }}</button>
      </div>
    </div>
    <div v-if="items.length || tasks.length" class="tw:flex tw:gap-6">
      <span :class="NAME" title="Длинные кадры главного потока (от 50 мс) и что их заняло">Поток</span>
      <div :class="ROW" class="tw:flex-1" :style="{ height: `${lanesOf(items) * LANE + 4}px` }">
        <i v-for="(t, k) in tasks" :key="'t' + k" class="tw:absolute tw:top-0 tw:bottom-0 tw:border tw:border-text-2/40 tw:rounded-[2px]" :style="box(t.at, t.at + t.ms)" :title="`Длинный кадр ${ms(t.ms)}`"></i>
        <i v-for="(x, k) in items" :key="'i' + k" class="tw:absolute tw:h-7 tw:rounded-[2px]" :style="{ ...box(x.i.at, x.i.at + x.i.ms), top: `${2 + x.lane * LANE}px`, background: TASK_COLOR[x.i.kind] }" :title="`${TASK_WORDS[x.i.kind]}: ${x.i.name}\n${taskLabel(x.i)}\n${ms(x.i.ms)}`"></i>
      </div>
    </div>
    <div v-if="reqs.length" class="tw:flex tw:gap-6">
      <span :class="NAME">Сеть</span>
      <div :class="ROW" class="tw:flex-1" :style="{ height: `${lanesOf(reqs) * LANE}px` }">
        <i v-for="x in reqs" :key="x.r.id" class="tw:absolute tw:h-7 tw:rounded-[2px] tw:[&.bad]:outline tw:[&.bad]:outline-down" :class="{ bad: x.r.failed || (x.r.status ?? 0) >= 400 }" :style="{ ...box(x.r.start, x.r.end ?? to), top: `${x.lane * LANE}px`, background: `var(--req-${reqCat(x.r.type)})` }" :title="`${REQ_CAT_WORDS[reqCat(x.r.type)].short} ${x.r.method} ${x.r.url}\n${x.r.status ?? x.r.failed ?? '…'} · ${x.r.end ? ms(x.r.end - x.r.start) : 'идёт'}${x.r.size ? ' · ' + kb(x.r.size) : ''}${x.r.initiator ? '\nвызвал: ' + x.r.initiator : ''}`"></i>
      </div>
    </div>
    <div v-if="anims.length" class="tw:flex tw:gap-6">
      <span :class="NAME">Анимации</span>
      <div :class="ROW" class="tw:flex-1" :style="{ height: `${lanesOf(anims) * LANE}px` }">
        <i v-for="x in anims" :key="x.a.id" class="tw:absolute tw:h-7 tw:rounded-[2px] tw:opacity-80" :style="{ ...box(x.a.at, x.a.end ?? to), top: `${x.lane * LANE}px`, background: COST_COLOR[x.a.cost] }" :title="`${x.a.kind === 'transition' ? 'Переход' : 'Анимация'} ${x.a.name}${x.a.infinite ? ' (бесконечная)' : ''}\n${x.a.target}\nсвойства: ${x.a.props.join(', ') || '—'}\n${ANIM_COST_WORDS[x.a.cost]}${x.a.end ? ' · ' + ms(x.a.end - x.a.at) : ' · идёт'}`"></i>
      </div>
    </div>
    <div v-if="scrolls.length" class="tw:flex tw:gap-6">
      <span :class="NAME">Прокрутка</span>
      <div :class="ROW" class="tw:flex-1 tw:h-14">
        <i v-for="g in scrolls" :key="g.id" class="tw:absolute tw:top-0 tw:h-14 tw:px-3 tw:rounded-[3px] tw:text-[10px] tw:not-italic tw:text-text tw:truncate" :style="{ ...box(g.at, g.at + g.scroll!.ms), background: 'color-mix(in srgb, var(--viz-6) 40%, transparent)' }" :title="`Прокрутка ${g.scroll!.distance} px за ${ms(g.scroll!.ms)} · ${g.scroll!.fps} кадров/с · рывков ${g.scroll!.slow}`">{{ g.scroll!.fps }} fps</i>
      </div>
    </div>
    <div v-if="shifts.length" class="tw:flex tw:gap-6">
      <span :class="NAME">Сдвиги</span>
      <div :class="ROW" class="tw:flex-1 tw:h-10">
        <i v-for="(s, k) in shifts" :key="k" class="tw:absolute tw:top-1 tw:w-8 tw:h-8 tw:-ml-4 tw:rotate-45" :style="{ left: `${pos(s.at)}%`, background: 'var(--viz-7)' }" :title="`Сдвиг вёрстки ${s.value.toFixed(3)}`"></i>
      </div>
    </div>
    <div v-if="items.length || reqs.length || anims.length" class="tw:flex tw:flex-wrap tw:gap-x-10 tw:gap-y-2 tw:pl-80 tw:text-[10.5px] tw:text-muted">
      <span v-for="k in TASK_KINDS.filter((k) => items.some((x) => x.i.kind === k))" :key="k" class="tw:whitespace-nowrap"><i class="tw:inline-block tw:w-8 tw:h-8 tw:mr-3 tw:rounded-[2px]" :style="{ background: TASK_COLOR[k] }"></i>{{ TASK_WORDS[k] }}</span>
      <span v-for="c in (['composite', 'paint', 'layout'] as const).filter((c) => anims.some((x) => x.a.cost === c))" :key="c" class="tw:whitespace-nowrap"><i class="tw:inline-block tw:w-8 tw:h-8 tw:mr-3 tw:rounded-[2px]" :style="{ background: COST_COLOR[c] }"></i>анимация: {{ ANIM_COST_WORDS[c] }}</span>
    </div>
  </div>
</template>
