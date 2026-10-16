<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { pulseScore, smoothPath, type PulsePoint, type PulseRow } from '@shared/pulse'
import type { Ms } from '@shared/types'

/**
 * Activity wave: key presses + mouse travel + window switches as one glowing line.
 *  live — the last `seconds`, from the live 1 s bins streamed by main (reacts within a fraction of a second);
 *  day  — the stored minute bins over [from, to] (the main window's timeline).
 */
const props = withDefaults(
  defineProps<{ mode?: 'live' | 'day'; seconds?: number; points?: number; rows?: PulseRow[]; dayStartMs?: Ms; from?: Ms; to?: Ms }>(),
  { mode: 'live', seconds: 90, points: 30 },
)

const H = 20
const bins = ref(new Map<number, PulsePoint>())
const clock = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
let off: (() => void) | undefined

function merge(list: PulsePoint[]): void {
  const m = new Map(bins.value)
  for (const p of list) m.set(p.t, p)
  // forget what scrolled out of the window
  const keepFrom = Date.now() - (props.seconds + 10) * 1000
  for (const t of m.keys()) if (t < keepFrom) m.delete(t)
  bins.value = m
}

onMounted(() => {
  if (props.mode !== 'live') return
  void window.qa.getPulse().then(merge)
  off = window.qa.onPulse(merge)
  // the wave keeps scrolling even when nothing happens (it settles down to a calm line)
  tick = setInterval(() => (clock.value = Date.now()), 500)
})
onBeforeUnmount(() => {
  off?.()
  clearInterval(tick)
})

/** Scores per point, oldest → newest. */
const scores = computed<number[]>(() => {
  const n = props.points
  const out = new Array<number>(n).fill(0)
  if (props.mode === 'live') {
    const end = clock.value
    const span = props.seconds * 1000
    const step = span / n
    for (const p of bins.value.values()) {
      const i = Math.floor((p.t - (end - span)) / step)
      if (i >= 0 && i < n) out[i] += pulseScore(p)
    }
  } else if (props.rows && props.dayStartMs !== undefined && props.from !== undefined && props.to !== undefined) {
    const step = (props.to - props.from) / n
    for (const [minute, k, m, s] of props.rows) {
      const t = props.dayStartMs + minute * 60_000
      const i = Math.floor((t - props.from) / step)
      if (i >= 0 && i < n) out[i] += pulseScore({ k, m, s })
    }
  }
  // a light smoothing pass — a wave, not a bar chart
  return out.map((v, i) => (out[i - 1] ?? v) * 0.25 + v * 0.5 + (out[i + 1] ?? v) * 0.25)
})

const path = computed(() => {
  const v = scores.value
  // calm activity stays low; the scale follows the busiest moment in view (with a floor)
  const max = Math.max(props.mode === 'live' ? 12 : 60, ...v)
  const pts = v.map((s, i): [number, number] => [(i / (v.length - 1)) * 100, H - 3 - (Math.sqrt(s / max) * (H - 6))])
  return smoothPath(pts)
})
const level = computed(() => {
  const v = scores.value
  const last = v.slice(-3).reduce((a, b) => a + b, 0) / 3
  return Math.min(1, last / 12)
})
</script>

<template>
  <svg class="wave" :class="mode" :viewBox="`0 0 100 ${H}`" preserveAspectRatio="none" :style="{ '--lv': level }">
    <defs>
      <linearGradient :id="`wg-${mode}`" gradientUnits="userSpaceOnUse" x1="0" x2="100" y1="0" y2="0">
        <stop offset="0" style="stop-color: var(--accent); stop-opacity: 0.3" />
        <stop offset="0.6" style="stop-color: var(--accent-hi)" />
        <stop offset="1" style="stop-color: var(--accent-fg)" />
      </linearGradient>
    </defs>
    <path class="line" :style="{ d: `path('${path}')` }" :stroke="`url(#wg-${mode})`" vector-effect="non-scaling-stroke" />
  </svg>
</template>

<style scoped>
/* the glow is on the whole picture, not on the line: a filter on a perfectly flat line (no activity —
   e.g. the future) has a zero-high box and draws nothing, a nearly flat one gets its glow cut */
.wave {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  /* the glow grows with the current activity */
  filter: drop-shadow(0 0 calc(2px + var(--lv) * 4px) rgb(var(--accent-rgb) / calc(0.45 + var(--lv) * 0.4)));
}
.wave.day {
  filter: drop-shadow(0 0 3px rgb(var(--accent-rgb) / 0.55));
}
.line {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: d 0.5s linear;
}
.day .line {
  transition: d 0.25s ease;
}
</style>
