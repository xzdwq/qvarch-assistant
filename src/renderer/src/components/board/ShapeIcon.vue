<script setup lang="ts">
import { computed } from 'vue'
import { isLineKind, shapeD, type ShapeKind } from '@shared/whiteboard'

/** A shape's icon: its outline in a 20×20 box (lines — a diagonal; the ellipse and the actor — upright). */
const props = defineProps<{ kind: ShapeKind; size: number }>()
const d = computed(() => {
  const k = props.kind
  if (isLineKind(k)) return shapeD(k, 20, 20, 1.5)
  return shapeD(k, k === 'actor' ? 14 : 20, k === 'ellipse' || k === 'actor' ? 20 : 15, 1.5)
})
</script>

<template>
  <svg class="tw:fill-none tw:stroke-[currentColor] tw:stroke-[1.5] tw:[stroke-linejoin:round] tw:[stroke-linecap:round]" viewBox="-3 -3 26 26" :width="size" :height="size"><path :d="d.d" /><path v-if="d.extra" :d="d.extra" /><path v-if="d.head" :d="d.head" /></svg>
</template>
