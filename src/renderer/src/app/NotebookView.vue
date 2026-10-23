<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { audioEmbed, MARK_COLORS, resolveWiki, type VaultHit, type VaultNode } from '@shared/vault'
import Icon from '../components/Icon.vue'
import ZoomChip from '../components/ZoomChip.vue'
import NotebookHelp from '../components/NotebookHelp.vue'
import MdEditor from '../components/MdEditor.vue'
import BoardView from '../components/BoardView.vue'
import { isBoard, serializeBoard } from '@shared/whiteboard'
import { freshBoard } from '../lib/boardPrefs'
import EventModal from '../components/EventModal.vue'
import EventCard from '../components/EventCard.vue'
import EmojiPick from '../components/EmojiPick.vue'
import NodeMark from '../components/NodeMark.vue'
import { clearCtx, flushRuns, forgetRuns, moveRuns, noteReport, noteRun, runAll, stopRunAll } from '../lib/runbook'
import { summary } from '@shared/runbook'
import { useTablet } from '../lib/tablet'
import { fmtSec, useRecorder } from '../lib/recorder'
import { placeFloat, useAnchor, useFollow } from '../lib/floating'
import {
  closeEverywhere,
  closeTab,
  curPane,
  dirOf,
  doc,
  docs,
  dropAudio,
  moveTab,
  SORTS,
  sortNodes,
  files,
  layout,
  loadTree,
  noteName,
  onOutside,
  openFile,
  putTranscript,
  remap,
  saveAll,
  setText,
  takeImages,
  TranscribeCancelled,
  splitWith,
  swapTab,
  toggleSplit,
  transcribe,
  transcribeError,
  tree,
  type Pane,
} from '../lib/notebook'

/**
 * Блокнот — Markdown notes like in Obsidian: sections (folders) on the left, tabs, two notes side by side,
 * search through everything, voice recordings right in a note (transcribed locally). Saved while typing.
 */

const msg = ref('')
let msgTimer: ReturnType<typeof setTimeout> | undefined
function say(t: string): void {
  msg.value = t
  clearTimeout(msgTimer)
  msgTimer = setTimeout(() => (msg.value = ''), 4000)
}
const reveal = (p: string) => window.qa.vaultReveal(p)
const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

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

// ---------- the tree ----------
/** The folder new notes go to: the one clicked last, else the active note's. */
const folder = ref<string>()
const targetDir = computed(() => folder.value ?? dirOf(curPane()?.active ?? ''))
const rows = computed(() => {
  const out: Array<{ node: VaultNode; depth: number; grp?: 'top' | 'bot' }> = []
  const walk = (ns: VaultNode[], depth: number) => {
    const here = new Map(ns.map((n) => [n.path, n]))
    for (const n of ns) {
      const other = !n.dir && n.pair ? here.get(n.pair) : undefined
      if (other) {
        // the pair sorts by its note: the board waits for it, then goes right under it
        if (n.board) continue
        out.push({ node: n, depth, grp: 'top' }, { node: other, depth, grp: 'bot' })
        continue
      }
      out.push({ node: n, depth })
      if (n.dir && layout.open.includes(n.path)) walk(sortNodes(n.children ?? [], layout.sort), depth + 1)
    }
  }
  walk(sortNodes(tree.value, layout.sort), 0)
  return out
})
const noteCount = computed(() => files.value.length)
function clickRow(n: VaultNode, e: MouseEvent): void {
  if (n.dir) {
    folder.value = n.path
    const i = layout.open.indexOf(n.path)
    if (i >= 0) layout.open.splice(i, 1)
    else layout.open.push(n.path)
    return
  }
  folder.value = undefined
  openFile(n.path, { newPane: e.ctrlKey || e.metaKey })
}

// ---------- create / rename / move / delete ----------
const titleEls = new Map<string, HTMLInputElement>()
async function newNote(dir = targetDir.value, pane?: number): Promise<void> {
  try {
    const path = await window.qa.vaultCreate(dir, 'note')
    await loadTree()
    openFile(path, { pane })
    // like Obsidian: the title first, Enter — to the text
    await nextTick()
    const el = titleEls.get(curPane().id)
    el?.focus()
    el?.select()
  } catch (e) {
    say(errText(e))
  }
}
/** A new board (an endless sheet for schemes and notes) — a .qboard file in the folder. */
async function newBoard(dir = targetDir.value, pane?: number): Promise<void> {
  try {
    const path = await window.qa.vaultCreate(dir, 'board', undefined, serializeBoard(freshBoard()))
    await loadTree()
    openFile(path, { pane })
  } catch (e) {
    say(errText(e))
  }
}
/** What a board says about itself (shown in the status line). */
const boardInfo = ref<Record<string, string>>({})
async function newFolder(dir = targetDir.value): Promise<void> {
  try {
    const path = await window.qa.vaultCreate(dir, 'folder')
    await loadTree()
    if (dir && !layout.open.includes(dir)) layout.open.push(dir)
    folder.value = path
    startRename(path)
  } catch (e) {
    say(errText(e))
  }
}
async function rename(path: string, name: string): Promise<void> {
  const clean = name.trim()
  const node = findNode(path)
  const old = node ? node.name : noteName(path)
  if (!clean || clean === old) return
  try {
    const to = await window.qa.vaultMove(path, dirOf(path), clean)
    remap(path, to)
    moveRuns(path, to)
    if (folder.value) folder.value = folder.value === path ? to : folder.value
    await loadTree()
  } catch (e) {
    say(errText(e))
  }
}
async function moveTo(path: string, dir: string): Promise<void> {
  if (dirOf(path) === dir || path === dir) return
  try {
    const to = await window.qa.vaultMove(path, dir)
    remap(path, to)
    moveRuns(path, to)
    if (dir && !layout.open.includes(dir)) layout.open.push(dir)
    await loadTree()
  } catch (e) {
    say(errText(e))
  }
}
async function remove(n: VaultNode): Promise<void> {
  if (!confirm(n.dir ? `Удалить папку «${n.name}» со всеми заметками? (в корзину)` : `Удалить заметку «${n.name}»? (в корзину)`)) return
  try {
    closeEverywhere(n.path)
    await window.qa.vaultDelete(n.path)
    for (const k of [...docs.keys()]) if (k === n.path || k.startsWith(n.path + '/')) docs.delete(k)
    // its runs too (a new note of that name must not show them)
    forgetRuns(n.path)
    if (folder.value && (folder.value === n.path || folder.value.startsWith(n.path + '/'))) folder.value = undefined
    await loadTree()
  } catch (e) {
    say(errText(e))
  }
}
function findNode(path: string): VaultNode | undefined {
  const walk = (ns: VaultNode[]): VaultNode | undefined => {
    for (const n of ns) {
      if (n.path === path) return n
      const c = n.dir ? walk(n.children ?? []) : undefined
      if (c) return c
    }
  }
  return walk(tree.value)
}

// inline rename in the tree
const renaming = ref<string>()
const renameText = ref('')
const renameEl = ref<HTMLInputElement[]>()
async function startRename(path: string): Promise<void> {
  renaming.value = path
  renameText.value = findNode(path)?.name ?? noteName(path)
  await nextTick()
  renameEl.value?.[0]?.focus()
  renameEl.value?.[0]?.select()
}
async function finishRename(apply: boolean): Promise<void> {
  const p = renaming.value
  renaming.value = undefined
  if (apply && p) await rename(p, renameText.value)
}

// drag & drop in the tree: onto a folder (or the empty space — the top level); a note onto a board (or back) — links them
const dragPath = ref<string>()
const dropDir = ref<string>()
const pairTarget = ref<string>()
/** The note / board a file is linked with. */
const pairOf = (path: string) => findNode(path)?.pair
async function pair(a: string, b?: string): Promise<void> {
  try {
    await window.qa.vaultPair(a, b)
    await loadTree()
    if (b) say(`Связано: «${noteName(a)}» и «${noteName(b)}»`)
  } catch (e) {
    say(errText(e))
  }
}
/** The other view of a linked file, in this pane (or in the other one: `aside`). */
function showPair(pi: number, aside = false): void {
  const p = layout.panes[pi]
  const other = p?.active ? pairOf(p.active) : undefined
  if (!other) return
  if (!aside) return swapTab(pi, other)
  if (layout.panes.length > 1) openFile(other, { pane: pi === 0 ? 1 : 0 })
  else openFile(other, { newPane: true })
}
function onDragStart(n: VaultNode, e: DragEvent): void {
  dragPath.value = n.path
  e.dataTransfer?.setData('text/plain', n.path)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(n: VaultNode | undefined, e?: DragEvent): void {
  // a file from outside: the folder it would go into lights up
  if (e && fileDrag(e)) {
    pairTarget.value = undefined
    dropDir.value = n ? (n.dir ? n.path : dirOf(n.path)) : ''
    return
  }
  if (!dragPath.value) return
  const from = findNode(dragPath.value)
  // a note over a board (or a board over a note): link them
  if (n && from && !n.dir && !from.dir && n.path !== from.path && !!n.board !== !!from.board) {
    pairTarget.value = n.path
    dropDir.value = undefined
    return
  }
  pairTarget.value = undefined
  dropDir.value = n ? (n.dir ? n.path : dirOf(n.path)) : ''
}
async function onDrop(e?: DragEvent): Promise<void> {
  if (e && fileDrag(e)) {
    const dir = dropDir.value ?? ''
    dropDir.value = undefined
    return importDropped(e, dir)
  }
  const from = dragPath.value
  const to = dropDir.value
  const link = pairTarget.value
  dragPath.value = undefined
  dropDir.value = undefined
  pairTarget.value = undefined
  if (from && link) return void (await pair(from, link))
  if (from !== undefined && to !== undefined) await moveTo(from, to)
}

// the right-click menu
const ctx = ref<{ x: number; y: number; node?: VaultNode }>()
function openCtx(e: MouseEvent, node?: VaultNode): void {
  ctx.value = { x: Math.min(e.clientX, window.innerWidth - 310), y: Math.min(e.clientY, window.innerHeight - 300), node }
  if (node?.dir) folder.value = node.path
}
/** The menu closes first — the action gets the node it was opened on. */
function ctxRun(fn: (n?: VaultNode) => unknown): void {
  const n = ctx.value?.node
  ctx.value = undefined
  void fn(n)
}
const closeCtx = () => (ctx.value = undefined)

// ---------- a document into one file (.qvdoc) and back ----------
async function exportDoc(path: string): Promise<void> {
  try {
    await saveAll()
    await flushRuns()
    const r = await window.qa.docExport(path)
    if (!r) return
    const more = r.docs > 1 ? ` + ${r.docs - 1} связ.` : ''
    say(`Экспортировано: ${r.file.split(/[\\/]/).pop()}${more}${r.files ? `, файлов: ${r.files}` : ''}${r.missing.length ? ` · не найдено: ${r.missing.length}` : ''}`)
  } catch (e) {
    say(`Не удалось экспортировать: ${errText(e)}`)
  }
}
/** What came in: a folder — opened in the tree; a document — opened. */
async function imported(r: { main: string; paths: string[]; folder?: string }): Promise<void> {
  await loadTree()
  if (r.folder) {
    const open = new Set(layout.open)
    for (let p = r.folder; p; p = dirOf(p)) open.add(p)
    layout.open = [...open]
    folder.value = r.folder
    say(`Папка «${noteName(r.folder)}» импортирована · документов: ${r.paths.length}`)
  } else {
    openFile(r.main)
    say(r.paths.length > 1 ? `Импортировано документов: ${r.paths.length}` : 'Документ импортирован')
  }
}
async function importDoc(dir: string): Promise<void> {
  try {
    const r = await window.qa.docImport(dir)
    if (r) await imported(r)
  } catch (e) {
    say(`Не удалось импортировать: ${errText(e)}`)
  }
}
/** .qvdoc files dragged from Explorer onto the tree: into the folder under them (or the top). */
const fileDrag = (e: DragEvent) => !dragPath.value && !!e.dataTransfer?.types.includes('Files')
async function importDropped(e: DragEvent, dir: string): Promise<void> {
  const list = [...(e.dataTransfer?.files ?? [])]
  const docs = list.filter((x) => x.name.toLowerCase().endsWith('.qvdoc'))
  if (!docs.length) return void (list.length && say('Импортируются только файлы .qvdoc (экспорт документа или папки)'))
  for (const x of docs) {
    try {
      await imported(await window.qa.docImportFile(dir, window.qa.pathForFile(x)))
    } catch (err) {
      say(`«${x.name}» не импортирован: ${errText(err)}`)
    }
  }
}
onMounted(() => window.addEventListener('pointerdown', closeCtx))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeCtx))

// ---------- search through all notes ----------
const q = ref('')
const hits = ref<VaultHit[]>([])
const searching = ref(false)
const searchEl = ref<HTMLInputElement>()
let qTimer: ReturnType<typeof setTimeout> | undefined
watch(q, (v) => {
  clearTimeout(qTimer)
  qTimer = setTimeout(async () => {
    searching.value = true
    // unsaved typing is searched too
    await saveAll()
    hits.value = await window.qa.vaultSearch(v)
    searching.value = false
  }, 160)
})
async function toggleSearch(on = layout.sideTab !== 'search'): Promise<void> {
  layout.sideTab = on ? 'search' : 'files'
  if (on) {
    await nextTick()
    searchEl.value?.focus()
    searchEl.value?.select()
  }
}
async function openHit(h: VaultHit, line?: VaultHit['lines'][number]): Promise<void> {
  openFile(h.path)
  const p = curPane()
  if (!line) return
  // once the editor is there (the note may still be loading)
  for (let i = 0; i < 40; i++) {
    await nextTick()
    const ed = editorOf(p)
    if (ed && docs.get(h.path)?.loaded) {
      ed.reveal(line.line, line.col, line.len)
      return
    }
    await new Promise((r) => setTimeout(r, 25))
  }
}
const parts = (s: string, at: number, len: number) => ({ a: s.slice(0, at), m: s.slice(at, at + len), b: s.slice(at + len) })

// ---------- panes ----------
/**
 * The tablet drawing on a board («Полотно Qvarch»): only the board takes the pen — the width handles next to it
 * (the side's, the panes') are off, a stroke near the edge never grabs them.
 */
const { state: tabletState } = useTablet()
const penOnly = computed(() => {
  const t = tabletState.value
  return t?.status.state === 'connected' && t.prefs.target.kind === 'canvas' && layout.panes.some((p) => !!p.active && isBoard(p.active))
})
const sideHidden = computed({
  get: () => !!layout.sideHidden,
  set: (v: boolean) => (layout.sideHidden = v),
})
/** "В событие" from the editor's menu: the selected text for a new block. */
const eventText = ref<string>()
/** Where the text made into an event is (its editor and place) — it becomes the event's chip. */
let eventAt: { key: string; from: number; to: number } | undefined
function toEvent(p: Pane, text: string, at: { from: number; to: number }): void {
  eventAt = { key: `${p.id}:${p.active}`, ...at }
  eventText.value = text
}
// an event chip clicked in a note: its card
const evCard = ref<{ day: string; id: string; x: number; y: number; path?: string }>()
const onEvCard = (e: Event) => {
  const d = (e as CustomEvent<{ day: string; id: string; x: number; y: number }>).detail
  evCard.value = { ...d, path: curPane()?.active }
}
onMounted(() => window.addEventListener('qa:event-card', onEvCard))
onBeforeUnmount(() => window.removeEventListener('qa:event-card', onEvCard))
function onEventMade(day: string, e: { id: string; label: string }): void {
  const at = eventAt
  const text = eventText.value
  eventAt = undefined
  if (!at || !text) return
  editors.get(at.key)?.linkEvent(at, text, { day, id: e.id, label: e.label || text })
}
type Ed = InstanceType<typeof MdEditor>
const editors = new Map<string, Ed>()
/** Editors by pane and note: a renamed note's new editor may come before the old one is gone. */
function setEditor(key: string, el: unknown): void {
  if (el) editors.set(key, el as Ed)
  else editors.delete(key)
}
const editorOf = (p: Pane | undefined) => (p?.active ? editors.get(`${p.id}:${p.active}`) : undefined)
/** The note's empty places (the margins, under the text, the path and dates lines' blank parts): the cursor stays in the note. */
const EMPTY_PLACES = ['pscroll', 'mde', 'cm-editor', 'cm-scroller', 'crumbs', 'nmeta']
function onPaneDown(e: MouseEvent, p: Pane): void {
  if (e.button !== 0) return
  const t = e.target as HTMLElement
  if (!EMPTY_PLACES.some((c) => t.classList?.contains(c))) return
  const ed = editorOf(p)
  if (!ed) return
  e.preventDefault()
  ed.focusAt(e.clientX, e.clientY)
}
// ---------- pictures into a note (the button; a paste / a drop — the editor's own) ----------
const imgInput = ref<HTMLInputElement>()
let imgPane: Pane | undefined
function pickImages(p: Pane): void {
  imgPane = p
  if (!imgInput.value) return
  imgInput.value.value = ''
  imgInput.value.click()
}
async function onImagesPicked(): Promise<void> {
  const files = [...(imgInput.value?.files ?? [])]
  const p = imgPane
  imgPane = undefined
  if (!files.length || !p) return
  const rels = await takeImages({ files }, say)
  editorOf(p)?.insertImages(rels)
}
const tabOf = (p: Pane) => p.tabs.find((t) => t.path === p.active)
const dirty = (path: string) => {
  const d = docs.get(path)
  return !!d && d.loaded && d.text !== d.saved
}
function openWiki(target: string, newPane = false): void {
  const path = resolveWiki(target, files.value)
  if (path) openFile(path, { newPane })
  else
    void (async () => {
      // no such note — make it (as Obsidian does)
      const created = await window.qa.vaultCreate(targetDir.value, 'note', target.split('|')[0].split('/').pop())
      await loadTree()
      openFile(created, { newPane })
    })()
}
function stats(path: string): string {
  const t = docs.get(path)?.text ?? ''
  const words = (t.match(/[\p{L}\p{N}]+/gu) ?? []).length
  return `Слов: ${words} · Символов: ${t.length}`
}
async function onTitleKey(e: KeyboardEvent, p: Pane): Promise<void> {
  const el = e.target as HTMLInputElement
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault()
    // renamed first (the editor comes back under the new name), then the cursor goes into the text
    if (p.active && el.value !== noteName(p.active)) await rename(p.active, el.value)
    await nextTick()
    const ed = editorOf(p)
    if (e.key === 'ArrowDown' && ed && 'focusStart' in ed) (ed as { focusStart: () => void }).focusStart()
    else ed?.focus()
  } else if (e.key === 'Escape') {
    el.value = noteName(p.active ?? '')
    el.blur()
  }
}

/** ↑ from the first line of the text — the cursor goes to the end of the title. */
function titleUp(p: Pane): void {
  const el = titleEls.get(p.id)
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
}

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

// ---------- voice: into the open note, or a note of its own ----------
const recorder = useRecorder()
/** Recording into a note; `inline` — its place is shown in the text (no bar above). */
const recInto = ref<{ path: string; pane: string; inline?: boolean }>()
async function startRec(p: Pane): Promise<void> {
  if (!p.active) return
  if (recorder.rec.value) return void stopRec()
  if (await recorder.start('voice')) {
    const ed = isBoard(p.active) ? undefined : editorOf(p)
    ed?.startRecMarker()
    recInto.value = { path: p.active, pane: p.id, inline: !!ed }
  } else say(recorder.error.value)
}
async function stopRec(): Promise<void> {
  const into = recInto.value
  recInto.value = undefined
  const r = await recorder.stop()
  if (!into) return
  const pane = layout.panes.find((x) => x.id === into.pane)
  const ed = pane?.active === into.path ? editorOf(pane) : undefined
  // the place shown while recording
  const at = ed?.takeRecMarker() ?? null
  if (!r) return say('Слишком короткая запись')
  try {
    const rel = await window.qa.vaultSaveAudio(new Uint8Array(await r.blob.arrayBuffer()))
    if (ed && at !== null) ed.insertAudioAt(at, audioEmbed(rel))
    else if (ed) ed.insertBlock(audioEmbed(rel))
    else {
      const d = doc(into.path)
      setText(into.path, `${d.text.replace(/\s*$/, '')}\n\n${audioEmbed(rel)}\n`)
    }
    const s = await window.qa.getSettings()
    if (s.voice.enabled && s.voice.autoTranscribe && (await window.qa.voiceState()).modelReady) void transcribeInto(into.path, rel)
  } catch (e) {
    say(errText(e))
  }
}
async function transcribeInto(path: string, rel: string): Promise<void> {
  try {
    putTranscript(path, rel, await transcribe(rel))
  } catch (e) {
    // the recording was deleted meanwhile: nothing to say
    if (e instanceof TranscribeCancelled) return
    say(transcribeError.value || 'Не удалось расшифровать')
  }
}
async function newVoiceNote(): Promise<void> {
  const now = new Date()
  const stamp = `${now.toLocaleDateString('ru-RU')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`
  try {
    const path = await window.qa.vaultCreate(targetDir.value, 'note', `Голосовая ${stamp}`, `# Голосовая заметка\n\n`)
    await loadTree()
    openFile(path)
    await nextTick()
    await startRec(curPane())
  } catch (e) {
    say(errText(e))
  }
}

// ---------- the text's scale: Ctrl + wheel, or the badge in the status line ----------
const ZOOM_MIN = 50
const ZOOM_MAX = 250
function setZoom(z: number): void {
  layout.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z / 10) * 10))
}
function onPaneWheel(e: WheelEvent): void {
  if (!(e.ctrlKey || e.metaKey) || !e.deltaY) return
  e.preventDefault()
  setZoom((layout.zoom || 100) + (e.deltaY < 0 ? 10 : -10))
}
const BASE_PX = 14.5

// ---------- created / colour ----------
/** "15 окт 2026, 21:12" — under a file's name in the tree. */
const shortDate = (ms: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).replace(' г.', '')}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}
const created = (path: string) => {
  const c = findNode(path)?.ctime
  return c ? new Date(c).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}
const colorOf = (path: string) => findNode(path)?.color
const emojiOf = (path: string) => findNode(path)?.emoji
async function setColor(n: VaultNode, color?: string): Promise<void> {
  await window.qa.vaultSetColor(n.path, color)
  await loadTree()
}
async function setEmoji(n: VaultNode, emoji?: string): Promise<void> {
  await window.qa.vaultSetEmoji(n.path, emoji)
  await loadTree()
}
// ---------- a runnable note: «Выполнить всё», its context ----------
const RUNNABLE = /^(`{3,}|~{3,})\s*(http|rest)\b|^(`{3,}|~{3,})\s*(js|ts|javascript|typescript)\b[^\n]*\b(run|lib|playwright|pw)\b|^(`{3,}|~{3,})\s*(json|yaml|browser)\b[^\n]*\bname=|^(`{3,}|~{3,})\s*sql\b[^\n]*\bdb=/m
const runnable = (path?: string) => !!path && !isBoard(path) && RUNNABLE.test(docs.get(path)?.text ?? '')
const ctxOpen = ref<{ path: string; x: number; y: number }>()
/** «Инструкция» (the notebook's and the testing tools' help) open. */
const helpOpen = ref(false)
/** The button the panel opened from: the panel stays by it (a pane resized), closes when it is gone. */
let ctxAnchor: HTMLElement | undefined
const ctxAt = (r: DOMRect) => ({ x: Math.max(8, Math.min(r.right - 360, window.innerWidth - 370)), y: r.bottom + 6 })
function openCtxPanel(path: string, e: MouseEvent): void {
  if (ctxOpen.value?.path === path) return void (ctxOpen.value = undefined)
  ctxAnchor = e.currentTarget as HTMLElement
  ctxOpen.value = { path, ...ctxAt(ctxAnchor.getBoundingClientRect()) }
}
useFollow(
  ctxOpen,
  () => ctxAnchor,
  (r) => ctxOpen.value && (ctxOpen.value = { ...ctxOpen.value, ...ctxAt(r) }),
  () => (ctxOpen.value = undefined),
)
const closeCtxPanel = (e: PointerEvent) => !(e.target as HTMLElement).closest('.nrun-ctx, .nrun-b') && (ctxOpen.value = undefined)
onMounted(() => window.addEventListener('pointerdown', closeCtxPanel))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeCtxPanel))
async function copyNoteReport(path: string): Promise<void> {
  await navigator.clipboard.writeText(noteReport(path, docs.get(path)?.text ?? ''))
  say('Отчёт скопирован — вставьте в чат, Jira или письмо')
}
const FROM: Record<string, string> = { http: 'HTTP', code: 'код', data: 'данные', set: 'set()', ref: '', pw: 'Playwright', browser: 'браузер' }
/** The emoji offered right in the menu; «…» opens the whole list. */
const QUICK_EMOJI = ['⭐', '🔥', '✅', '❗', '📌', '💡', '🚀', '🐞', '📊', '🎯']
/** The whole emoji list for a node (its place: where its menu was). */
const emojiFor = ref<{ node: VaultNode; x: number; y: number }>()
function moreEmoji(): void {
  const c = ctx.value
  if (!c?.node) return
  emojiFor.value = { node: c.node, x: Math.min(c.x, window.innerWidth - 360), y: Math.min(c.y, window.innerHeight - 340) }
  ctx.value = undefined
}
const closeEmoji = () => (emojiFor.value = undefined)
onMounted(() => window.addEventListener('pointerdown', closeEmoji))
onBeforeUnmount(() => window.removeEventListener('pointerdown', closeEmoji))

// ---------- tabs: drag to reorder (or to the other pane) ----------
const tabDrag = ref<{ pane: number; path: string }>()
const tabDrop = ref<{ pane: number; index: number }>()
function onTabDragStart(pi: number, path: string, e: DragEvent): void {
  tabDrag.value = { pane: pi, path }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // not text/plain — an editor under the pointer must not take it as text
    e.dataTransfer.setData('application/x-qa-tab', path)
  }
}
/**
 * The tab follows the pointer right away (the others make room, animated): over a tab's left half — before it,
 * over its right half — after it; over a tab of the other pane — into that pane.
 */
function onTabDragOver(pi: number, index: number, e: DragEvent): void {
  const d = tabDrag.value
  if (!d) return
  e.preventDefault()
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const to = e.clientX > r.left + r.width / 2 ? index + 1 : index
  if (d.pane === pi) {
    const cur = layout.panes[pi].tabs.findIndex((t) => t.path === d.path)
    if (cur < 0 || to === cur || to === cur + 1) return
    moveTab(pi, d.path, pi, to)
    return
  }
  const before = layout.panes.length
  moveTab(d.pane, d.path, pi, to)
  // the source pane may have closed (its last tab left): the panes shift
  tabDrag.value = { pane: layout.panes.length < before && d.pane < pi ? pi - 1 : pi, path: d.path }
}
/** At the end of a pane's tab row. */
function onTabRowEnd(pi: number, e: DragEvent): void {
  const d = tabDrag.value
  if (!d) return
  e.preventDefault()
  const n = layout.panes[pi].tabs.length
  if (d.pane === pi && layout.panes[pi].tabs[n - 1]?.path === d.path) return
  onTabDragOver(pi, n - 1, { ...e, preventDefault: () => undefined, currentTarget: { getBoundingClientRect: () => ({ left: -1e6, width: 0 }) } } as unknown as DragEvent)
}
function onTabDrop(): void {
  tabDrag.value = undefined
  tabDrop.value = undefined
  zone.value = undefined
}
/** Dropping a tab at a pane's edge splits the window (like VS Code); onto the other pane — moves it there. */
const zone = ref<{ pane: number; side: 'left' | 'right' | 'here' }>()
function onZoneDrop(): void {
  const d = tabDrag.value
  const z = zone.value
  onTabDrop()
  if (!d || !z) return
  if (z.side === 'here') moveTab(d.pane, d.path, z.pane, layout.panes[z.pane].tabs.length)
  else splitWith(d.pane, d.path, z.side)
}

// sort menu: over everything (teleported), as wide as the tool bar, kept under it
const sortOpen = ref(false)
const toolsEl = ref<HTMLElement>()
const sortBtn = ref<HTMLElement>()
const sortStyle = ref<Record<string, string>>({ position: 'fixed', left: '-10000px', top: '0px' })
useAnchor(sortOpen, toolsEl, () => {
  if (!toolsEl.value) return
  const r = toolsEl.value.getBoundingClientRect()
  const f = placeFloat(toolsEl.value, Math.max(160, r.width - 16), true, 0)
  sortStyle.value = { ...f.style, left: `${Math.max(8, Math.min(r.left + 8, window.innerWidth - parseFloat(f.style.width) - 8))}px`, maxHeight: `${f.maxH}px` }
})
const awaySort = (e: PointerEvent) => sortOpen.value && !sortBtn.value?.contains(e.target as Node) && !(e.target as Element).closest?.('.sortmenu') && (sortOpen.value = false)
onMounted(() => window.addEventListener('pointerdown', awaySort, true))
onBeforeUnmount(() => window.removeEventListener('pointerdown', awaySort, true))

// ---------- keys ----------
function onKey(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  const k = e.key.toLowerCase()
  if (k === 'n' && !e.shiftKey) {
    e.preventDefault()
    void newNote()
  } else if (k === 'f' && e.shiftKey) {
    e.preventDefault()
    void toggleSearch(true)
  } else if (k === 'w') {
    e.preventDefault()
    const p = curPane()
    if (p?.active) closeTab(layout.cur, p.active)
  } else if (e.key === '\\') {
    e.preventDefault()
    toggleSplit()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    const p = curPane()
    const i = p.tabs.findIndex((t) => t.path === p.active)
    if (p.tabs.length) p.active = p.tabs[(i + (e.shiftKey ? -1 : 1) + p.tabs.length) % p.tabs.length].path
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="nb">
    <!-- sections & files / search -->
    <aside v-if="!sideHidden" class="nside" :style="{ width: `${layout.side}px` }">
      <div ref="toolsEl" class="ntools">
        <button title="Скрыть панель" @click="sideHidden = true"><Icon name="sidebar" :size="15" /></button>
        <button title="Новая заметка (Ctrl+N)" @click="newNote()"><Icon name="filePlus" :size="15" /></button>
        <button title="Новая доска — полотно для схем и записей" @click="newBoard()"><Icon name="presentation" :size="15" /></button>
        <button title="Новый раздел (папка)" @click="newFolder()"><Icon name="folderPlus" :size="15" /></button>
        <button title="Голосовая заметка" @click="newVoiceNote"><Icon name="mic" :size="15" /></button>
        <span class="grow"></span>
        <button :class="{ on: layout.sideTab === 'search' }" title="Поиск по всем заметкам" @click="toggleSearch()"><Icon name="search" :size="15" /></button>
        <span class="sortwrap">
          <button ref="sortBtn" :class="{ on: sortOpen }" title="Сортировка" @click="sortOpen = !sortOpen"><Icon name="sort" :size="15" /></button>
          <Teleport to="body">
            <div v-if="sortOpen" class="sortmenu" :style="sortStyle">
              <button v-for="s in SORTS" :key="s.id" :class="{ on: layout.sort === s.id }" @click="(layout.sort = s.id), (sortOpen = false)">
                <Icon v-if="layout.sort === s.id" name="check" :size="12" /><span v-else class="sp"></span>{{ s.label }}
              </button>
            </div>
          </Teleport>
        </span>
        <button title="Свернуть все разделы" @click="layout.open = []"><Icon name="collapse" :size="15" /></button>
      </div>

      <div
        v-if="layout.sideTab === 'files'"
        class="ntree"
        :class="{ drop: dropDir === '' }"
        @dragover.prevent="onDragOver(undefined, $event)"
        @dragleave.self="dragPath || (dropDir = undefined)"
        @drop.prevent="onDrop($event)"
        @dragend="(dragPath = undefined), (dropDir = undefined)"
        @contextmenu.prevent="openCtx($event)"
        @click.self="folder = undefined"
      >
        <div
          v-for="r in rows"
          :key="r.node.path"
          class="nrow"
          :class="{ dir: r.node.dir, cur: !r.node.dir && curPane()?.active === r.node.path, sel: r.node.dir && folder === r.node.path, drop: r.node.dir && dropDir === r.node.path, pairdrop: pairTarget === r.node.path, [`grp-${r.grp}`]: !!r.grp }"
          :style="{ paddingLeft: `${6 + r.depth * 14}px` }"
          :title="r.node.path"
          draggable="true"
          @dragstart="onDragStart(r.node, $event)"
          @dragover.prevent.stop="onDragOver(r.node, $event)"
          @drop.prevent.stop="onDrop($event)"
          @click="clickRow(r.node, $event)"
          @dblclick="r.node.dir || startRename(r.node.path)"
          @contextmenu.prevent.stop="openCtx($event, r.node)"
          @keydown.f2="startRename(r.node.path)"
        >
          <Icon v-if="r.node.dir" :name="layout.open.includes(r.node.path) ? 'chevronDown' : 'chevronRight'" :size="12" class="chev" />
          <NodeMark v-if="r.node.dir && r.node.emoji" :emoji="r.node.emoji" :color="r.node.color" icon="folder" :size="14" class="fic" />
          <Icon v-else-if="r.node.dir" :name="layout.open.includes(r.node.path) ? 'folderOpen' : 'folder'" :size="14" class="fic" :style="r.node.color ? { color: r.node.color } : {}" />
          <NodeMark v-else-if="r.node.emoji" :emoji="r.node.emoji" :color="r.node.color" icon="note" :size="13" class="fic emo" />
          <span v-else-if="r.node.color" class="fmark" :style="{ background: r.node.color }"></span>
          <Icon v-else :name="r.node.board ? 'presentation' : 'note'" :size="13" class="fic note" />
          <input
            v-if="renaming === r.node.path"
            ref="renameEl"
            v-model="renameText"
            class="rin"
            spellcheck="false"
            @click.stop
            @keydown.enter.prevent="finishRename(true)"
            @keydown.esc.prevent="finishRename(false)"
            @blur="finishRename(true)"
          />
          <span v-else-if="r.node.dir" class="nname">{{ r.node.name }}</span>
          <span v-else class="ncol"><span class="nname">{{ r.node.name }}</span><small class="ndate">{{ shortDate(r.node.ctime) }}</small></span>
          <span v-if="r.node.pair" class="npair" :title="'Связано с: ' + noteName(r.node.pair)"><Icon name="link" :size="11" /></span>
          <span v-if="!r.node.dir && dirty(r.node.path)" class="ndot" title="Сохраняется…"></span>
        </div>
        <div v-if="!rows.length" class="nempty">
          Пока пусто.
          <button class="lnk" @click="newNote('')">Создать заметку</button>
        </div>
      </div>

      <div v-else class="nsearch">
        <div class="sbox">
          <Icon name="search" :size="13" />
          <input ref="searchEl" v-model="q" placeholder="Искать во всех заметках" spellcheck="false" @keydown.esc="toggleSearch(false)" />
          <button v-if="q" class="sx" title="Очистить" @click="q = ''"><Icon name="x" :size="12" /></button>
        </div>
        <div class="sres">
          <p v-if="q.trim() && !hits.length && !searching" class="nempty">Ничего не найдено</p>
          <div v-for="h in hits" :key="h.path" class="hit">
            <button class="hname" :title="h.path" @click="openHit(h)">
              <Icon :name="isBoard(h.path) ? 'presentation' : 'note'" :size="12" /><span>{{ h.name }}</span><em v-if="h.count">{{ h.count }}</em>
            </button>
            <button v-for="l in h.lines" :key="l.line" class="hline" @click="openHit(h, l)">
              <span>{{ parts(l.text, l.at, l.len).a }}</span><mark>{{ parts(l.text, l.at, l.len).m }}</mark><span>{{ parts(l.text, l.at, l.len).b }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="nfoot">
        <span>{{ noteCount }} {{ noteCount % 10 === 1 && noteCount % 100 !== 11 ? 'заметка' : [2, 3, 4].includes(noteCount % 10) && ![12, 13, 14].includes(noteCount % 100) ? 'заметки' : 'заметок' }}</span>
        <span class="grow"></span>
        <button class="lnk" title="Импорт документа (.qvdoc) в открытый раздел" @click="importDoc(folder ?? '')"><Icon name="download" :size="12" />Импорт</button>
        <button class="lnk" title="Папка с файлами заметок" @click="reveal('')"><Icon name="external" :size="12" />Папка</button>
      </div>
    </aside>
    <div v-if="!sideHidden" class="nresize" :class="{ locked: penOnly }" :title="penOnly ? 'Планшет рисует на доске — ширина панели не меняется' : undefined" @pointerdown.prevent="!penOnly && onSideResize($event)"></div>

    <!-- one or two panes of tabs -->
    <div ref="panesEl" class="npanes">
      <template v-for="(p, pi) in layout.panes" :key="p.id">
        <div v-if="pi" class="psplit" :class="{ locked: penOnly }" :title="penOnly ? 'Планшет рисует на доске — ширина не меняется' : 'Потяните — ширина'" @pointerdown.prevent="!penOnly && onSplitResize($event)"></div>
        <section class="pane" :class="{ cur: layout.cur === pi && layout.panes.length > 1 }" :style="{ flex: layout.panes.length > 1 ? `${pi ? 1 - layout.split : layout.split} 1 0` : '1 1 0' }" @pointerdown.capture="layout.cur = pi">
          <div class="tabs">
            <button v-if="sideHidden && pi === 0" class="tb" title="Показать панель" @click="sideHidden = false"><Icon name="sidebar" :size="14" /></button>
            <div class="tscroll">
              <TransitionGroup tag="div" name="tabmv" class="tlist">
              <div
                v-for="(t, ti) in p.tabs"
                :key="t.path"
                class="tab"
                :class="{ on: p.active === t.path, dragging: tabDrag?.path === t.path && tabDrag?.pane === pi }"
                :title="t.path"
                draggable="true"
                @click="p.active = t.path"
                @mousedown.middle.prevent="closeTab(pi, t.path)"
                @dragstart="onTabDragStart(pi, t.path, $event)"
                @dragover="onTabDragOver(pi, ti, $event)"
                @drop.prevent="onTabDrop"
                @dragend="onTabDrop"
              >
                <NodeMark v-if="emojiOf(t.path)" :emoji="emojiOf(t.path)" :color="colorOf(t.path)" icon="note" :size="12" />
                <span v-else-if="colorOf(t.path)" class="fmark sm" :style="{ background: colorOf(t.path) }"></span>
                <Icon v-else :name="isBoard(t.path) ? 'presentation' : 'note'" :size="12" class="tic" />
                <span class="tname">{{ noteName(t.path) }}</span>
                <span v-if="dirty(t.path)" class="ndot"></span>
                <span v-if="pairOf(t.path)" class="tpair" :title="'Связано с: ' + noteName(pairOf(t.path)!)"><Icon name="link" :size="10" /></span>
                <button class="tx" title="Закрыть (Ctrl+W)" @click.stop="closeTab(pi, t.path)"><Icon name="x" :size="11" /></button>
              </div>
              </TransitionGroup>
              <button
                class="tnew"
                title="Новая заметка (Ctrl+N)"
                @click="newNote(undefined, pi)"
                @dragover="onTabRowEnd(pi, $event)"
                @drop.prevent="onTabDrop"
              ><Icon name="plus" :size="13" /></button>
            </div>
            <template v-if="tabOf(p) && !isBoard(p.active ?? '')">
              <button
                class="tb"
                :class="{ rec: recInto?.pane === p.id }"
                :title="recInto?.pane === p.id ? 'Остановить запись' : 'Записать голос в эту заметку'"
                :disabled="!!recInto && recInto.pane !== p.id"
                @click="startRec(p)"
              >
                <Icon :name="recInto?.pane === p.id ? 'stop' : 'mic'" :size="14" />
              </button>
              <button class="tb" title="Вставить изображение — или вставьте из буфера (Ctrl+V), или перетащите файл в заметку" @click="pickImages(p)"><Icon name="image" :size="14" /></button>
              <template v-if="runnable(p.active)">
                <button class="tb" title="Скопировать отчёт по заметке: итог, каждый блок, ошибки целиком — готовым текстом" @click="copyNoteReport(p.active!)"><Icon name="clipboard" :size="14" /></button>
                <button class="tb nrun-b" :class="{ on: ctxOpen?.path === p.active }" title="Переменные заметки — что опубликовали её блоки" @click="openCtxPanel(p.active!, $event)"><Icon name="braces" :size="14" /></button>
                <button v-if="noteRun(p.active!).all && !noteRun(p.active!).all!.error" class="tb nrun stop" title="Остановить выполнение" @click="stopRunAll(p.active!)"><Icon name="stop" :size="11" />{{ noteRun(p.active!).all!.done + 1 }}/{{ noteRun(p.active!).all!.total }}</button>
                <button v-else class="tb nrun" title="Выполнить всё: блоки HTTP и кода сверху вниз (данные — сразу); первая ошибка останавливает" @click="runAll(p.active!, docs.get(p.active!)!.text)"><Icon name="play" :size="11" />Выполнить всё</button>
              </template>
            </template>
            <button v-if="pi === layout.panes.length - 1" class="tb" :class="{ on: layout.wide }" :title="layout.wide ? 'Обычная ширина текста (820 px)' : 'Текст на всю ширину (с отступами по краям)'" @click="layout.wide = !layout.wide"><Icon name="expand" :size="14" /></button>
            <button v-if="pi === layout.panes.length - 1" class="tb" :class="{ on: helpOpen }" title="Инструкция: блокнот и тестирование" @click="helpOpen = true"><Icon name="book" :size="14" /></button>
            <button class="tb" :class="{ on: layout.panes.length > 1 }" :title="layout.panes.length > 1 ? 'Одна колонка (Ctrl+\\)' : 'Разделить'" @click="toggleSplit">
              <Icon name="columns" :size="14" />
            </button>
          </div>

          <div v-if="tabOf(p) && p.active" class="pbody" :class="{ paired: !!pairOf(p.active) }" :style="layout.wide ? { '--note-max': 'none', '--note-pad': '32px' } : undefined">
            <div v-if="pairOf(p.active)" class="pairsw">
              <button class="pswap" :title="`Показать ${isBoard(p.active) ? 'заметку' : 'доску'} «${noteName(pairOf(p.active)!)}» здесь`" @click="showPair(pi)">
                <Icon :name="isBoard(p.active) ? 'note' : 'presentation'" :size="13" /><span>{{ isBoard(p.active) ? 'Текст' : 'Доска' }}</span>
              </button>
              <button title="Открыть рядом (в другой колонке)" @click="showPair(pi, true)"><Icon name="columns" :size="12" /></button>
            </div>
            <div v-if="recInto?.pane === p.id && !recInto.inline" class="recbar">
              <span class="rdot"></span>
              <span class="meter"><span :style="{ width: `${recorder.level.value * 100}%` }"></span></span>
              <b>{{ fmtSec(recorder.sec.value) }}</b>
              <span class="muted">запись в заметку…</span>
              <button class="stop" @click="stopRec"><Icon name="stop" :size="11" />Остановить</button>
            </div>
            <div v-if="isBoard(p.active)" class="pboard">
              <BoardView
                v-if="docs.get(p.active)?.loaded"
                :key="`${p.id}:${p.active}`"
                :path="p.active"
                :text="docs.get(p.active)!.text"
                @change="(t) => setText(p.active!, t)"
                @info="(t) => (boardInfo = { ...boardInfo, [p.active!]: t })"
                @warn="say"
              />
            </div>
            <div v-else class="pscroll" :style="{ fontSize: `${(BASE_PX * (layout.zoom || 100)) / 100}px` }" @wheel="onPaneWheel" @mousedown="onPaneDown($event, p)">
              <div class="crumbs">
                <template v-for="(c, ci) in dirOf(p.active).split('/').filter(Boolean)" :key="ci"><span>{{ c }}</span><Icon name="chevronRight" :size="10" /></template>
                <span class="leaf"><NodeMark v-if="emojiOf(p.active) || colorOf(p.active)" :emoji="emojiOf(p.active)" :color="colorOf(p.active)" icon="note" :size="13" />{{ noteName(p.active) }}</span>
              </div>
              <input
                :ref="(el) => el && titleEls.set(p.id, el as HTMLInputElement)"
                class="ntitle"
                :value="noteName(p.active)"
                spellcheck="false"
                title="Название заметки — это имя файла"
                @change="rename(p.active!, ($event.target as HTMLInputElement).value)"
                @keydown="onTitleKey($event, p)"
              />
              <div class="nmeta">
                <span v-if="created(p.active)" title="Дата создания файла"><Icon name="clock" :size="11" />Создано {{ created(p.active) }}</span>
              </div>
              <template v-if="docs.get(p.active)?.loaded">
                <MdEditor
                  :key="`${p.id}:${p.active}`"
                  :ref="(el) => setEditor(`${p.id}:${p.active}`, el)"
                  :text="docs.get(p.active)!.text"
                  :path="p.active"
                  @change="(t) => setText(p.active!, t)"
                  @wiki="(w) => openWiki(w)"
                  @transcribe="(a) => transcribeInto(p.active!, a)"
                  @drop-audio="(a) => dropAudio(p.active!, a)"
                  @to-event="(t, at) => toEvent(p, t, at)"
                  @exit-up="titleUp(p)"
                  @warn="say"
                  @record="!recInto && startRec(p)"
                  @stop-rec="stopRec"
                  :rec="recInto?.pane === p.id && recInto.inline ? { sec: recorder.sec.value, level: recorder.level.value } : undefined"
                  @pick-image="pickImages(p)"
                />
              </template>
            </div>
            <div class="pstatus">
              <span v-if="docs.get(p.active)?.error" class="err">{{ docs.get(p.active)!.error }}</span>
              <span v-else>{{ dirty(p.active) ? 'Сохраняется…' : 'Сохранено' }}</span>
              <span class="grow"></span>
              <span>{{ isBoard(p.active) ? (boardInfo[p.active] ?? '') : stats(p.active) }}</span>
              <ZoomChip v-if="!isBoard(p.active)" :model-value="layout.zoom || 100" title="Масштаб текста · колесо — изменить, клик — 100%" @update:model-value="setZoom" />
            </div>
          </div>
          <div v-else class="pempty">
            <Icon name="notebook" :size="34" />
            <p>Нет открытой заметки</p>
            <div class="erow">
              <button class="primary" @click="newNote(undefined, pi)"><Icon name="filePlus" :size="14" />Новая заметка</button>
              <button @click="newBoard(undefined, pi)"><Icon name="presentation" :size="14" />Новая доска</button>
              <button @click="toggleSearch(true)"><Icon name="search" :size="14" />Найти</button>
            </div>
            <p class="muted small">Ctrl+N — новая · Ctrl+Shift+F — поиск · Ctrl+\ — две колонки · Ctrl + колесо — масштаб</p>
          </div>
          <template v-if="tabDrag">
            <template v-if="layout.panes.length === 1">
              <div class="dz l" :class="{ hot: zone?.side === 'left' }" @dragover.prevent="zone = { pane: pi, side: 'left' }" @dragleave="zone = undefined" @drop.prevent="onZoneDrop"><span>Разделить влево</span></div>
              <div class="dz r" :class="{ hot: zone?.side === 'right' }" @dragover.prevent="zone = { pane: pi, side: 'right' }" @dragleave="zone = undefined" @drop.prevent="onZoneDrop"><span>Разделить вправо</span></div>
            </template>
            <div v-else-if="tabDrag.pane !== pi" class="dz all" :class="{ hot: zone?.pane === pi }" @dragover.prevent="zone = { pane: pi, side: 'here' }" @dragleave="zone = undefined" @drop.prevent="onZoneDrop"><span>Перенести сюда</span></div>
          </template>
        </section>
      </template>
      <Transition name="fade"><div v-if="msg" class="toast">{{ msg }}</div></Transition>
      <input ref="imgInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple hidden @change="onImagesPicked" />
    </div>

    <Teleport to="body">
      <div v-if="ctxOpen" class="nrun-ctx" :style="{ left: `${ctxOpen.x}px`, top: `${ctxOpen.y}px` }">
        <div class="nrc-h"><b>Переменные заметки</b><span class="grow"></span><button title="Очистить контекст и результаты" @click="clearCtx(ctxOpen.path)"><Icon name="trash" :size="12" /></button></div>
        <div v-for="(it, k) in noteRun(ctxOpen.path).ctx" :key="k" class="nrc-r" :title="`{{ ${k} }} — из блока «${it.block}» · ${new Date(it.at).toLocaleString('ru-RU')}`">
          <code>{{ k }}</code><span class="nrc-f">{{ FROM[it.from] }}</span><span class="nrc-v">{{ summary(it.value) }}</span>
        </div>
        <p v-if="!Object.keys(noteRun(ctxOpen.path).ctx).length" class="nrc-e">Пока пусто: выполните блоки — их результаты появятся здесь. В тексте: {{ '{' }}{{ '{' }} имя.путь {{ '}' }}{{ '}' }}</p>
        <p v-if="noteRun(ctxOpen.path).all?.error" class="nrc-err">Остановилось на «{{ noteRun(ctxOpen.path).all!.at }}»: {{ noteRun(ctxOpen.path).all!.error }}</p>
      </div>
      <div v-if="emojiFor" class="nemo" :style="{ left: `${emojiFor.x}px`, top: `${emojiFor.y}px` }" @pointerdown.stop>
        <EmojiPick @pick="(u) => (setEmoji(emojiFor!.node, u), (emojiFor = undefined))" />
      </div>
    </Teleport>
    <EventCard v-if="evCard" :key="evCard.id" :day="evCard.day" :id="evCard.id" :x="evCard.x" :y="evCard.y" :path="evCard.path" @close="evCard = undefined" />
    <EventModal v-if="eventText !== undefined" :text="eventText" @created="onEventMade" @close="eventText = undefined" />
    <Teleport to="body">
      <div v-if="ctx" class="nctx" :style="{ left: `${ctx.x}px`, top: `${ctx.y}px` }" @pointerdown.stop>
        <template v-if="!ctx.node || ctx.node.dir">
          <button @click="ctxRun((n) => newNote(n?.path ?? ''))"><Icon name="filePlus" :size="13" />Новая заметка</button>
          <button @click="ctxRun((n) => newBoard(n?.path ?? ''))"><Icon name="presentation" :size="13" />Новая доска</button>
          <button @click="ctxRun((n) => newFolder(n?.path ?? ''))"><Icon name="folderPlus" :size="13" />Новый раздел</button>
          <button @click="ctxRun((n) => importDoc(n?.path ?? ''))"><Icon name="download" :size="13" />Импорт документа…</button>
        </template>
        <template v-if="ctx.node && !ctx.node.dir">
          <button @click="ctxRun((n) => openFile(n!.path))"><Icon name="note" :size="13" />Открыть</button>
          <button @click="ctxRun((n) => openFile(n!.path, { newPane: true }))"><Icon name="columns" :size="13" />Открыть справа</button>
          <template v-if="ctx.node.pair">
            <button @click="ctxRun((n) => openFile(n!.pair!))"><Icon :name="ctx.node.board ? 'note' : 'presentation'" :size="13" />Открыть связанную {{ ctx.node.board ? 'заметку' : 'доску' }}</button>
            <button @click="ctxRun((n) => pair(n!.path))"><Icon name="link" :size="13" />Отвязать</button>
          </template>
        </template>
        <template v-if="ctx.node">
          <div class="csep"></div>
          <button @click="ctxRun((n) => startRename(n!.path))"><Icon name="pencil" :size="13" />Переименовать</button>
          <button @click="ctxRun((n) => reveal(n!.path))"><Icon name="external" :size="13" />Показать в проводнике</button>
          <button :title="ctx.node.dir ? 'Вся папка одним файлом .qvdoc: подпапки, заметки, доски, картинки — откроется на другом компьютере' : 'Один файл .qvdoc: с картинками, аудио, досками — откроется на другом компьютере'" @click="ctxRun((n) => exportDoc(n!.path))"><Icon name="upload" :size="13" />{{ ctx.node.dir ? 'Экспорт папки в файл…' : 'Экспорт в файл…' }}</button>
          <div class="csep"></div>
          <div class="ccolors" title="Цветная метка">
            <button class="cnone" :class="{ on: !ctx.node.color }" title="Без цвета" @click="ctxRun((n) => setColor(n!))"><Icon name="x" :size="11" /></button>
            <button v-for="c in MARK_COLORS" :key="c" class="cdot" :class="{ on: ctx.node.color === c }" :style="{ background: c }" @click="ctxRun((n) => setColor(n!, c))"></button>
          </div>
          <div class="ccolors cemo" title="Эмодзи-метка (вместе с цветом — на его подложке)">
            <button class="cnone" :class="{ on: !ctx.node.emoji }" title="Без эмодзи" @click="ctxRun((n) => setEmoji(n!))"><Icon name="x" :size="11" /></button>
            <button v-for="e in QUICK_EMOJI" :key="e" class="ce" :class="{ on: ctx.node.emoji === e }" @click="ctxRun((n) => setEmoji(n!, e))">{{ e }}</button>
            <button class="ce more" title="Все эмодзи — с поиском" @click="moreEmoji"><Icon name="more" :size="12" /></button>
          </div>
          <div class="csep"></div>
          <button class="danger" @click="ctxRun((n) => remove(n!))"><Icon name="trash" :size="13" />Удалить</button>
        </template>
      </div>
    </Teleport>
    <NotebookHelp v-if="helpOpen" @close="helpOpen = false" />
  </div>
</template>

<style scoped>
.nb {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}
.grow {
  flex: 1;
}
/* ---------- the side ---------- */
.nside {
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}
.ntools {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 8px 6px;
}
.ntools button,
.tb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.ntools button:hover,
.tb:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.ntools button.on,
.tb.on {
  background: rgb(var(--accent-rgb) / 0.22);
  color: var(--accent-fg);
}
.ntree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 6px 20px;
}
.ntree.drop {
  box-shadow: inset 0 0 0 1px rgb(var(--accent-rgb) / 0.5);
}
.nrow {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 27px;
  padding-right: 6px;
  border-radius: var(--r2);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
.nrow:not(.dir) {
  height: 38px;
}
.nrow:hover {
  background: rgba(255, 255, 255, 0.05);
}
.nrow.cur {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--text-hi);
}
.nrow.sel {
  background: rgba(255, 255, 255, 0.06);
}
.nrow.drop {
  background: rgb(var(--accent-rgb) / 0.25);
  box-shadow: inset 0 0 0 1px rgb(var(--accent-rgb) / 0.7);
}
.chev {
  flex: none;
  color: var(--muted);
}
.fic {
  flex: none;
  color: var(--accent-fg);
}
.fmark {
  flex: none;
  width: 10px;
  height: 10px;
  margin: 0 2px 0 19px;
  border-radius: var(--r2);
}
.fmark.sm {
  margin: 0;
  width: 9px;
  height: 9px;
}
.fic.note {
  margin-left: 17px;
  color: var(--muted);
}
.nname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rin {
  flex: 1;
  min-width: 0;
  padding: 2px 5px;
  border-radius: var(--r2);
  border: 1px solid var(--accent);
  background: var(--bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.ndot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warn);
}
.nempty {
  padding: 12px 10px;
  color: var(--muted);
  font-size: 12.5px;
}
.lnk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-fg);
  font-size: 12px;
}
.nfoot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 11.5px;
}
.nresize,
.psplit {
  flex: none;
  width: 5px;
  cursor: col-resize;
  background: var(--border);
  background-clip: content-box;
  padding: 0 2px;
  margin: 0 -2px;
  z-index: 2;
  transition: background-color 0.12s;
}
.nresize:hover:not(.locked),
.psplit:hover:not(.locked) {
  background-color: rgb(var(--accent-rgb) / 0.85);
}
/* the tablet on a board: the handles do not reach over the board and take no pointer */
.nresize.locked,
.psplit.locked {
  width: 1px;
  margin: 0;
  padding: 0;
  cursor: default;
  pointer-events: none;
}
/* ---------- search ---------- */
.nsearch {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sbox {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 8px 6px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--muted);
}
.sbox:focus-within {
  border-color: var(--accent);
}
.sbox input {
  flex: 1;
  min-width: 0;
  padding: 7px 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.sx {
  display: inline-flex;
  padding: 2px;
  border: 0;
  background: none;
  color: var(--muted);
}
.sres {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 6px 20px;
}
.hit {
  margin-bottom: 6px;
}
.hname {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
}
.hname span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hname em {
  font-style: normal;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}
.hline {
  display: block;
  width: 100%;
  padding: 3px 6px 3px 24px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hname:hover,
.hline:hover {
  background: rgba(255, 255, 255, 0.06);
}
mark {
  background: rgba(255, 183, 77, 0.3);
  color: var(--text-hi);
  border-radius: 2px;
}
/* ---------- panes ---------- */
.npanes {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
}
.pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.pane.cur::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: rgb(var(--accent-rgb) / 0.8);
}
.tabs {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 38px;
  padding: 0 6px 0 4px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.tscroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  align-self: stretch;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  flex: 0 1 190px;
  min-width: 90px;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 31px;
  padding: 0 6px 0 10px;
  border-radius: 4px 4px 0 0;
  color: var(--muted);
  font-size: 12.5px;
  cursor: pointer;
  user-select: none;
}
.tab:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}
.tab.on {
  background: var(--bg);
  color: var(--text-hi);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.tic {
  flex: none;
  opacity: 0.7;
}
.tname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tx {
  flex: none;
  display: inline-flex;
  padding: 2px;
  border: 0;
  border-radius: var(--r2);
  background: none;
  color: var(--muted);
  opacity: 0;
}
.tab:hover .tx,
.tab.on .tx {
  opacity: 1;
}
.tx:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}
.tnew {
  flex: none;
  align-self: flex-end;
  margin-bottom: 4px;
  display: inline-flex;
  padding: 5px;
  border: 0;
  border-radius: var(--r2);
  background: none;
  color: var(--muted);
}
.tnew:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.tb.rec {
  background: rgba(255, 61, 61, 0.2);
  color: var(--down-fg);
}
.tb:disabled {
  opacity: 0.35;
}
.pbody {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.crumbs {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px 0;
  color: var(--muted);
  font-size: 12px;
}
.crumbs .leaf {
  color: var(--text-2);
}
.pscroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.pscroll > :last-child {
  flex: 1;
}
.nmeta {
  box-sizing: border-box;
  width: 100%;
  max-width: var(--note-max, 820px);
  margin: -2px auto 8px;
  padding: 0 calc(24px + var(--note-pad, 0px)) 0 calc(52px + var(--note-pad, 0px));
  color: var(--muted);
  font-size: 11.5px;
}
.nmeta span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.zoom {
  display: inline-flex;
  align-items: center;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  overflow: hidden;
}
.zoom button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  min-width: 20px;
  padding: 0 4px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
}
.zoom button:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
}
.zoom .zv {
  min-width: 42px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  color: var(--accent-fg);
}
.tab.dragging {
  opacity: 0.45;
}
.tlist {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
}
/* the tabs make room for a dragged one */
.tabmv-move {
  transition: transform 0.16s ease;
}
.tpair {
  display: inline-flex;
  color: var(--accent-fg);
}
.dz {
  position: absolute;
  top: 36px;
  bottom: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed transparent;
  border-radius: 4px;
  color: transparent;
  font-size: 13px;
  transition: background 0.12s, border-color 0.12s;
}
.dz.l {
  left: 0;
  width: 30%;
}
.dz.r {
  right: 0;
  width: 30%;
}
.dz.all {
  left: 0;
  right: 0;
}
.dz span {
  pointer-events: none;
}
.dz.hot {
  border-color: var(--accent);
  background: rgb(var(--accent-rgb) / 0.14);
  color: var(--accent-fg);
}
/* a linked file: the switch is a column of its own at the right (nothing under it — no cursor fights) */
.pbody.paired > :not(.pairsw) {
  margin-right: 26px;
}
.pairsw {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 6;
  width: 26px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 4px;
  border-left: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.015);
}
.pairsw button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin: 0 2px;
  padding: 7px 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--accent-fg);
  font-size: 10.5px;
  cursor: pointer;
}
.pairsw button span {
  writing-mode: vertical-rl;
}
.pairsw button:hover {
  background: rgb(var(--accent-rgb) / 0.18);
  color: var(--text-hi);
}
.npair {
  display: inline-flex;
  flex: none;
  color: var(--accent-fg);
}
/* a linked note + board: one plaque, a bar on the left */
.nrow.grp-top,
.nrow.grp-bot {
  border-radius: 0;
  background: rgb(var(--accent-rgb) / 0.07);
  box-shadow: inset 3px 0 0 rgb(var(--accent-rgb) / 0.75);
}
.nrow.grp-top {
  margin-top: 2px;
  border-radius: 4px 4px 0 0;
}
.nrow.grp-bot {
  margin-bottom: 2px;
  border-radius: 0 0 4px 4px;
}
.nrow.grp-top:hover,
.nrow.grp-bot:hover {
  background: rgb(var(--accent-rgb) / 0.13);
}
.nrow.grp-top.cur,
.nrow.grp-bot.cur {
  background: rgb(var(--accent-rgb) / 0.22);
}
.nrow.grp-top .npair,
.nrow.grp-bot .npair {
  display: none;
}
.nrow.pairdrop {
  background: rgb(var(--accent-rgb) / 0.22);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.sortwrap {
  display: inline-flex;
}
/* the sort menu — teleported to <body> (placed by placeFloat) */
.sortmenu {
  box-sizing: border-box;
  overflow-y: auto;
  padding: 5px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--panel-2);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
}
/* (out of the tool bar: its button look is given here) */
.sortmenu button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: auto;
  height: auto;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  white-space: nowrap;
}
.sortmenu button:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.sortmenu button.on {
  background: rgb(var(--accent-rgb) / 0.16);
}
.sortmenu .sp {
  display: inline-block;
  width: 12px;
}
.ntitle {
  box-sizing: border-box;
  width: 100%;
  max-width: var(--note-max, 820px);
  margin: 18px auto 6px;
  padding: 0 calc(24px + var(--note-pad, 0px)) 0 calc(52px + var(--note-pad, 0px));
  border: 0;
  background: transparent;
  color: var(--text-hi);
  font: inherit;
  font-size: 1.8em;
  font-weight: 700;
  outline: none;
}
.recbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px auto 0;
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 61, 61, 0.4);
  background: rgba(255, 61, 61, 0.08);
  font-size: 12.5px;
}
.rdot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--down);
  animation: blink 1s infinite;
}
@keyframes blink {
  50% {
    opacity: 0.3;
  }
}
.meter {
  width: 90px;
  height: 5px;
  border-radius: var(--r2);
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.meter span {
  display: block;
  height: 100%;
  background: var(--down-fg);
}
.recbar b {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.stop {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: var(--r2);
  font-size: 12px;
}
.pstatus {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 11.5px;
}
.err {
  color: var(--down-fg);
}
.pempty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--muted);
}
.pempty p {
  margin: 0;
}
.erow {
  display: flex;
  gap: 8px;
}
.erow button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.small {
  font-size: 12px;
}
.toast {
  position: absolute;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 4px;
  background: var(--border-2);
  border: 1px solid var(--border);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  font-size: 12.5px;
  z-index: 10;
}
</style>

<style>
/* the right-click menu of the notebook's tree — teleported to <body> */
.nctx {
  position: fixed;
  z-index: 5000;
  min-width: 210px;
  padding: 5px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--panel-2);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
}
.nctx button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.nctx button:hover {
  background: rgb(var(--accent-rgb) / 0.2);
}
.nctx button.danger {
  color: var(--down-fg);
}
.nctx .ccolors {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 6px;
}
.nctx .ccolors button {
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: var(--r2);
  justify-content: center;
}
.nctx .ccolors .cdot.on {
  box-shadow: 0 0 0 2px var(--panel-2), 0 0 0 3.5px var(--text-hi);
}
.nctx .ccolors .cnone {
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--muted);
}
.nctx .ccolors .cnone.on {
  border-color: var(--text-hi);
}
.tb.nrun {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: auto;
  padding: 0 9px;
  border-radius: var(--r2);
  background: var(--accent);
  color: var(--on-accent, #fff);
  font-size: 12px;
}
.tb.nrun.stop {
  background: #ef4444;
  color: #fff;
}
.nrun-ctx {
  position: fixed;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 360px;
  max-height: 420px;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
  font-size: 12.5px;
}
.nrc-h {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px 6px;
}
.nrc-h button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.nrc-r {
  display: grid;
  grid-template-columns: minmax(0, auto) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: var(--r2);
}
.nrc-r:hover {
  background: var(--hover);
}
.nrc-r code {
  color: var(--accent-fg);
  font-family: var(--font-data);
}
.nrc-f {
  color: var(--dim);
  font-size: 11px;
}
.nrc-v {
  overflow: hidden;
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nrc-e,
.nrc-err {
  margin: 4px;
  color: var(--muted);
  font-size: 12px;
}
.nrc-err {
  color: var(--down-fg);
}
.nctx .cemo {
  gap: 2px;
}
.nctx .ccolors .ce {
  width: 22px;
  height: 22px;
  font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
  font-size: 14px;
}
.nctx .ccolors .ce.on {
  box-shadow: 0 0 0 1.5px var(--text-hi);
}
.nctx .ccolors .ce.more {
  color: var(--muted);
}
.nemo {
  position: fixed;
  z-index: 5000;
}
.crumbs .leaf {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* (an emoji is a bit wider than an icon: the name stays where the others are) */
.fic.emo {
  margin-left: 14px;
  margin-right: -3px;
}
.nctx .csep {
  height: 1px;
  margin: 4px 6px;
  background: rgba(255, 255, 255, 0.08);
}
.pboard {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.pboard > .bd {
  flex: 1;
  min-height: 0;
}
.ncol {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.ndate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dim);
  font-size: 10.5px;
}
</style>
