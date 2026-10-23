<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BlockKind } from '@nb/domain/blockSpec'
import type { LoopOutMode } from '@nb/domain/blockInfo'
import { BLOCK_SPECS, isRunnableKind } from '@nb/blocks/specs'
import { joinFence, splitFence } from '@nb/domain/fence'
import { blockRunKey } from '@nb/domain/noteBlocks'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { besidePlace } from '@renderer/lib/usePopover'
import LoopOut from './LoopOut.vue'
import { BLOCK_VIEWS } from './blockViews'
import { pickHostProps } from './blockView'

/**
 * A component of a note as the editor shows it: the kind's view (from the registry) and, on the left on hover, its
 * handle — dragged, it moves the component in the note; clicked — copy, duplicate, the Markdown it keeps (to see /
 * edit as text), delete. (The hover area takes the handle in: the mouse on its way there does not lose it.)
 */
const props = defineProps<{
  kind: BlockKind
  src: string
  headings: Array<{ level: number; text: string; pos: number }>
  /** The note (its run context) and the block's first line (an unnamed block's key). */
  path: string
  line: number
  autofocus?: boolean
  onChange: (src: string) => void
  onRemove: () => void
  onGo: (pos: number) => void
  onExit: (dir: 1 | -1) => void
  onDrag: (e: PointerEvent) => void
  onDuplicate: () => void
  onTranscribe?: (rel: string) => void
  onDropAudio?: (rel: string) => void
  /** The loop it is in (its key): its results over the passes shown under it. */
  loop?: string
}>()
const spec = computed(() => BLOCK_SPECS[props.kind])
const view = computed(() => BLOCK_VIEWS[props.kind])
/** The props the kind's component takes. */
const viewProps = computed(() =>
  pickHostProps(view.value, {
    src: props.src,
    path: props.path,
    line: props.line,
    autofocus: props.autofocus,
    headings: props.headings,
    inLoop: !!props.loop,
    onChange: props.onChange,
    onExit: props.onExit,
    onGo: props.onGo,
    onTranscribe: props.onTranscribe,
    onDropAudio: props.onDropAudio,
  }),
)
const copied = ref(false)
/** The handle's menu: a popover by the handle it opened from. */
const menu = ref(false)
const menuAnchor = ref<HTMLElement>()
const menuPlace = besidePlace(230, 200)
const raw = ref<string>()
/** The handle: a click opens the menu, a drag moves the component. */
function onHandleDown(e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  const btn = e.currentTarget as HTMLElement
  const x0 = e.clientX
  const y0 = e.clientY
  let dragging = false
  const move = (ev: PointerEvent) => {
    if (dragging || Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
    dragging = true
    cleanup()
    menu.value = false
    props.onDrag(ev)
  }
  const up = () => {
    cleanup()
    if (dragging) return
    menuAnchor.value = btn
    menu.value = !menu.value
  }
  const cleanup = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
/** The handle menu's actions. */
const HANDLE_ACTIONS = {
  raw: () => {
    raw.value = props.src
  },
  copy: () => {
    // as Markdown: pasted into a note it is the same component again
    void navigator.clipboard.writeText(`${props.src}\n`)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  },
  dup: () => props.onDuplicate(),
  del: () => props.onRemove(),
} satisfies Record<string, () => void>
function act(what: keyof typeof HANDLE_ACTIONS): void {
  menu.value = false
  HANDLE_ACTIONS[what]()
}
/** A runnable block in a loop: its kind and key (the bar of its passes under it). */
const inLoop = computed(() => {
  const kind = props.kind
  if (!props.loop || !isRunnableKind(kind)) return undefined
  const info = splitFence(props.src).info
  return info.lib ? undefined : { kind, key: blockRunKey(info.name, kind, props.line), name: info.name, out: info.out }
})
/** How the block's results over the passes are shown (kept in its info line: out=). */
function setOut(out: LoopOutMode | undefined): void {
  const p = splitFence(props.src)
  props.onChange(joinFence(p.fence, { ...p.info, out }, p.body))
}
function applyRaw(): void {
  if (raw.value !== undefined && raw.value !== props.src) props.onChange(raw.value)
  raw.value = undefined
}
</script>

<template>
  <div class="nb tw:group/nb tw:contain-[inline-size] tw:min-w-0 tw:relative tw:mt-4 tw:mr-0 tw:mb-4 tw:-ml-30 tw:pl-32 tw:text-[0.95em] tw:leading-[1.5] tw:whitespace-normal tw:cursor-auto" :class="`k-${kind}`">
    <button class="nb-h tw:absolute tw:top-4 tw:left-4 tw:touch-none tw:z-250 tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:opacity-40 tw:cursor-grab tw:[transition:opacity_0.12s] tw:group-hover/nb:not-group-focus-within/nb:opacity-100 tw:group-focus-within/nb:opacity-100 tw:[&.on]:not-group-hover/nb:not-group-focus-within/nb:not-hover:not-active:opacity-100 tw:hover:not-group-hover/nb:not-group-focus-within/nb:not-active:opacity-100 tw:active:not-group-hover/nb:not-group-focus-within/nb:opacity-100 tw:hover:not-active:bg-hover tw:active:bg-hover tw:hover:not-active:text-text tw:active:text-text tw:hover:enabled:border-border-3" :class="{ on: menu }" :title="`${spec.title}: потяните — переместить, клик — меню`" @pointerdown="onHandleDown"><Icon name="grip" :size="14" /></button>
    <span v-if="copied" class="nb-ok tw:absolute tw:z-4 tw:-top-18 tw:left-32 tw:text-up-fg tw:text-[11.5px]">Скопировано — вставьте в любую заметку</span>
    <div v-if="raw !== undefined" class="nb-raw tw:flex tw:flex-col tw:gap-6 tw:p-8 tw:border tw:border-accent/50 tw:rounded-[8px] tw:bg-panel">
      <div class="nb-rh tw:flex tw:items-center tw:gap-8 tw:text-[12px]"><b class="tw:text-text-2 tw:font-semibold">{{ spec.title }} — Markdown</b><span class="grow tw:flex-1"></span><button @mousedown.prevent @click="raw = undefined">Отмена</button><button class="primary" @mousedown.prevent @click="applyRaw">Готово</button></div>
      <textarea class="tw:min-h-80 tw:p-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:font-data tw:text-[12.5px] tw:leading-[1.5] tw:field-sizing-content tw:resize-none tw:outline-none" v-model="raw" spellcheck="false" @keydown.ctrl.enter.prevent="applyRaw" @keydown.esc.prevent="raw = undefined"></textarea>
    </div>
    <component :is="view.component" v-else v-bind="viewProps" />
    <LoopOut v-if="inLoop && raw === undefined" :path="path" :loop-key="loop!" :kind="inLoop.kind" :block-key="inLoop.key" :name="inLoop.name" :out="inLoop.out" :on-mode="setOut" />
    <Popover v-model:open="menu" :anchor="menuAnchor" :place="menuPlace" class="nb-menu tw:fixed tw:z-5000 tw:flex tw:flex-col tw:w-230 tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-hover" @click="act('copy')"><Icon name="copy" :size="13" />Копировать</button>
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-hover" @click="act('dup')"><Icon name="layers" :size="13" />Дублировать</button>
        <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-hover" v-if="spec.rawEditable" @click="act('raw')"><Icon name="code" :size="13" />Изменить как Markdown</button>
        <hr class="tw:my-4 tw:mx-0 tw:border-0 tw:[&&]:border-t tw:[&&]:border-t-border" />
        <button class="danger tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-[12.5px] tw:text-left tw:hover:bg-hover tw:text-down-fg" @click="act('del')"><Icon name="trash" :size="13" />Удалить {{ spec.title.toLowerCase() }}</button>
    </Popover>
  </div>
</template>
