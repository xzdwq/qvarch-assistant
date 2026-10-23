<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import type { Placed } from '@shared/pdfPlacement'
import type { Placements } from './usePlacements'

/** A drawing on a page: dragged to move; selected — corner handles resize it, the knob turns it (double click — straight). */
const props = defineProps<{ it: Placed; selected: boolean; zoom: number; src: string; placements: Placements }>()
const { startMove, startSize, startRotate, update } = props.placements
const CORNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const
</script>

<template>
  <div
    class="it tw:absolute tw:cursor-move tw:[outline:1px_dashed_transparent] tw:origin-[50%_50%] tw:hover:not-[&.on]:outline-accent/60 tw:[&.on]:z-2 tw:[&.on]:[outline:1px_solid_var(--accent)]"
    :class="{ on: selected }"
    :style="{ left: `${it.x * zoom}px`, top: `${it.y * zoom}px`, width: `${it.w * zoom}px`, height: `${it.h * zoom}px`, transform: `rotate(${it.rot}deg)` }"
    @pointerdown.stop.prevent="startMove($event, it)"
  >
    <img class="tw:block tw:w-full tw:h-full tw:pointer-events-none tw:select-none" :src="src" alt="" draggable="false" :style="{ opacity: it.opacity }" />
    <template v-if="selected">
      <span
        v-for="[sx, sy] in CORNERS"
        :key="`${sx}${sy}`"
        class="hd tw:[.zoom_&]:min-w-40 tw:[.zoom_&]:text-center tw:[.zoom_&]:tabular-nums tw:[.zoom_&]:font-data tw:absolute tw:w-10 tw:h-10 tw:rounded-[50%] tw:bg-accent tw:[box-shadow:0_0_0_2px_var(--text-hi)] tw:[&.l]:-left-5 tw:[&.r]:-right-5 tw:[&.t]:-top-5 tw:[&.b]:-bottom-5 tw:[&.l]:[&.t]:not-[&.r]:not-[&.b]:cursor-nwse-resize tw:[&.r]:[&.b]:not-[&.t]:not-[&.l]:cursor-nwse-resize tw:[&.r]:[&.t]:cursor-nesw-resize tw:[&&]:[&.l]:[&.b]:cursor-nesw-resize"
        :class="[sx < 0 ? 'l' : 'r', sy < 0 ? 't' : 'b']"
        @pointerdown.stop.prevent="startSize($event, it, sx, sy)"
      ></span>
      <button class="rot tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:hover:text-text tw:absolute tw:top-[50%] tw:-right-38 tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:-mt-13 tw:p-0 tw:border-1.5 tw:border-accent tw:rounded-[50%] tw:bg-text-hi tw:text-accent tw:cursor-grab tw:hover:enabled:not-[.zoom_&]:bg-hover tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Повернуть (Shift — по 15°), двойной клик — ровно" @pointerdown.stop.prevent="startRotate($event, it)" @dblclick="update(it.id, { rot: 0 })">
        <Icon name="rotate" :size="13" />
      </button>
    </template>
  </div>
</template>
