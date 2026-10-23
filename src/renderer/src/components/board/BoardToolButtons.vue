<script setup lang="ts">
import { ref } from 'vue'
import { SHAPES } from '@shared/whiteboard'
import Icon from '../Icon.vue'
import { useBoard } from './boardContext'
import BoardShapeMenu from './BoardShapeMenu.vue'
import ShapeIcon from './ShapeIcon.vue'

/** The toolbar's tools: selection, pen, ink pen, marker, shape snapping, eraser, text, shapes (with their menu), hand, picture. */
const { tools, images } = useBoard()
const tp = tools.tp
const shapeBtn = ref<HTMLElement>()
const shapesOpen = ref(false)
const shapeLabel = () => SHAPES.find((s) => s.kind === tp.value.shapeKind)?.label

/** The shapes button: the shape tool on, its menu toggled. */
function pickShapes(): void {
  if (tp.value.tool !== 'shape') tp.value.tool = 'shape'
  shapesOpen.value = !shapesOpen.value
}
</script>

<template>
  <span class="tools tw:inline-flex tw:items-center tw:gap-2 tw:flex-none">
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:not-[&.on]:bg-white/6 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[&&]:[.zoom_&]:hover:text-text" :class="{ on: tp.tool === 'select' }" title="Выделение (V): рамка или клик; тянуть — перенести, углы — масштаб, кружок — поворот, Delete — удалить" @click="tp.tool = 'select'"><Icon name="pointer" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:not-[&.on]:bg-white/6 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[&&]:[.zoom_&]:hover:text-text" :class="{ on: tp.tool === 'pen' }" title="Перо (P)" @click="tp.tool = 'pen'"><Icon name="pencil" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:not-[&.on]:bg-white/6 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[&&]:[.zoom_&]:hover:text-text" :class="{ on: tp.tool === 'nib' }" title="Перо для туши (B): ширина — от направления штриха и наклона пера; Alt — прямая" @click="tp.tool = 'nib'"><Icon name="penTool" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:not-[&.on]:bg-white/6 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[&&]:[.zoom_&]:hover:text-text" :class="{ on: tp.tool === 'marker' }" title="Маркер (M)" @click="tp.tool = 'marker'"><Icon name="highlighter" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:not-[&.on]:bg-white/6 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[&&]:[.zoom_&]:hover:text-text"
      :class="{ on: tp.snapShapes }"
      :title="tp.snapShapes ? 'Дорисовка фигур включена: нарисуйте круг, прямоугольник, ромб, треугольник или линию и задержите перо в конце — фигура станет ровной (двиньте дальше — линия останется как есть). Нажмите — выключить' : 'Дорисовка фигур выключена — нажмите, чтобы включить'"
      @click="tp.snapShapes = !tp.snapShapes"
    ><Icon name="sparkles" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:not-[&.on]:bg-white/6 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[&&]:[.zoom_&]:hover:text-text" :class="{ on: tp.tool === 'eraser' }" title="Ластик (E): стирает то, чего касается" @click="tp.tool = 'eraser'"><Icon name="eraser" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:not-[&.on]:bg-white/6 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[&&]:[.zoom_&]:hover:text-text" :class="{ on: tp.tool === 'text' }" title="Текст (T): клик — новый, клик по тексту — править, тянуть — двигать" @click="tp.tool = 'text'"><span class="tt tw:font-[Georgia,serif] tw:text-[15px] tw:font-semibold tw:leading-none">T</span></button>
    <button ref="shapeBtn" class="shb tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:not-[&.on]:bg-white/6 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[&&]:[.zoom_&]:hover:text-text" :class="{ on: tp.tool === 'shape' }" :title="`Фигуры (S): ${shapeLabel()}. Тянуть — размер, Shift — ровно`" @click="pickShapes">
      <ShapeIcon :kind="tp.shapeKind" :size="15" />
      <Icon class="tw:fill-none tw:stroke-[currentColor] tw:stroke-[1.5] tw:[stroke-linejoin:round] tw:[stroke-linecap:round]" name="chevronDown" :size="10" />
    </button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:not-[&.on]:bg-white/6 tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-text-hi tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:not-[&.on]:bg-transparent tw:[.zoom_&]:not-hover:not-[&.on]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[&&]:[.zoom_&]:hover:text-text" :class="{ on: tp.tool === 'hand' }" title="Рука (H, или пробел, или средняя / правая кнопка)" @click="tp.tool = 'hand'"><Icon name="hand" :size="15" /></button>
    <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:min-w-28 tw:py-0 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:flex-none tw:hover:bg-white/6 tw:hover:text-text tw:[.zoom_&]:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:text-text" title="Изображение — или вставьте из буфера (Ctrl+V), или перетащите файл на доску. Рисовать можно поверх него" @click="images.pickImages"><Icon name="image" :size="15" /></button>
    <BoardShapeMenu v-model:open="shapesOpen" :anchor="shapeBtn" />
  </span>
</template>
