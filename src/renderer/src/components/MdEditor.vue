<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { codeFolding, foldGutter, foldKeymap } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { looseFence } from '@shared/mdLooseFence'
import { eventLink, type EventRef } from '@shared/noteEvents'
import { noteRun, syncDataBlocks, syncTemplates } from '@nb/engine'
import { editorHost, refreshDecorations, COMPONENT_INPUT } from '@nb/editor/editorHost'
import { editorHighlighting, editorLook } from '@nb/editor/theme'
import { livePreview } from '@nb/editor/livePreview'
import { valueChips } from '@nb/editor/valueChips'
import { eventChipsClock } from '@nb/editor/eventChips'
import { fenceLanguagePicker } from '@nb/editor/codeBlocks'
import { linkClicks } from '@nb/editor/links'
import { imagePasteAndDrop, insertImages } from '@nb/editor/images'
import { noteComponents } from '@nb/editor/components/componentWidget'
import { componentGuard, componentTail } from '@nb/editor/components/componentOps'
import { loopBands } from '@nb/editor/loopBands'
import { recordingMarker, showRecordingPlace, takeRecordingPlace } from '@nb/editor/recording'
import { wrapSelection } from '@nb/editor/formatting'
import { useCommandMenu } from '@nb/editor/commandMenu/useCommandMenu'
import CommandMenu from '@nb/editor/commandMenu/CommandMenu.vue'
import { useEditorContextMenu } from '@nb/editor/contextMenu/useEditorContextMenu'
import EditorContextMenu from '@nb/editor/contextMenu/EditorContextMenu.vue'
import '@nb/editor/editor.css'
import { CODE_LANGUAGES, indentFold } from '../lib/codeblocks'
import { transcribing } from '../lib/notebook'
import { eventsNow, eventsTick } from '../lib/noteEvents'

/**
 * The notebook's editor (CodeMirror 6), like Obsidian's Live Preview: what is finished reads as the result —
 * headings, bold, links, lists, checkboxes, quotes — and the Markdown signs show only where the cursor is.
 * Components (tables, runnable blocks…) draw themselves; «@» opens the menu of what to insert. This component only
 * puts the editor's extensions together (src/notebook/editor), keeps the text in step and serves the note view.
 */
// several roots (the editor, its menus): the classes it is given go onto the editor's box
defineOptions({ inheritAttrs: false })
/** `rec`: a recording into this note is going on (its place is shown in the text). */
const props = defineProps<{ text: string; rec?: { sec: number; level: number }; path?: string }>()
const emit = defineEmits<{ change: [text: string]; wiki: [target: string]; transcribe: [audio: string]; dropAudio: [audio: string]; toEvent: [text: string, at: { from: number; to: number }]; exitUp: []; warn: [text: string]; record: []; pickImage: []; stopRec: [] }>()

const host = ref<HTMLElement>()
let view: EditorView | undefined
const getView = () => view

/** What the extensions ask of this component: the note's path, the events they raise. */
const hostApi = editorHost.of({
  notePath: () => props.path ?? '',
  transcribe: (rel) => emit('transcribe', rel),
  dropAudio: (rel) => emit('dropAudio', rel),
  openWiki: (target) => emit('wiki', target),
  warn: (text) => emit('warn', text),
  requestRecording: () => emit('record'),
  requestImage: () => emit('pickImage'),
})
const { menu: commandMenu, extensions: commandMenuExtensions } = useCommandMenu(getView)
const { menu: contextMenu, extension: contextMenuExtension } = useEditorContextMenu(getView, (text, at) => emit('toEvent', text, at))

// ---------- a recording going on: shown where it will be ----------
const recUi = reactive({ sec: 0, level: 0, onStop: () => emit('stopRec') })
watch(
  () => props.rec,
  (r) => {
    recUi.sec = r?.sec ?? 0
    recUi.level = r?.level ?? 0
  },
)
const recMarker = recordingMarker(recUi)

/** ↑ on the first line (its top row, a long line wraps) — up into the note's title. */
function exitUpFromFirstLine(v: EditorView): boolean {
  const sel = v.state.selection.main
  if (!sel.empty || v.state.doc.lineAt(sel.head).number !== 1) return false
  const a = v.coordsAtPos(sel.head)
  const b = v.coordsAtPos(0)
  if (a && b && Math.abs(a.top - b.top) > 2) return false
  emit('exitUp')
  return true
}
/** Redraws the decorations (values, chips, players changed outside the text). */
const redraw = () => view?.dispatch({ effects: refreshDecorations.of(null) })

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.text,
      extensions: [
        hostApi,
        history(),
        lineNumbers(),
        highlightActiveLineGutter(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: CODE_LANGUAGES, extensions: [{ remove: ['SetextHeading'] }, looseFence] }),
        editorHighlighting,
        codeFolding({ placeholderText: '…' }),
        foldGutter({ openText: '▾', closedText: '▸' }),
        indentFold,
        fenceLanguagePicker,
        highlightSelectionMatches(),
        search({ top: true }),
        editorLook,
        livePreview,
        valueChips,
        eventChipsClock,
        linkClicks,
        imagePasteAndDrop,
        commandMenuExtensions,
        noteComponents,
        loopBands,
        componentGuard,
        componentTail,
        recMarker,
        contextMenuExtension,
        placeholder('Пишите… # заголовок, **жирный**, - список, - [ ] задача, [[другая заметка]]'),
        keymap.of([{ key: 'ArrowUp', run: exitUpFromFirstLine }]),
        keymap.of([{ key: 'Mod-b', run: wrapSelection('**') }, { key: 'Mod-i', run: wrapSelection('*') }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          emit('change', u.state.doc.toString())
          scheduleSync()
        }),
      ],
    }),
  })
  if (props.text.includes('qvarch://')) void eventsNow()
})
onBeforeUnmount(() => view?.destroy())

// ---------- the note's values ----------
// the note's data blocks and templates in its context (those off screen too), a moment after typing stops
let syncTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSync(): void {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    if (!props.path || !view) return
    const text = view.state.doc.toString()
    syncDataBlocks(props.path, text)
    syncTemplates(props.path, text)
  }, 400)
}
onMounted(() => {
  if (!props.path) return
  syncDataBlocks(props.path, props.text)
  syncTemplates(props.path, props.text)
})
// the note's values changed: {{ }} redrawn, templates filled again (the ones off screen too)
watch(
  () => {
    if (!props.path) return ''
    const ctx = noteRun(props.path).ctx
    return JSON.stringify(Object.keys(ctx).map((k) => [k, ctx[k].at]))
  },
  () => {
    redraw()
    if (props.path && view) syncTemplates(props.path, view.state.doc.toString())
  },
)
// a loop's pass picked or finished: {{ }} in the loop redrawn (they show the pass picked)
watch(
  () => (props.path ? JSON.stringify(Object.entries(noteRun(props.path).loops).map(([k, l]) => [k, l.sel, l.state, l.passes.filter((p) => p.state !== 'run').length])) : ''),
  redraw,
)
// the events' list reloaded / a transcription started or failed: the chips and players follow
watch(eventsTick, redraw)
watch(() => [...transcribing.entries()].join(), redraw)

// the same note changed elsewhere (another pane, a transcript, a reload): only the changed middle is replaced
watch(
  () => props.text,
  (text) => {
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur === text) return
    let a = 0
    while (a < cur.length && a < text.length && cur[a] === text[a]) a++
    let b = 0
    while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++
    view.dispatch({ changes: { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) } })
  },
)

defineExpose({
  focus: () => view?.focus(),
  /**
   * A click on the note's empty places (under its last line, beside it in the margins): the cursor to the nearest
   * place of the text — under the text, its end; beside a line, that line's nearest end.
   */
  focusAt(x: number, y: number): void {
    if (!view) return
    const c = view.contentDOM.getBoundingClientRect()
    const end = view.coordsAtPos(view.state.doc.length)
    const pos = end && y > end.bottom ? view.state.doc.length : view.posAtCoords({ x: Math.min(Math.max(x, c.left + 2), c.right - 2), y: Math.min(Math.max(y, c.top + 1), c.bottom - 1) }, false)
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: false })
    view.focus()
  },
  /** A recording starts: its place is shown under the cursor's line (where the recording will go). */
  startRecMarker(): void {
    if (view) showRecordingPlace(view)
  },
  /** The recording's place (null — none), the mark taken away. */
  takeRecMarker(): number | null {
    return view ? takeRecordingPlace(view, recMarker) : null
  },
  /** A recording's line put at a place: on its empty line, else on a line of its own after it. */
  insertAudioAt(pos: number, text: string): void {
    if (!view) return
    const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length))
    const last = line.number === view.state.doc.lines
    const ins = line.length ? `\n${text}${last ? '\n' : ''}` : `${text}${last ? '\n' : ''}`
    const at = line.length ? line.to : line.from
    view.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length }, annotations: Transaction.userEvent.of(COMPONENT_INPUT), scrollIntoView: true })
  },
  /**
   * A piece of the text («В событие») replaced by the event made from it — where it still is (the text may have
   * moved meanwhile), else after the cursor's line.
   */
  linkEvent(at: { from: number; to: number }, text: string, ev: Pick<EventRef, 'day' | 'id' | 'label'>): void {
    if (!view) return
    const doc = view.state.doc.toString()
    const link = eventLink(ev)
    let from = doc.slice(at.from, at.to).trim() === text ? at.from : doc.indexOf(text)
    let to = from >= 0 ? (doc.slice(at.from, at.to).trim() === text ? at.to : from + text.length) : -1
    if (from < 0) {
      from = to = view.state.doc.lineAt(view.state.selection.main.head).to
      view.dispatch({ changes: { from, insert: ` ${link}` } })
      return
    }
    view.dispatch({ changes: { from, to, insert: link }, selection: { anchor: from + link.length } })
  },
  /** Pictures (already in the vault) into the note, at the cursor's line. */
  insertImages(rels: string[]): void {
    if (view) insertImages(view, rels)
  },
  /** The cursor at the very start of the text (coming down from the title). */
  focusStart(): void {
    if (!view) return
    view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true })
    view.focus()
  },
  /** Inserts text as its own lines after the cursor's line. */
  insertBlock(text: string): void {
    if (!view) return
    const s = view.state
    const line = s.doc.lineAt(s.selection.main.head)
    const at = line.length ? line.to : line.from
    // a blank line before: the recording is not glued to a list or a paragraph
    const ins = (line.length ? '\n\n' : '') + text + '\n'
    view.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length }, scrollIntoView: true })
    view.focus()
  },
  /** Goes to a place (a search hit): selects it and scrolls it into the middle. */
  reveal(line: number, col = 0, len = 0): void {
    if (!view) return
    const l = view.state.doc.line(Math.min(view.state.doc.lines, line + 1))
    const from = Math.min(l.to, l.from + col)
    view.dispatch({ selection: { anchor: from, head: Math.min(l.to, from + len) }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    view.focus()
  },
})
</script>

<template>
  <div ref="host" v-bind="$attrs" class="mde tw:box-border tw:w-full tw:max-w-(--note-max,820px) tw:my-0 tw:mx-auto tw:py-0 tw:px-(--note-pad,0px) tw:min-h-0"></div>
  <CommandMenu :menu="commandMenu" />
  <EditorContextMenu :menu="contextMenu" />
</template>
