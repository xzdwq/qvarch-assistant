<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { BlockKind } from '@shared/noteBlocks'
import Icon from '../Icon.vue'
import BlockTable from './BlockTable.vue'
import BlockChart from './BlockChart.vue'
import BlockMermaid from './BlockMermaid.vue'
import BlockCallout from './BlockCallout.vue'
import BlockToggle from './BlockToggle.vue'
import BlockToc from './BlockToc.vue'
import BlockWork from './BlockWork.vue'
import BlockAudio from './BlockAudio.vue'
import BlockImage from './BlockImage.vue'
import BlockBoard from './BlockBoard.vue'
import BlockHttp from './BlockHttp.vue'
import BlockCode from './BlockCode.vue'
import BlockPw from './BlockPw.vue'
import BlockBrowser from './BlockBrowser.vue'
import BlockData from './BlockData.vue'
import BlockRef from './BlockRef.vue'

/**
 * A component of a note as the editor shows it: the component itself and, on the left on hover, its handle —
 * dragged, it moves the component in the note; clicked — copy, duplicate, the Markdown it keeps (to see / edit
 * as text), delete. (The hover area takes the handle in: the mouse on its way there does not lose it.)
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
}>()
const NAMES: Record<BlockKind, string> = { table: 'Таблица', chart: 'График', mermaid: 'Схема', toc: 'Оглавление', callout: 'Выноска', toggle: 'Свёртка', work: 'Работа', audio: 'Аудио', image: 'Изображение', board: 'Доска', http: 'HTTP-запрос', code: 'Код', data: 'Данные', ref: 'Значение', pw: 'Playwright', browser: 'Браузер' }
const copied = ref(false)
const menu = ref<{ x: number; y: number }>()
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
    menu.value = undefined
    props.onDrag(ev)
  }
  const up = () => {
    cleanup()
    if (dragging) return
    const r = btn.getBoundingClientRect()
    menu.value = menu.value ? undefined : { x: r.left, y: r.bottom + 4 }
  }
  const cleanup = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function onDocDown(e: PointerEvent): void {
  if (!(e.target as HTMLElement).closest('.nb-menu')) menu.value = undefined
}
watch(menu, (m) => (m ? window.addEventListener('pointerdown', onDocDown, true) : window.removeEventListener('pointerdown', onDocDown, true)))
onBeforeUnmount(() => window.removeEventListener('pointerdown', onDocDown, true))
function act(what: 'raw' | 'copy' | 'dup' | 'del'): void {
  menu.value = undefined
  if (what === 'raw') raw.value = props.src
  else if (what === 'copy') {
    // as Markdown: pasted into a note it is the same component again
    void navigator.clipboard.writeText(`${props.src}\n`)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } else if (what === 'dup') props.onDuplicate()
  else props.onRemove()
}
function applyRaw(): void {
  if (raw.value !== undefined && raw.value !== props.src) props.onChange(raw.value)
  raw.value = undefined
}
</script>

<template>
  <div class="nb" :class="`k-${kind}`">
    <button class="nb-h" :class="{ on: !!menu }" :title="`${NAMES[kind]}: потяните — переместить, клик — меню`" @pointerdown="onHandleDown"><Icon name="grip" :size="14" /></button>
    <span v-if="copied" class="nb-ok">Скопировано — вставьте в любую заметку</span>
    <div v-if="raw !== undefined" class="nb-raw">
      <div class="nb-rh"><b>{{ NAMES[kind] }} — Markdown</b><span class="grow"></span><button @mousedown.prevent @click="raw = undefined">Отмена</button><button class="primary" @mousedown.prevent @click="applyRaw">Готово</button></div>
      <textarea v-model="raw" spellcheck="false" @keydown.ctrl.enter.prevent="applyRaw" @keydown.esc.prevent="raw = undefined"></textarea>
    </div>
    <BlockTable v-else-if="kind === 'table'" :src="src" :autofocus="autofocus" @change="onChange" @exit="onExit" />
    <BlockChart v-else-if="kind === 'chart'" :src="src" :autofocus="autofocus" @change="onChange" />
    <BlockMermaid v-else-if="kind === 'mermaid'" :src="src" :autofocus="autofocus" @change="onChange" />
    <BlockCallout v-else-if="kind === 'callout'" :src="src" :autofocus="autofocus" @change="onChange" @exit="onExit" />
    <BlockToggle v-else-if="kind === 'toggle'" :src="src" :autofocus="autofocus" @change="onChange" @exit="onExit" />
    <BlockAudio v-else-if="kind === 'audio'" :src="src" :on-transcribe="onTranscribe" :on-drop-audio="onDropAudio" />
    <BlockImage v-else-if="kind === 'image'" :src="src" />
    <BlockBoard v-else-if="kind === 'board'" :src="src" :on-change="onChange" />
    <BlockHttp v-else-if="kind === 'http'" :src="src" :path="path" :line="line" :on-change="onChange" />
    <BlockCode v-else-if="kind === 'code'" :src="src" :path="path" :line="line" :on-change="onChange" />
    <BlockPw v-else-if="kind === 'pw'" :src="src" :path="path" :line="line" :on-change="onChange" />
    <BlockBrowser v-else-if="kind === 'browser'" :src="src" :path="path" :line="line" :on-change="onChange" />
    <BlockData v-else-if="kind === 'data'" :src="src" :path="path" :on-change="onChange" />
    <BlockRef v-else-if="kind === 'ref'" :src="src" :path="path" :on-change="onChange" />
    <BlockWork v-else-if="kind === 'work'" :src="src" :autofocus="autofocus" @change="onChange" />
    <BlockToc v-else :headings="headings" @go="onGo" />
    <Teleport to="body">
      <div v-if="menu" class="nb-menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }">
        <button @click="act('copy')"><Icon name="copy" :size="13" />Копировать</button>
        <button @click="act('dup')"><Icon name="layers" :size="13" />Дублировать</button>
        <button v-if="kind !== 'audio' && kind !== 'image'" @click="act('raw')"><Icon name="code" :size="13" />Изменить как Markdown</button>
        <hr />
        <button class="danger" @click="act('del')"><Icon name="trash" :size="13" />Удалить {{ NAMES[kind].toLowerCase() }}</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.nb {
  position: relative;
  /* the hover area reaches the handle on the left */
  margin: 4px 0 4px -30px;
  padding-left: 32px;
  font-size: 0.95em;
  line-height: 1.5;
  white-space: normal;
  cursor: auto;
}
.nb-h {
  position: absolute;
  top: 4px;
  left: 4px;
  touch-action: none;
  /* over the editor's line-number and fold columns (they lie on this spot and would take the mouse) */
  z-index: 250;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  /* always there (no hunting for it): dim, bright under the mouse */
  opacity: 0.4;
  cursor: grab;
  transition: opacity 0.12s;
}
.nb:hover > .nb-h,
.nb:focus-within > .nb-h,
.nb-h.on {
  opacity: 1;
}
.nb-ok {
  position: absolute;
  z-index: 4;
  top: -18px;
  left: 32px;
  color: var(--up-fg);
  font-size: 11.5px;
}
.nb-h:hover,
.nb-h:active {
  opacity: 1;
  background: var(--hover);
  color: var(--text);
}
.nb-raw {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgb(var(--accent-rgb) / 0.5);
  border-radius: 8px;
  background: var(--panel);
}
.nb-rh {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.nb-rh b {
  color: var(--text-2);
  font-weight: 600;
}
.grow {
  flex: 1;
}
.nb-raw textarea {
  min-height: 80px;
  padding: 8px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12.5px;
  line-height: 1.5;
  field-sizing: content;
  resize: none;
  outline: none;
}
.nb-menu {
  position: fixed;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  width: 230px;
  padding: 4px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.nb-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.nb-menu button:hover {
  background: var(--hover);
}
.nb-menu .danger {
  color: var(--down-fg);
}
.nb-menu hr {
  margin: 4px 0;
  border: 0;
  border-top: 1px solid var(--border);
}
</style>
