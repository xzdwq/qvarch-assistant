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
import { blockActionsFor, type BlockActionId, type BlockCaps } from '@nb/commands/blockActions'
import type { BlockSelectHow } from '@nb/editor/components/blockSelection'
import BlockOrigin from './BlockOrigin.vue'
import LoopOut from './LoopOut.vue'
import { BLOCK_VIEWS } from './blockViews'
import { pickHostProps } from './blockView'

/**
 * A component of a note as the editor shows it: the kind's view (from the registry) and, on the left on hover, its
 * handle — dragged, it moves the component in the note; clicked — its menu (what the block can do: run, copy,
 * duplicate, the Markdown it keeps, delete); Ctrl / Shift + click — chosen with others, the menu then acts on all of
 * them. (The hover area takes the handle in: the mouse on its way there does not lose it.)
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
  onGo: (pos: number) => void
  onExit: (dir: 1 | -1) => void
  onDrag: (e: PointerEvent) => void
  /** Chosen with others (Ctrl / Shift + click on the handles): the menu acts on all of them. */
  selected: boolean
  onSelect: (how: BlockSelectHow) => void
  /** An action of the menu done by the editor (on this block, or on all the chosen ones). */
  onAction: (id: Exclude<BlockActionId, 'raw'>) => void
  /** What the blocks the menu acts on can do together (asked when it opens). */
  targetCaps: () => BlockCaps
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
const menuPlace = besidePlace(260, 220)
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
  const up = (ev: PointerEvent) => {
    cleanup()
    if (dragging) return
    // Ctrl — one more / one less chosen, Shift — all from the last chosen; a plain click — this block's menu
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return props.onSelect(ev.shiftKey ? 'range' : 'toggle')
    if (!props.selected) props.onSelect('clear')
    menuAnchor.value = btn
    actions.value = blockActionsFor(props.targetCaps(), spec.value.title)
    menu.value = !menu.value
  }
  const cleanup = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
/** The menu's lines: what the blocks it acts on allow (made when it opens). */
const actions = ref<ReturnType<typeof blockActionsFor>>([])
/** An action of the menu: «as Markdown» — here; the rest — by the editor (copied — said so). */
function act(id: BlockActionId): void {
  menu.value = false
  if (id === 'raw') return void (raw.value = props.src)
  props.onAction(id)
  if (id !== 'copy') return
  copied.value = true
  setTimeout(() => (copied.value = false), 1400)
}
/** A runnable block in a loop: its kind and key (the bar of its passes under it). */
const inLoop = computed(() => {
  const kind = props.kind
  if (!props.loop || !isRunnableKind(kind)) return undefined
  const info = splitFence(props.src).info
  return info.lib ? undefined : { kind, key: blockRunKey(info.name, kind, props.line, info.id), name: info.name, out: info.out }
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
  <div class="nb tw:group/nb tw:contain-[inline-size] tw:min-w-0 tw:relative tw:mt-4 tw:mr-0 tw:mb-4 tw:-ml-30 tw:pl-32 tw:text-[0.95em] tw:leading-[1.5] tw:whitespace-normal tw:cursor-auto tw:rounded-[8px] tw:[&.sel]:bg-accent/8 tw:[&.sel]:[box-shadow:inset_0_0_0_1px_rgb(var(--accent-rgb)/0.45)]" :class="[`k-${kind}`, { sel: selected }]">
    <button class="nb-h tw:absolute tw:top-4 tw:left-4 tw:touch-none tw:z-250 tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:opacity-40 tw:cursor-grab tw:[transition:opacity_0.12s] tw:group-hover/nb:not-group-focus-within/nb:opacity-100 tw:group-focus-within/nb:opacity-100 tw:[&.on]:not-group-hover/nb:not-group-focus-within/nb:not-hover:not-active:opacity-100 tw:hover:not-group-hover/nb:not-group-focus-within/nb:not-active:opacity-100 tw:active:not-group-hover/nb:not-group-focus-within/nb:opacity-100 tw:hover:not-active:bg-hover tw:active:bg-hover tw:hover:not-active:text-text tw:active:text-text tw:hover:enabled:border-border-3" :class="{ on: menu }" :title="`${spec.title}: потяните — переместить, клик — меню`" @pointerdown="onHandleDown"><Icon name="grip" :size="14" /></button>
    <span v-if="copied" class="nb-ok tw:absolute tw:z-4 tw:-top-18 tw:left-32 tw:text-up-fg tw:text-[11.5px]">Скопировано — вставьте в любую заметку</span>
    <BlockOrigin :path="path" :line="line" />
    <div v-if="raw !== undefined" class="nb-raw tw:flex tw:flex-col tw:gap-6 tw:p-8 tw:border tw:border-accent/50 tw:rounded-[8px] tw:bg-panel">
      <div class="nb-rh tw:flex tw:items-center tw:gap-8 tw:text-[12px]"><b class="tw:text-text-2 tw:font-semibold">{{ spec.title }} — Markdown</b><span class="grow tw:flex-1"></span><button @mousedown.prevent @click="raw = undefined">Отмена</button><button class="primary" @mousedown.prevent @click="applyRaw">Готово</button></div>
      <textarea class="tw:min-h-80 tw:p-8 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-text tw:font-data tw:text-[12.5px] tw:leading-[1.5] tw:field-sizing-content tw:resize-none tw:outline-none" v-model="raw" spellcheck="false" @keydown.ctrl.enter.prevent="applyRaw" @keydown.esc.prevent="raw = undefined"></textarea>
    </div>
    <component :is="view.component" v-else v-bind="viewProps" />
    <LoopOut v-if="inLoop && raw === undefined" :path="path" :loop-key="loop!" :kind="inLoop.kind" :block-key="inLoop.key" :name="inLoop.name" :out="inLoop.out" :on-mode="setOut" />
    <Popover v-model:open="menu" :anchor="menuAnchor" :place="menuPlace" class="nb-menu tw:fixed tw:z-5000 tw:flex tw:flex-col tw:w-260 tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
        <template v-for="a in actions" :key="a.id">
          <hr v-if="a.danger" class="tw:my-4 tw:mx-0 tw:border-0 tw:[&&]:border-t tw:[&&]:border-t-border" />
          <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:bg-hover tw:[&.danger]:text-down-fg" :class="{ danger: a.danger }" @click="act(a.id)"><Icon :name="a.icon" :size="13" />{{ a.label }}</button>
        </template>
        <p class="tw:m-0 tw:pt-4 tw:px-8 tw:pb-2 tw:text-muted tw:text-[11px]">Ctrl / Shift + клик по ручке — выбрать несколько</p>
    </Popover>
  </div>
</template>
