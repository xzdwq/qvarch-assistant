<script setup lang="ts">
import { ref, watch } from 'vue'
import { remoteError } from '../../../shared/remoteError'
import Icon from './Icon.vue'
import type { HopSide } from '@shared/tabletHop'
import { useTablet, useTabletCanvas, useTabletLive } from '../lib/tablet'
import { provideBoard, type BoardCtx } from './board/boardContext'
import BoardToolbar from './board/BoardToolbar.vue'
import { FrameScheduler } from './board/frames'
import { BoardPainter } from './board/paint/boardPainter'
import { renderBoardPng } from './board/paint/boardPng'
import { MM_H, MM_W } from './board/paint/minimap'
import { PictureCache } from './board/paint/pictureCache'
import { createBoardScene } from './board/scene'
import { useBoardCanvas } from './board/useBoardCanvas'
import { useBoardDoc } from './board/useBoardDoc'
import { useBoardImages } from './board/useBoardImages'
import { useBoardKeys } from './board/useBoardKeys'
import { useBoardPointer } from './board/useBoardPointer'
import { useBoardViewport } from './board/useBoardViewport'
import { useFlashHint } from './board/useFlashHint'
import { useSelectionActions } from './board/useSelectionActions'
import { useTextEditor } from './board/useTextEditor'
import { useToolPrefs } from './board/useToolPrefs'

/**
 * Доска: an endless sheet in the notebook (a .qboard file). Ink: pen (pressure from the tablet run by Qvarch /
 * a real pen), marker; the eraser cuts out only what it touches (or whole lines); typed text; the selection
 * (a frame or a click) — move, scale, turn, delete, copy; pan & zoom (Ctrl+wheel; Shift / Alt + wheel, the hand,
 * Space, the middle / right button — the pen's side button); the wheel alone sizes the current tool; the paper
 * and its grid; a minimap; undo / redo (kept per board while the app runs); clear; PNG export.
 * The visible area is the tablet's "Qvarch canvas". The parts live in ./board: the document, the view, the
 * tools (a registry), the gestures, the painter.
 */
/**
 * `preview`: only shown — no tools, no input, always the whole board in view. `inline`: drawn on inside a note — the
 * plain wheel scrolls the note (Ctrl — zooms), its view its own; one of several surfaces the pen goes between.
 */
const props = defineProps<{ path: string; text: string; preview?: boolean; inline?: boolean }>()
const emit = defineEmits<{ change: [text: string]; info: [text: string]; warn: [text: string] }>()

if (!props.preview) useTabletLive()
const { state: tablet } = useTablet()

const frames = new FrameScheduler(
  () => canvas.paintAll(),
  () => canvas.paintLive(),
)
const scene = createBoardScene()
const pictures = new PictureCache(() => frames.schedule())
const painter = new BoardPainter(pictures)
const doc = useBoardDoc({
  props,
  frames,
  scene,
  onChange: (t) => emit('change', t),
  onInfo: (t) => emit('info', t),
  onReplaced: () => props.preview && viewport.fit(),
})
const viewport = useBoardViewport(props, () => doc.board.value.items, frames)
const tools = useToolPrefs(doc.board, tablet, frames, (c) => text.recolor(c))
// the template's elements
const sheet = ref<HTMLElement>()
const cv = ref<HTMLCanvasElement>()
const lv = ref<HTMLCanvasElement>()
const mm = ref<HTMLCanvasElement>()
const textEl = ref<HTMLTextAreaElement>()
const imgInput = ref<HTMLInputElement>()
const text = useTextEditor({ doc, viewport, tools, frames, sheet, textEl })
const hint = useFlashHint()
const warn = (e: unknown) => emit('warn', remoteError(e))
const local = (e: { clientX: number; clientY: number }) => {
  const r = sheet.value!.getBoundingClientRect()
  return [e.clientX - r.left, e.clientY - r.top] as const
}
const b: BoardCtx = { doc, viewport, tools, text, scene, frames, hint, pictures, sheet, local, warn }

// a preview in a note is no tablet surface
const canvasTarget = useTabletCanvas(props.preview ? ref<HTMLElement>() : sheet)
const canvas = useBoardCanvas(b, painter, !!props.preview, { cv, lv, mm })
const pointer = useBoardPointer(b, lv, () => canvasTarget.report(), { pageWheel: props.inline })
/** The pen about to come over from another board: a bar filling along the edge it comes in at. */
const hop = canvasTarget.hop
const HOP_BAR: Record<HopSide, (p: number) => Record<string, string>> = {
  left: (p) => ({ left: '0', top: '0', width: '4px', height: `${p * 100}%` }),
  right: (p) => ({ right: '0', top: '0', width: '4px', height: `${p * 100}%` }),
  top: (p) => ({ top: '0', left: '0', height: '4px', width: `${p * 100}%` }),
  bottom: (p) => ({ bottom: '0', left: '0', height: '4px', width: `${p * 100}%` }),
}
const images = useBoardImages(b, imgInput)
const actions = useSelectionActions(b, images)
const keys = useBoardKeys(b, actions, () => canvasTarget.isActive())

// the tool switched: what belonged to the previous one ends
watch(
  () => tools.tp.value.tool,
  (t) => {
    if (t !== 'text' && text.editing.value) text.finish()
    if (t !== 'select' && doc.sel.value.size) doc.sel.value = new Set()
    frames.schedule()
  },
)

/** The whole board as PNG (its pictures loaded first); undefined — the board is empty. */
async function pngBytes(): Promise<Uint8Array | undefined> {
  const blob = await renderBoardPng(doc.board.value, painter, pictures)
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
}
defineExpose({ pngBytes })
/** The board saved as a PNG file (where the user picks). */
async function exportPng(): Promise<void> {
  const blob = await renderBoardPng(doc.board.value, painter, pictures)
  if (blob === undefined) return void emit('info', 'Доска пуста — нечего сохранять')
  if (!blob) return
  const name = (props.path.split('/').pop() ?? 'Доска').replace(/\.qboard$/i, '') + '.png'
  const where = await window.qa.imageSave(new Uint8Array(await blob.arrayBuffer()), name, 'png')
  if (where) emit('info', 'Сохранено в PNG')
}
provideBoard({ ...b, actions, images, exportPng })

const { tp } = tools
const { editing, editStyle, onTextKey, finish: finishText } = text
const { dropping, onImagesPicked, onDragOver, onDragLeave, onDrop } = images
const { mmGo } = canvas
const { onDown, onMove, onUp, onLeave, onWheel, cursor } = pointer
const { onKey, onKeyUp } = keys
const sizeHint = hint.text
</script>

<template>
  <div class="bd tw:flex tw:flex-col tw:h-full tw:min-h-0">
    <BoardToolbar v-if="!props.preview" />

    <div v-if="props.preview" ref="sheet" class="sheet preview tw:relative tw:flex-1 tw:min-h-0 tw:overflow-hidden tw:outline-none tw:touch-none">
      <canvas class="tw:absolute tw:inset-0 tw:w-full tw:h-full" ref="cv"></canvas>
      <canvas class="tw:absolute tw:inset-0 tw:w-full tw:h-full" ref="lv"></canvas>
    </div>
    <div v-else ref="sheet" class="sheet tw:relative tw:flex-1 tw:min-h-0 tw:overflow-hidden tw:outline-none tw:touch-none tw:[&.dropping]:after:content-[''] tw:[&.dropping]:after:absolute tw:[&.dropping]:after:inset-8 tw:[&.dropping]:after:z-6 tw:[&.dropping]:after:border-2 tw:[&.dropping]:after:border-dashed tw:[&.dropping]:after:border-accent/80 tw:[&.dropping]:after:rounded-[10px] tw:[&.dropping]:after:bg-accent/6 tw:[&.dropping]:after:pointer-events-none" :class="{ dropping }" tabindex="0" :style="{ cursor }" @wheel="onWheel" @keydown="onKey" @keyup="onKeyUp" @contextmenu.prevent @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
      <input class="tw:[.chk_&]:[accent-color:var(--accent)]" ref="imgInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple hidden @change="onImagesPicked" />
      <canvas class="tw:absolute tw:inset-0 tw:w-full tw:h-full" ref="cv"></canvas>
      <canvas class="tw:absolute tw:inset-0 tw:w-full tw:h-full" ref="lv" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @pointerleave="onLeave"></canvas>
      <textarea
        v-if="editing"
        ref="textEl"
        v-model="editing.text"
        class="tedit tw:absolute tw:z-2 tw:min-w-30 tw:m-0 tw:p-0 tw:border-0 tw:outline-1 tw:outline-dashed tw:outline-accent/80 tw:outline-offset-3 tw:bg-transparent tw:resize-none tw:overflow-hidden tw:whitespace-pre tw:placeholder:text-accent/55"
        :style="editStyle"
        spellcheck="false"
        wrap="off"
        placeholder="Текст"
        @keydown="onTextKey"
        @blur="finishText"
        @pointerdown.stop
      ></textarea>
      <i v-if="hop" class="hopbar tw:absolute tw:z-5 tw:bg-accent tw:pointer-events-none tw:[box-shadow:0_0_10px_var(--accent)]" title="Ручка переходит на эту доску" :style="HOP_BAR[hop.from](hop.progress)"></i>
      <span v-if="sizeHint" class="hint tw:absolute tw:left-[50%] tw:top-10 tw:[transform:translateX(-50%)] tw:py-3 tw:px-10 tw:rounded-[4px] tw:bg-bg/82 tw:text-text tw:text-[12px] tw:pointer-events-none">{{ sizeHint }}</span>
      <div v-if="tp.minimap" class="mini tw:group/mini tw:absolute tw:right-10 tw:bottom-10 tw:z-3 tw:border tw:border-accent/45 tw:rounded-[4px] tw:overflow-hidden tw:[box-shadow:0_6px_18px_rgba(0,0,0,0.3)]" title="Миникарта: клик или перетаскивание — перейти">
        <canvas class="tw:inset-0 tw:w-full tw:h-full tw:static tw:block tw:cursor-pointer" ref="mm" :style="{ width: `${MM_W}px`, height: `${MM_H}px` }" @pointerdown.stop="mmGo" @pointermove="mmGo"></canvas>
        <button class="mx tw:[.zoom_&]:not-group-hover/mini:inline-flex tw:[.zoom_&]:items-center tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:text-[11.5px] tw:[.zoom_&]:hover:text-text tw:absolute tw:top-3 tw:right-3 tw:hidden tw:p-2 tw:border-0 tw:rounded-r2 tw:bg-black/55 tw:text-text-hi tw:group-hover/mini:inline-flex tw:hover:enabled:not-[.zoom_&]:bg-hover tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Скрыть миникарту" @click="tp.minimap = false"><Icon name="x" :size="10" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped src="./BoardView.css"></style>
