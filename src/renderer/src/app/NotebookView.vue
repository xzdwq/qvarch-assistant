<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { isBoard } from '@shared/whiteboard'
import NotebookHelp from '../components/NotebookHelp.vue'
import EventModal from '../components/EventModal.vue'
import EventCard from '../components/EventCard.vue'
import RefCardPop from '../components/RefCardPop.vue'
import EmojiPick from '../components/EmojiPick.vue'
import Popover from '../components/Popover.vue'
import { atPoint, openWhile } from '../lib/usePopover'
import { useTablet } from '../lib/tablet'
import { closeTab, doc, files, layout, loadTree, onOutside, openFile, saveAll } from '../lib/notebook'
import { provideNotebookScreen } from '@nb/screen/notebookScreen'
import NoteSidebar from '@nb/screen/NoteSidebar.vue'
import NotePane from '@nb/screen/NotePane.vue'
import NoteVarsPanel from '@nb/screen/NoteVarsPanel.vue'
import TreeMenu from '@nb/screen/TreeMenu.vue'

/**
 * Блокнот — Markdown notes like in Obsidian: sections (folders) on the left, tabs, two notes side by side,
 * search through everything, voice recordings right in a note (transcribed locally). Saved while typing.
 * The screen's state and actions: @nb/screen/notebookScreen; its parts: @nb/screen/*.vue.
 */
const { toast, actions, events, vars, menu, images, helpOpen } = provideNotebookScreen()
const { msg } = toast
const { eventText, onEventMade, evCard, refCard } = events
const { varsOpen } = vars
const { treeMenu, emojiFor } = menu
/** The whole emoji list for a node: a popover where the tree's menu was. */
const emojiOpen = openWhile(emojiFor)
const { setImageInput, onImagesPicked } = images

onMounted(async () => {
  await loadTree()
  // tabs remembered from last time: gone files close, the rest load
  const all = new Set(files.value)
  for (let i = layout.panes.length - 1; i >= 0; i--) for (const t of [...layout.panes[i].tabs]) (all.has(t.path) ? doc(t.path) : closeTab(i, t.path))
  if (!layout.panes.some((p) => p.tabs.length) && files.value.length) openFile(files.value[0])
})
const offVault = window.qa.onVault((paths) => void onOutside(paths))
onBeforeUnmount(() => {
  offVault()
  void saveAll()
})

/**
 * The tablet drawing on a board («Полотно Qvarch»): only the board takes the pen — the width handles next to it
 * (the side's, the panes') are off, a stroke near the edge never grabs them.
 */
const { state: tabletState } = useTablet()
const penOnly = computed(() => {
  const t = tabletState.value
  return t?.status.state === 'connected' && t.prefs.target.kind === 'canvas' && layout.panes.some((p) => !!p.active && isBoard(p.active))
})
// pane / side widths
function dragWidth(e: PointerEvent, apply: (dx: number) => void): void {
  const x0 = e.clientX
  const move = (ev: PointerEvent) => apply(ev.clientX - x0)
  const up = () => {
    window.removeEventListener('pointermove', move)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'col-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up, { once: true })
}
function onSideResize(e: PointerEvent): void {
  const w0 = layout.side
  dragWidth(e, (dx) => (layout.side = Math.min(520, Math.max(180, w0 + dx))))
}
const panesEl = ref<HTMLElement>()
function onSplitResize(e: PointerEvent): void {
  const s0 = layout.split
  const w = panesEl.value?.clientWidth ?? 1000
  dragWidth(e, (dx) => (layout.split = Math.min(0.8, Math.max(0.2, s0 + dx / w))))
}
</script>

<template>
  <div class="nb tw:flex tw:h-full tw:min-h-0 tw:bg-bg">
    <!-- sections & files / search -->
    <NoteSidebar v-if="!layout.sideHidden" />
    <div v-if="!layout.sideHidden" class="nresize tw:flex-none tw:w-5 tw:cursor-col-resize tw:bg-border tw:[&&]:bg-clip-content tw:py-0 tw:px-2 tw:my-0 tw:-mx-2 tw:z-2 tw:[transition:background-color_0.12s] tw:hover:[&:not(.locked)]:bg-accent/85 tw:[&.locked]:w-1 tw:[&.locked]:m-0 tw:[&.locked]:p-0 tw:[&.locked]:cursor-default tw:[&.locked]:pointer-events-none" :class="{ locked: penOnly }" :title="penOnly ? 'Планшет рисует на доске — ширина панели не меняется' : undefined" @pointerdown.prevent="!penOnly && onSideResize($event)"></div>

    <!-- one or two panes of tabs -->
    <div ref="panesEl" class="npanes tw:relative tw:flex-1 tw:min-w-0 tw:flex">
      <template v-for="(p, pi) in layout.panes" :key="p.id">
        <div v-if="pi" class="psplit tw:flex-none tw:w-5 tw:cursor-col-resize tw:bg-border tw:[&&]:bg-clip-content tw:py-0 tw:px-2 tw:my-0 tw:-mx-2 tw:z-2 tw:[transition:background-color_0.12s] tw:hover:[&:not(.locked)]:bg-accent/85 tw:[&.locked]:w-1 tw:[&.locked]:m-0 tw:[&.locked]:p-0 tw:[&.locked]:cursor-default tw:[&.locked]:pointer-events-none" :class="{ locked: penOnly }" :title="penOnly ? 'Планшет рисует на доске — ширина не меняется' : 'Потяните — ширина'" @pointerdown.prevent="!penOnly && onSplitResize($event)"></div>
        <NotePane :p="p" :pi="pi" />
      </template>
      <Transition name="fade"><div v-if="msg" class="toast tw:absolute tw:left-[50%] tw:bottom-40 tw:[transform:translateX(-50%)] tw:py-8 tw:px-14 tw:rounded-[4px] tw:bg-border-2 tw:border tw:border-border tw:[box-shadow:var(--notebook-toast-shadow)] tw:text-[12.5px] tw:z-10">{{ msg }}</div></Transition>
      <input :ref="setImageInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple hidden @change="onImagesPicked" />
    </div>

    <Teleport to="body">
      <NoteVarsPanel v-if="varsOpen" :path="varsOpen.path" :anchor="varsOpen.anchor" @close="varsOpen = undefined" />
    </Teleport>
    <Popover v-model:open="emojiOpen" :anchor="emojiFor" :place="atPoint" class="nemo tw:fixed tw:z-5000" @pointerdown.stop>
      <EmojiPick @pick="(u) => (actions.setEmoji(emojiFor!.node, u), (emojiFor = undefined))" />
    </Popover>
    <EventCard v-if="evCard" :key="evCard.id" :day="evCard.day" :id="evCard.id" :x="evCard.x" :y="evCard.y" :from="evCard.from" :path="evCard.path" @close="evCard = undefined" />
    <RefCardPop v-if="refCard" :key="refCard.url" :path="refCard.path" :url="refCard.url" :x="refCard.x" :y="refCard.y" :from="refCard.from" @close="refCard = undefined" />
    <EventModal v-if="eventText !== undefined" :text="eventText" @created="onEventMade" @close="eventText = undefined" />
    <Teleport to="body">
      <TreeMenu v-if="treeMenu" :menu="treeMenu" />
    </Teleport>
    <NotebookHelp v-if="helpOpen" @close="helpOpen = false" />
  </div>
</template>

<style scoped src="./NotebookView.css"></style>

<style src="./NotebookView.global.css"></style>
