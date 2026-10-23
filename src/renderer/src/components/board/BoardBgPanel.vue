<script setup lang="ts">
import { GRID_KINDS, PAPERS, type GridKind } from '@shared/whiteboard'
import Popover from '../Popover.vue'
import { cssHex } from '../../lib/cssColor'
import { useBoard } from './boardContext'

/** The background panel (a popover by its button): the paper's colour and texture, the grid, its step, brightness and major lines. */
defineProps<{ anchor?: HTMLElement }>()
const open = defineModel<boolean>('open', { required: true })
const { doc } = useBoard()
const { board, setBg } = doc
const GRID_LABELS: Record<GridKind, string> = { none: 'Нет', dots: 'Точки', lines: 'Линейка', squares: 'Клетка', iso: 'Изо' }
/** The papers with their colours (theme CSS; the one picked is saved into the board). */
const papers = PAPERS.map((p) => ({ ...p, color: cssHex(`--board-paper-${p.id}`) ?? '' }))
/** Every N-th grid line stronger (0 — none). */
const MAJORS = [0, 4, 5, 10]
/** A range / checkbox / colour input's value. */
const valueOf = (e: Event) => (e.target as HTMLInputElement).value
</script>

<template>
  <Popover v-model:open="open" :anchor="anchor" :width="280" :chrome="40" max-height="none" class="bd-bg tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:border tw:border-white/10 tw:rounded-r3 tw:bg-panel tw:[box-shadow:0_16px_40px_rgba(0,0,0,0.5)] tw:text-text tw:text-[12px]">
      <div class="bgr tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap">
        <span class="bl tw:flex-none tw:w-58 tw:text-muted">Бумага</span>
        <span class="papers tw:inline-flex tw:gap-6">
          <button v-for="p in papers" :key="p.id" class="paper tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:not-[&.on]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:text-text tw:relative tw:w-22 tw:h-22 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-r2 tw:[box-shadow:0_0_0_1px_rgba(255,255,255,0.2)] tw:[&.on]:border-accent tw:hover:enabled:not-[.zoom_&]:not-[&.on]:border-border-3" :class="{ on: board.bg.color === p.color }" :title="p.label" :style="{ background: p.color }" @click="setBg({ color: p.color })"></button>
          <label class="paper pick tw:overflow-hidden tw:[background:var(--swatch-wheel)] tw:cursor-pointer tw:relative tw:w-22 tw:h-22 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-r2 tw:[box-shadow:0_0_0_1px_rgba(255,255,255,0.2)]" title="Свой цвет"><input class="tw:absolute tw:inset-0 tw:opacity-0 tw:cursor-pointer tw:[.chk_&]:[accent-color:var(--accent)]" type="color" :value="board.bg.color" @change="setBg({ color: valueOf($event) })" /></label>
        </span>
      </div>
      <label class="bgr chk2 tw:text-text-2 tw:cursor-pointer tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap" title="Неровный тон и зерно; тушь ложится с просветами, сильный нажим продавливает бумагу"><input class="tw:[accent-color:var(--accent)]" type="checkbox" :checked="board.bg.texture === 'paper'" @change="setBg({ texture: ($event.target as HTMLInputElement).checked ? 'paper' : undefined })" />Фактурная бумага</label>
      <div class="bgr tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap">
        <span class="bl tw:flex-none tw:w-58 tw:text-muted">Сетка</span>
        <span class="seg tw:inline-flex tw:flex-wrap tw:gap-2 tw:p-2 tw:rounded-[4px] tw:bg-white/5">
          <button class="tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:hover:not-[&.on]:text-text tw:h-24 tw:py-0 tw:px-7 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi" v-for="g in GRID_KINDS" :key="g" :class="{ on: board.bg.grid === g }" @click="setBg({ grid: g })">{{ GRID_LABELS[g] }}</button>
        </span>
      </div>
      <template v-if="board.bg.grid !== 'none'">
        <label class="bgr tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap">
          <span class="bl tw:flex-none tw:w-58 tw:text-muted">Шаг</span>
          <input class="tw:flex-1 tw:min-w-0 tw:[accent-color:var(--accent)]" type="range" min="8" max="80" step="2" :value="board.bg.step" @change="setBg({ step: Number(valueOf($event)) })" />
          <em class="tw:w-34 tw:not-italic tw:text-right tw:text-text-2 tw:tabular-nums tw:font-data">{{ board.bg.step }}</em>
        </label>
        <label class="bgr tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap">
          <span class="bl tw:flex-none tw:w-58 tw:text-muted">Яркость</span>
          <input class="tw:flex-1 tw:min-w-0 tw:[accent-color:var(--accent)]" type="range" min="5" max="100" step="5" :value="Math.round(board.bg.opacity * 100)" @change="setBg({ opacity: Number(valueOf($event)) / 100 })" />
          <em class="tw:w-34 tw:not-italic tw:text-right tw:text-text-2 tw:tabular-nums tw:font-data">{{ Math.round(board.bg.opacity * 100) }}%</em>
        </label>
        <div v-if="board.bg.grid !== 'iso'" class="bgr tw:flex tw:items-center tw:gap-8 tw:my-6 tw:mx-0 tw:whitespace-nowrap">
          <span class="bl tw:flex-none tw:w-58 tw:text-muted">Крупная</span>
          <span class="seg tw:inline-flex tw:flex-wrap tw:gap-2 tw:p-2 tw:rounded-[4px] tw:bg-white/5">
            <button class="tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:hover:not-[&.on]:text-text tw:h-24 tw:py-0 tw:px-7 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[11.5px] tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi" v-for="m in MAJORS" :key="m" :class="{ on: board.bg.major === m }" @click="setBg({ major: m })">{{ m ? `каждая ${m}` : 'нет' }}</button>
          </span>
        </div>
      </template>
  </Popover>
</template>
