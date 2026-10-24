<script setup lang="ts">
/** A chat's bottom edge: dragged — its height a whole line at a time (shown at once, kept when let go). */
import { rowsAfterDrag } from './model'

const props = defineProps<{ rows: number }>()
const emit = defineEmits<{ drag: [rows: number]; done: [rows: number] }>()

function onDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const y0 = e.clientY
  const start = props.rows
  let now = start
  const move = (m: PointerEvent) => {
    const n = rowsAfterDrag(start, m.clientY - y0)
    if (n !== now) emit('drag', (now = n))
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
