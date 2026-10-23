<script setup lang="ts">
import { nextTick } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import NodeMark from '@renderer/components/NodeMark.vue'
import MdEditor from '@renderer/components/MdEditor.vue'
import { docs, setText } from '@nb/workspace/noteDocs'
import { layout, type Pane } from '@nb/workspace/paneLayout'
import { dropAudio } from '@nb/workspace/noteSync'
import { dirOf, noteName } from '@nb/domain/notePaths'
import { useNotebookScreen } from './notebookScreen'
import { NoteEditors } from './noteEditors'
import { BASE_PX, colorOf, createdOf, emojiOf, setZoom } from './nodeInfo'

/**
 * A note's text in its pane: the folders over it, its title (the file's name), when it was made, the editor; the
 * text's scale — Ctrl + wheel. A click on the empty places puts the cursor into the text.
 */
const props = defineProps<{
  p: Pane
  /** The pane's active note. */
  path: string
}>()
const { editors, actions, voice, events, images, toast } = useNotebookScreen()
const { rename, openWiki } = actions
const { recorder, recInto, startRec, stopRec, transcribeInto } = voice
const { toEvent } = events
const { pickImages } = images
const { say } = toast
/** The editor's key: its pane and note (the editor is registered under it while shown). */
const editorKey = () => NoteEditors.key(props.p)
const setEditor = (el: unknown) => editors.set(editorKey(), el)

/** The note's empty places (the margins, under the text, the path and dates lines' blank parts): the cursor stays in the note. */
const EMPTY_PLACES = ['pscroll', 'mde', 'cm-editor', 'cm-scroller', 'crumbs', 'nmeta']
function onPaneDown(e: MouseEvent): void {
  if (e.button !== 0) return
  const t = e.target as HTMLElement
  if (!EMPTY_PLACES.some((c) => t.classList?.contains(c))) return
  const ed = editors.of(props.p)
  if (!ed) return
  e.preventDefault()
  ed.focusAt(e.clientX, e.clientY)
}
function onPaneWheel(e: WheelEvent): void {
  if (!(e.ctrlKey || e.metaKey) || !e.deltaY) return
  e.preventDefault()
  setZoom((layout.zoom || 100) + (e.deltaY < 0 ? 10 : -10))
}
/** Enter / ↓ in the title — renamed first (the editor comes back under the new name), then into the text; Esc — back. */
async function onTitleKey(e: KeyboardEvent): Promise<void> {
  const p = props.p
  const el = e.target as HTMLInputElement
  switch (e.key) {
    case 'Enter':
    case 'ArrowDown': {
      e.preventDefault()
      if (p.active && el.value !== noteName(p.active)) await rename(p.active, el.value)
      await nextTick()
      const ed = editors.of(p)
      if (e.key === 'ArrowDown' && ed && 'focusStart' in ed) (ed as { focusStart: () => void }).focusStart()
      else ed?.focus()
      break
    }
    case 'Escape':
      el.value = noteName(p.active ?? '')
      el.blur()
      break
  }
}
</script>

<template>
  <div class="pscroll tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:flex tw:flex-col tw:group-[.paired]/pbody:[&:not(.pairsw)]:mr-26" :style="{ fontSize: `${(BASE_PX * (layout.zoom || 100)) / 100}px` }" @wheel="onPaneWheel" @mousedown="onPaneDown($event)">
    <div class="crumbs tw:flex-none tw:flex tw:items-center tw:justify-center tw:gap-4 tw:pt-8 tw:pr-12 tw:pb-0 tw:pl-12 tw:text-muted tw:text-[12px] tw:last:flex-1">
      <template v-for="(c, ci) in dirOf(path).split('/').filter(Boolean)" :key="ci"><span>{{ c }}</span><Icon name="chevronRight" :size="10" /></template>
      <span class="leaf tw:text-text-2"><NodeMark v-if="emojiOf(path) || colorOf(path)" :emoji="emojiOf(path)" :color="colorOf(path)" icon="note" :size="13" />{{ noteName(path) }}</span>
    </div>
    <input
      :ref="(el) => el && editors.setTitle(p.id, el as HTMLInputElement)"
      class="ntitle tw:last:flex-1 tw:box-border tw:w-full tw:max-w-(--note-max,820px) tw:mt-18 tw:mr-auto tw:mb-6 tw:ml-auto tw:pt-0 tw:pr-[calc(24px+var(--note-pad,0px))] tw:pb-0 tw:pl-[calc(52px+var(--note-pad,0px))] tw:border-0 tw:bg-transparent tw:text-text-hi tw:[font-style:inherit] tw:[font-variant:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[1.8em] tw:[&&]:font-bold tw:outline-none"
      :value="noteName(path)"
      spellcheck="false"
      title="Название заметки — это имя файла"
      @change="rename(path, ($event.target as HTMLInputElement).value)"
      @keydown="onTitleKey($event)"
    />
    <div class="nmeta tw:last:flex-1 tw:box-border tw:w-full tw:max-w-(--note-max,820px) tw:-mt-2 tw:mr-auto tw:mb-8 tw:ml-auto tw:pt-0 tw:pr-[calc(24px+var(--note-pad,0px))] tw:pb-0 tw:pl-[calc(52px+var(--note-pad,0px))] tw:text-muted tw:text-[11.5px]">
      <span class="tw:inline-flex tw:items-center tw:gap-5" v-if="createdOf(path)" title="Дата создания файла"><Icon name="clock" :size="11" />Создано {{ createdOf(path) }}</span>
    </div>
    <template class="tw:last:flex-1" v-if="docs.get(path)?.loaded">
      <MdEditor class="tw:last:flex-1"
        :key="editorKey()"
        :ref="setEditor"
        :text="docs.get(path)!.text"
        :path="path"
        @change="(t) => setText(path, t)"
        @wiki="(w) => openWiki(w)"
        @transcribe="(a) => transcribeInto(path, a)"
        @drop-audio="(a) => dropAudio(path, a)"
        @to-event="(t, at) => toEvent(p, t, at)"
        @exit-up="editors.titleUp(p)"
        @warn="say"
        @record="!recInto && startRec(p)"
        @stop-rec="stopRec"
        :rec="recInto?.pane === p.id && recInto.inline ? { sec: recorder.sec.value, level: recorder.level.value } : undefined"
        @pick-image="pickImages(p)"
      />
    </template>
  </div>
</template>
