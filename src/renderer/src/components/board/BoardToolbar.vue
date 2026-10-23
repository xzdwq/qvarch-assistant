<script setup lang="ts">
import { ref } from 'vue'
import Icon from '../Icon.vue'
import ZoomChip from '../ZoomChip.vue'
import { useBoard } from './boardContext'
import BoardBgPanel from './BoardBgPanel.vue'
import BoardToolButtons from './BoardToolButtons.vue'
import BoardToolOptions from './BoardToolOptions.vue'

/**
 * The board's toolbar (one line; narrow — the words go, the icons stay): the tools, the colour and size of the
 * current one, its options, the selection's actions, the background, the minimap, undo / redo, clear, zoom, PNG.
 */
const { doc, tools, viewport, actions, exportPng } = useBoard()
const { board, sel, canUndo, canRedo, undo, redo, clearAll } = doc
const { tp, sized, size, setSize, usesColor, palette, color, setColor, hasOptions } = tools
const { zoomPct, zoomAt } = viewport
const optBtn = ref<HTMLElement>()
const optOpen = ref(false)
const bgBtn = ref<HTMLElement>()
const bgOpen = ref(false)

/** A size preset's dot: as wide as the size (the eraser — a ring); the text — a letter that big. */
function presetStyle(s: number): Record<string, string> {
  if (tp.value.tool === 'text') return { fontSize: `${Math.min(17, 8 + s / 4)}px` }
  const d = `${Math.min(16, 3 + s * (tp.value.tool === 'eraser' ? 0.3 : 0.6))}px`
  return { width: d, height: d }
}
</script>

<template>
  <div class="bar tw:flex-none tw:flex tw:items-center tw:gap-6 tw:h-40 tw:py-0 tw:px-8 tw:border-b tw:border-b-border tw:whitespace-nowrap tw:overflow-hidden tw:@container">
    <BoardToolButtons />
    <span class="sep tw:flex-none tw:w-1 tw:h-20 tw:bg-border"></span>
    <span v-if="usesColor" class="cols tw:inline-flex tw:items-center tw:flex-none tw:gap-4 tw:py-0 tw:px-2">
      <button v-for="c in palette" :key="c" class="col tw:relative tw:w-18 tw:h-18 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-r1 tw:[box-shadow:0_0_0_1px_rgba(255,255,255,0.25)] tw:flex-none tw:[&.on]:border-accent-fg tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:not-[&.on]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:text-text tw:[&&]:@max-[620px]:nth-[n+4]:hidden tw:hover:enabled:not-[&.on]:not-[.zoom_&]:border-border-3" :class="{ on: color === c }" :style="{ background: c }" @click="setColor(c)"></button>
      <label class="col pick tw:relative tw:w-18 tw:h-18 tw:p-0 tw:border-2 tw:border-transparent tw:rounded-r1 tw:[box-shadow:0_0_0_1px_rgba(255,255,255,0.25)] tw:flex-none tw:[&.on]:border-accent-fg tw:overflow-hidden tw:[background:var(--swatch-wheel)] tw:cursor-pointer tw:@max-[620px]:nth-[n+4]:hidden" :class="{ on: !palette.includes(color) }" title="Свой цвет" :style="!palette.includes(color) ? { background: color } : undefined">
        <input class="tw:absolute tw:inset-0 tw:opacity-0 tw:cursor-pointer tw:[.chk_&]:[accent-color:var(--accent)]" type="color" :value="color" @input="setColor(($event.target as HTMLInputElement).value)" />
      </label>
    </span>
    <span v-if="sized" class="sizes tw:inline-flex tw:items-center tw:gap-2 tw:flex-none" title="Размер — колесом мыши над доской">
      <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:not-[&.on]:bg-white/6 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[&&]:[.zoom_&]:hover:text-text" v-for="s in sized.presets" :key="s" :class="{ on: size === s }" @click="setSize(s)">
        <i class="tw:block tw:rounded-[50%] tw:bg-current tw:not-italic tw:[&.eraser]:not-[&.tx]:bg-transparent tw:[&.eraser]:border-1.5 tw:[&.eraser]:border-current tw:[&.tx]:bg-transparent tw:[&.tx]:rounded-none tw:[&.tx]:font-semibold tw:[&.tx]:leading-none" :class="{ 'eraser': tp.tool === 'eraser', tx: tp.tool === 'text' }" :style="presetStyle(s)">{{ tp.tool === 'text' ? 'A' : '' }}</i>
      </button>
      <em class="sv tw:min-w-26 tw:text-muted tw:text-[11px] tw:not-italic tw:tabular-nums tw:font-data tw:@max-[760px]:hidden">{{ Math.round(size * 10) / 10 }}</em>
    </span>
    <button v-if="hasOptions" ref="optBtn" class="tbtn tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:[&&]:hover:enabled:bg-white/6 tw:[&&]:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-[&.on]:bg-transparent tw:[.zoom_&]:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :class="{ on: optOpen }" title="Параметры инструмента" @click="optOpen = !optOpen"><Icon name="settings" :size="14" /></button>
    <template v-if="tp.tool === 'select' && sel.size">
      <span class="selinfo tw:flex-none tw:text-accent-fg tw:text-[12px] tw:@max-[760px]:hidden">Выбрано: {{ sel.size }}</span>
      <button class="tbtn tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:enabled:bg-white/6 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Копия (Ctrl+D)" @click="actions.duplicate"><Icon name="copy" :size="15" /></button>
      <button class="tbtn danger tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:enabled:bg-white/6 tw:hover:text-down-fg tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11.5px] tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Удалить выделенное (Delete)" @click="actions.deleteSelected"><Icon name="trash" :size="15" /></button>
    </template>
    <span class="sep tw:flex-none tw:w-1 tw:h-20 tw:bg-border"></span>
    <button ref="bgBtn" class="tbtn tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:[&&]:hover:enabled:bg-white/6 tw:[&&]:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-[&.on]:bg-transparent tw:[.zoom_&]:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :class="{ on: bgOpen }" title="Фон и сетка" @click="bgOpen = !bgOpen"><Icon name="grid" :size="15" /><span class="lbl tw:@max-[760px]:hidden">Фон</span></button>
    <button class="tbtn tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:[&&]:hover:enabled:bg-white/6 tw:[&&]:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-[&.on]:bg-transparent tw:[.zoom_&]:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :class="{ on: tp.minimap }" title="Миникарта" @click="tp.minimap = !tp.minimap"><Icon name="map" :size="15" /></button>
    <span class="grow tw:flex-1"></span>
    <button class="tbtn tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:enabled:bg-white/6 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :disabled="!canUndo" title="Отменить (Ctrl+Z)" @click="undo"><Icon name="undo" :size="15" /></button>
    <button class="tbtn tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:enabled:bg-white/6 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :disabled="!canRedo" title="Повторить (Ctrl+Y)" @click="redo"><Icon name="redo" :size="15" /></button>
    <button class="tbtn tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:enabled:bg-white/6 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" :disabled="!board.items.length" title="Очистить всю доску" @click="clearAll"><Icon name="eraser" :size="15" /><span class="lbl tw:@max-[760px]:hidden">Всё</span></button>
    <ZoomChip class="tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:not-hover:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:text-text" :model-value="zoomPct" :min="10" :max="800" title="Масштаб доски · колесо — изменить, клик — 100% · Ctrl+0 — вписать всё" @update:model-value="(v) => zoomAt(v / zoomPct)" />
    <button class="tbtn tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:enabled:bg-white/6 tw:hover:enabled:text-text tw:disabled:opacity-35 tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:not-enabled:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Сохранить картинкой (PNG)" @click="exportPng"><Icon name="download" :size="15" /><span class="lbl tw:@max-[760px]:hidden">PNG</span></button>
    <BoardToolOptions v-model:open="optOpen" :anchor="optBtn" />
    <BoardBgPanel v-model:open="bgOpen" :anchor="bgBtn" />
  </div>
</template>
