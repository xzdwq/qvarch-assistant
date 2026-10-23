<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import { barPosition, type Placed } from '@shared/pdfPlacement'
import type { Placements } from './usePlacements'
import { cssPalette } from '../../lib/cssPalette'

/** The selected drawing's toolbar above it: colour (its own, three inks, any), opacity, copy, remove. */
const props = defineProps<{ sel: Placed; zoom: number; placements: Placements }>()
const { setTint, setOpacity, duplicate, removeItem } = props.placements
// the same ink swatches as the signature pad (theme CSS); the tint picked is saved with the placement
const TINTS = cssPalette('--sign-ink')
</script>

<template>
  <div class="tb tw:absolute tw:z-3 tw:flex tw:items-center tw:gap-6 tw:h-36 tw:py-0 tw:px-8 tw:[transform:translateX(-50%)] tw:border tw:border-accent/55 tw:rounded-[4px] tw:bg-text-hi tw:[box-shadow:0_6px_18px_rgba(0,0,0,0.25)] tw:text-panel-3 tw:whitespace-nowrap" :style="barPosition(sel, zoom)" @pointerdown.stop>
    <span class="tcols tw:[.zoom_&]:min-w-40 tw:[.zoom_&]:text-center tw:[.zoom_&]:tabular-nums tw:[.zoom_&]:font-data tw:inline-flex tw:items-center tw:gap-5">
      <button class="tc orig tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:not-[&.on]:border-0 tw:[.zoom_&]:text-muted tw:[.zoom_&]:hover:text-text tw:relative tw:w-18 tw:h-18 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-[50%] tw:[box-shadow:inset_0_0_0_1px_rgba(0,0,0,0.12)] tw:[&.on]:border-accent tw:[background:linear-gradient(135deg,var(--text-hi)_45%,var(--down)_45%,var(--down)_55%,var(--text-hi)_55%)] tw:hover:enabled:not-[.zoom_&]:not-[&.on]:border-border-3" :class="{ on: !sel.tint }" title="Исходный цвет" @click="setTint(undefined)"></button>
      <button v-for="c in TINTS" :key="c" class="tc tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:not-[&.on]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:hover:text-text tw:relative tw:w-18 tw:h-18 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-[50%] tw:[box-shadow:inset_0_0_0_1px_rgba(0,0,0,0.12)] tw:[&.on]:border-accent tw:hover:enabled:not-[.zoom_&]:not-[&.on]:border-border-3" :class="{ on: sel.tint === c }" :style="{ background: c }" @click="setTint(c)"></button>
      <label class="tc pick tw:relative tw:w-18 tw:h-18 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-[50%] tw:[box-shadow:inset_0_0_0_1px_rgba(0,0,0,0.12)] tw:[&.on]:border-accent tw:overflow-hidden tw:[background:var(--swatch-wheel)] tw:cursor-pointer" :class="{ on: !!sel.tint && !TINTS.includes(sel.tint) }" title="Свой цвет" :style="sel.tint && !TINTS.includes(sel.tint) ? { background: sel.tint } : undefined">
        <input class="tw:absolute tw:inset-0 tw:opacity-0 tw:cursor-pointer" type="color" :value="sel.tint ?? TINTS[1]" @input="setTint(($event.target as HTMLInputElement).value)" />
      </label>
    </span>
    <span class="sep tw:[.zoom_&]:min-w-40 tw:[.zoom_&]:text-center tw:[.zoom_&]:tabular-nums tw:[.zoom_&]:font-data tw:w-1 tw:h-20 tw:bg-text"></span>
    <span class="op tw:[.zoom_&]:min-w-40 tw:[.zoom_&]:text-center tw:[.zoom_&]:tabular-nums tw:[.zoom_&]:font-data tw:inline-flex tw:items-center tw:gap-4 tw:text-border-3" title="Непрозрачность, %">
      <Icon name="opacity" :size="14" />
      <input class="tw:w-52 tw:h-24 tw:py-0 tw:px-4 tw:border tw:border-text-2 tw:rounded-r2 tw:bg-text-hi tw:text-panel tw:text-[12.5px] tw:text-center" type="number" min="5" max="100" step="5" :value="Math.round(sel.opacity * 100)" @input="setOpacity(Number(($event.target as HTMLInputElement).value))" />
    </span>
    <span class="sep tw:[.zoom_&]:min-w-40 tw:[.zoom_&]:text-center tw:[.zoom_&]:tabular-nums tw:[.zoom_&]:font-data tw:w-1 tw:h-20 tw:bg-text"></span>
    <button class="tbb tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:hover:text-text tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-border-3 tw:hover:bg-text-hi tw:hover:text-panel tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Копия (Ctrl+D)" @click="duplicate(sel)"><Icon name="copy" :size="14" /></button>
    <button class="tbb tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:hover:text-text tw:inline-flex tw:p-5 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-border-3 tw:hover:bg-text-hi tw:hover:text-panel tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Убрать (Delete)" @click="removeItem(sel.id)"><Icon name="trash" :size="14" /></button>
  </div>
</template>
