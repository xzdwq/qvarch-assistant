<script setup lang="ts">
import { SHAPES, type ShapeKind } from '@shared/whiteboard'
import Popover from '../Popover.vue'
import { useBoard } from './boardContext'
import ShapeIcon from './ShapeIcon.vue'

/** The shape menu (a popover by its button): the basic shapes and those of schemes; a pick switches to the shape tool. */
defineProps<{ anchor?: HTMLElement }>()
const open = defineModel<boolean>('open', { required: true })
const { tools } = useBoard()
const tp = tools.tp
const GROUPS = [
  { id: 'basic', label: 'Основные' },
  { id: 'scheme', label: 'Схемы и архитектура' },
] as const

function chooseShape(k: ShapeKind): void {
  tp.value.shapeKind = k
  tp.value.tool = 'shape'
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open" :anchor="anchor" :width="236" align-left :chrome="40" max-height="none" class="bd-pop bd-shapes tw:pt-8 tw:pr-10 tw:pb-10 tw:pl-10 tw:border tw:border-white/10 tw:rounded-r3 tw:bg-panel tw:[box-shadow:0_16px_40px_rgba(0,0,0,0.5)] tw:text-text tw:text-[12px]">
      <div v-for="g in GROUPS" :key="g.id" class="shg tw:[.shg+&]:mt-6">
        <span class="bl tw:flex-none tw:w-58 tw:text-muted">{{ g.label }}</span>
        <div class="shgrid tw:grid tw:grid-cols-[repeat(6,1fr)] tw:gap-3 tw:mt-4">
          <button class="tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:not-[&.on]:text-text tw:inline-flex tw:items-center tw:justify-center tw:h-32 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-white/4 tw:text-text-2 tw:hover:not-[&.on]:bg-white/10 tw:[&.on]:bg-accent/25 tw:[&.on]:text-text-hi" v-for="s in SHAPES.filter((x) => x.group === g.id)" :key="s.kind" :class="{ on: tp.shapeKind === s.kind && tp.tool === 'shape' }" :title="s.label" @click="chooseShape(s.kind)">
            <ShapeIcon :kind="s.kind" :size="22" />
          </button>
        </div>
      </div>
  </Popover>
</template>
