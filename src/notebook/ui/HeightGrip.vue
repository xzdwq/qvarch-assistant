<script setup lang="ts">
/** A block's bottom edge: dragged — the height of what it shows (shown at once, kept when let go), within its bounds. */
import { BLOCK_H } from '@nb/domain/blockInfo'

const props = defineProps<{ height: number }>()
const emit = defineEmits<{ drag: [px: number]; done: [px: number] }>()
const clamp = (h: number) => Math.round(Math.min(BLOCK_H.max, Math.max(BLOCK_H.min, h)))

function onDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const y0 = e.clientY
  const start = props.height
  let now = start
  const move = (m: PointerEvent) => {
    const h = clamp(start + m.clientY - y0)
    if (h !== now) emit('drag', (now = h))
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    if (now !== start) emit('done', now)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}
</script>

<template>
  <div class="tw:group/grip tw:flex tw:flex-none tw:items-center tw:justify-center tw:h-8 tw:cursor-ns-resize tw:select-none tw:touch-none" title="Потяните — выше или ниже" @pointerdown.prevent="onDown">
    <span class="tw:w-36 tw:h-3 tw:rounded-[2px] tw:bg-border-2 tw:group-hover/grip:bg-accent"></span>
  </div>
</template>
