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
  <div class="dial tw:inline-flex tw:cursor-ew-resize tw:select-none" title="Последние N минут">
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
      <line v-for="(t, i) in ticks" :key="i" :x1="t.a.x" :y1="t.a.y" :x2="t.b.x" :y2="t.b.y" class="tick tw:stroke-white/18 tw:stroke-1" />
      <path :d="track" class="track tw:fill-none tw:stroke-white/10 tw:stroke-6 tw:[stroke-linecap:round]" />
      <path v-if="filled" :d="filled" class="fill tw:fill-none tw:[stroke:var(--accent)] tw:stroke-6 tw:[stroke-linecap:round] tw:[transition:d_0.12s_ease]" />
      <circle :cx="knob.x" :cy="knob.y" r="5" class="knob tw:[fill:var(--text-hi)] tw:[stroke:var(--accent)] tw:stroke-2 tw:[transition:cx_0.12s_ease,cy_0.12s_ease,r_0.12s] tw:[&.active]:[r:6]" :class="{ active: dragging }" />
      <text :x="cx" :y="cy - 8" class="val tw:[fill:var(--text)] tw:text-[12px] tw:font-bold tw:[text-anchor:middle] tw:tabular-nums tw:font-data">{{ text }}</text>
      <text :x="cx" :y="cy + 2" class="cap tw:[fill:var(--muted)] tw:text-[8px] tw:[text-anchor:middle]">последние</text>
    </svg>
  </div>
</template>
