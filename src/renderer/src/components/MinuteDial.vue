<script setup lang="ts">
import { computed, ref } from 'vue'

/**
 * Half-wheel "last N minutes" picker: mouse wheel or dragging along the arc, 5-minute steps.
 * Emits every change so the caller can move the marker live.
 */
const props = withDefaults(defineProps<{ modelValue: number; max?: number; step?: number }>(), { max: 120, step: 5 })
const emit = defineEmits<{ 'update:modelValue': [v: number]; commit: [] }>()

const W = 84
const H = 46
const cx = W / 2
const cy = H - 4
const r = 34

const svg = ref<SVGSVGElement>()
const dragging = ref(false)

const frac = computed(() => Math.min(1, Math.max(0, props.modelValue / props.max)))
function point(f: number, radius = r): { x: number; y: number } {
  const a = Math.PI * (1 - f) // 180° (left) → 0° (right)
  return { x: cx + radius * Math.cos(a), y: cy - radius * Math.sin(a) }
}
const knob = computed(() => point(frac.value))
const track = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
const filled = computed(() => {
  if (frac.value <= 0) return ''
  const p = knob.value
  return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
})
const ticks = computed(() => {
  const n = props.max / 15
  return Array.from({ length: n + 1 }, (_, i) => {
    const f = i / n
    return { a: point(f, r + 5), b: point(f, r + (i % 2 === 0 ? 9 : 7)) }
  })
})

const text = computed(() => {
  const v = props.modelValue
  if (!v) return '—'
  if (v < 60) return `${v}м`
  const h = Math.floor(v / 60)
  const m = v % 60
  return m ? `${h}ч${m}` : `${h}ч`
})

function set(v: number): void {
  const c = Math.min(props.max, Math.max(0, Math.round(v / props.step) * props.step))
  if (c !== props.modelValue) emit('update:modelValue', c)
}

function onWheel(e: WheelEvent): void {
  set(props.modelValue + (e.deltaY < 0 ? props.step : -props.step))
}

function fromPointer(e: PointerEvent): void {
  const b = svg.value!.getBoundingClientRect()
  const x = ((e.clientX - b.left) / b.width) * W - cx
  const y = cy - ((e.clientY - b.top) / b.height) * H
  const a = Math.atan2(Math.max(y, 0), x) // 0..π
  set((1 - a / Math.PI) * props.max)
}

function onDown(e: PointerEvent): void {
  dragging.value = true
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  fromPointer(e)
}
function onMove(e: PointerEvent): void {
  if (dragging.value) fromPointer(e)
}
</script>

<template>
  <div class="dial" title="Последние N минут">
    <svg
      ref="svg"
      :width="W"
      :height="H"
      :viewBox="`0 0 ${W} ${H}`"
      @wheel.prevent="onWheel"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="(dragging = false), emit('commit')"
      @lostpointercapture="dragging = false"
    >
      <line v-for="(t, i) in ticks" :key="i" :x1="t.a.x" :y1="t.a.y" :x2="t.b.x" :y2="t.b.y" class="tick" />
      <path :d="track" class="track" />
      <path v-if="filled" :d="filled" class="fill" />
      <circle :cx="knob.x" :cy="knob.y" r="5" class="knob" :class="{ active: dragging }" />
      <text :x="cx" :y="cy - 8" class="val">{{ text }}</text>
      <text :x="cx" :y="cy + 2" class="cap">последние</text>
    </svg>
  </div>
</template>

<style scoped>
.dial {
  display: inline-flex;
  cursor: ew-resize;
  user-select: none;
}
.track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 6;
  stroke-linecap: round;
}
.fill {
  fill: none;
  stroke: #818cf8;
  stroke-width: 6;
  stroke-linecap: round;
  transition: d 0.12s ease;
}
.tick {
  stroke: rgba(255, 255, 255, 0.18);
  stroke-width: 1;
}
.knob {
  fill: #e0e7ff;
  stroke: #6366f1;
  stroke-width: 2;
  transition:
    cx 0.12s ease,
    cy 0.12s ease,
    r 0.12s;
}
.knob.active {
  r: 6;
}
.val {
  fill: #e5e7eb;
  font-size: 12px;
  font-weight: 700;
  text-anchor: middle;
  font-variant-numeric: tabular-nums;
}
.cap {
  fill: #8b93a7;
  font-size: 8px;
  text-anchor: middle;
}
</style>
