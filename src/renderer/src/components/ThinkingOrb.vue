<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MODE_FRAMES, paintFrame, resolvePreset, type OrbState } from 'thinking-orbs/engine'

/**
 * Thinking orb (thinking-orbs, MIT) — the framework-free engine drawn on a canvas. Light ink for the
 * dark island, optionally tinted. The `size` preset (64/32/20) is a tuned design; `px` is the CSS size
 * it is drawn at (the frame is scaled to it).
 */
const props = withDefaults(defineProps<{ state: OrbState; size?: 64 | 32 | 20; px?: number; speed?: number; tint?: string }>(), {
  size: 32,
  speed: 1,
})

const canvas = ref<HTMLCanvasElement>()
let raf = 0

function parseTint(c?: string): { r: number; g: number; b: number } | undefined {
  const m = c?.match(/^#([0-9a-f]{6})$/i)
  if (!m) return undefined
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function start(): void {
  cancelAnimationFrame(raf)
  const el = canvas.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return
  const css = props.px ?? props.size
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  el.width = Math.round(css * dpr)
  el.height = Math.round(css * dpr)
  const { mode, speed, opts } = resolvePreset(props.state, props.size)
  const frameFn = MODE_FRAMES[mode]
  const tint = parseTint(props.tint)
  const k = (css / props.size) * dpr
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const draw = (t: number) => {
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.clearRect(0, 0, props.size, props.size)
    paintFrame(ctx, frameFn(props.size, t, opts), true, tint)
  }
  if (reduced) return draw(0.6)
  // ~30 fps is plenty for a 40px orb on an always-on-top window — half the work of every frame
  let last = 0
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    if (now - last < 32 || document.visibilityState === 'hidden') return
    last = now
    draw((now / 1000) * speed * props.speed)
  }
  draw((performance.now() / 1000) * speed * props.speed)
  raf = requestAnimationFrame(loop)
}

onMounted(start)
watch(() => [props.state, props.size, props.px, props.speed, props.tint], start)
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <canvas ref="canvas" class="orb tw:block" role="img" :style="{ width: `${px ?? size}px`, height: `${px ?? size}px` }"></canvas>
</template>
