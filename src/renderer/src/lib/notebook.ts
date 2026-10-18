import { reactive, ref, shallowRef, watch } from 'vue'
import { audiosOf, filesOf, imagesOf, remapPath, type VaultNode } from '@shared/vault'
import { toWav16k } from './recorder'
import { remapHistory } from './boardHistory'

/**
 * The notebook's state, shared by everything that shows it (and kept while another section is open, so coming
 * back is instant): the tree, the open documents with autosave, and the panes with their tabs.
 */

// ---------- the tree ----------
export const tree = shallowRef<VaultNode[]>([])
export const files = shallowRef<string[]>([])
export async function loadTree(): Promise<void> {
  tree.value = await window.qa.vaultTree()
  files.value = filesOf(tree.value)
}

// ---------- documents: one per path, whatever number of panes show it ----------
export interface Doc {
  text: string
  /** What is on disk (text ≠ saved → a save is pending). */
  saved: string
  loaded: boolean
  error?: string
}
export const docs = reactive(new Map<string, Doc>())
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const SAVE_MS = 350

export function doc(path: string): Doc {
  let d = docs.get(path)
  if (!d) {
    docs.set(path, { text: '', saved: '', loaded: false })
    d = docs.get(path)!
    void window.qa
      .vaultRead(path)
      .then((t) => {
        // typed into it before it loaded (a brand new note) — keep that
        if (!d!.loaded && d!.text === '') d!.text = t
        d!.saved = t
        d!.loaded = true
        if (d!.text !== t) void save(path)
      })
      .catch((e: Error) => {
        d!.error = e.message
        d!.loaded = true
      })
  }
  return d
}

/** Typed: kept in memory at once, written to disk shortly after the last key. */
export function setText(path: string, text: string): void {
  const d = doc(path)
  if (d.text === text) return
  d.text = text
  clearTimeout(timers.get(path))
  timers.set(path, setTimeout(() => void save(path), SAVE_MS))
}
export async function save(path: string): Promise<void> {
  clearTimeout(timers.get(path))
  timers.delete(path)
  const d = docs.get(path)
  if (!d || !d.loaded || d.text === d.saved) return
  const text = d.text
  const before = d.saved
  try {
    await window.qa.vaultWrite(path, text)
    d.saved = text
    d.error = undefined
    void syncAudio(before, text)
    void syncImages(before, text)
  } catch (e) {
    d.error = e instanceof Error ? e.message : String(e)
  }
}
/**
 * A recording's line removed from a note → its file is deleted from the disk (if no other note embeds it).
 * Its bytes are kept for this session: an undo that brings the line back puts the file back too.
 */
const removedAudio = new Map<string, Uint8Array>()
async function syncAudio(before: string, after: string): Promise<void> {
  const was = new Set(audiosOf(before))
  const now = new Set(audiosOf(after))
  for (const rel of now)
    if (!was.has(rel) && removedAudio.has(rel)) {
      await window.qa.vaultRestoreAudio(rel, removedAudio.get(rel)!)
      removedAudio.delete(rel)
    }
  for (const rel of was) {
    if (now.has(rel)) continue
    try {
      const bytes = await window.qa.vaultReadAudio(rel)
      if (await window.qa.vaultDeleteAudio(rel)) removedAudio.set(rel, bytes)
    } catch {
      // already gone
    }
  }
}
/**
 * A picture gone from a note / a board → its file is deleted from the disk (if nothing else has it); kept for
 * this session, so that an undo brings it back.
 */
const removedImages = new Map<string, Uint8Array>()
async function syncImages(before: string, after: string): Promise<void> {
  const was = new Set(imagesOf(before))
  const now = new Set(imagesOf(after))
  for (const rel of now)
    if (!was.has(rel) && removedImages.has(rel)) {
      await window.qa.vaultRestoreImage(rel, removedImages.get(rel)!)
      removedImages.delete(rel)
      imageUrls.delete(rel)
    }
  for (const rel of was) {
    if (now.has(rel)) continue
    try {
      const bytes = await window.qa.vaultReadImage(rel)
      if (await window.qa.vaultDeleteImage(rel)) removedImages.set(rel, bytes)
    } catch {
      // already gone
    }
  }
}
/** A picture of the vault as an address the page can show (made once per run). */
const imageUrls = new Map<string, Promise<string>>()
export function imageUrl(rel: string): Promise<string> {
  let u = imageUrls.get(rel)
  if (!u) {
    u = window.qa.vaultReadImage(rel).then((b) => URL.createObjectURL(new Blob([b as BlobPart])))
    u.catch(() => imageUrls.delete(rel))
    imageUrls.set(rel, u)
  }
  return u
}
const IMAGE_FILE = /^image\/(png|jpeg|gif|webp|bmp)$/
/**
 * Pictures from a drop / a paste / a file picker → the vault: their paths (each picture that could not be
 * taken is reported, the rest still go in). Files first; else an image's address (dragged from a web page).
 */
export async function takeImages(dt: { files?: FileList | File[] | null; uri?: string }, warn: (msg: string) => void): Promise<string[]> {
  const out: string[] = []
  const files = [...(dt.files ?? [])].filter((f) => IMAGE_FILE.test(f.type))
  for (const f of files) {
    try {
      out.push(await window.qa.vaultSaveImage(new Uint8Array(await f.arrayBuffer())))
    } catch (e) {
      warn(`«${f.name}»: ${e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)}`)
    }
  }
  if (!files.length && dt.uri) {
    try {
      out.push(await window.qa.vaultFetchImage(dt.uri))
    } catch (e) {
      warn(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }
  return out
}
/** Does a drag / a paste carry pictures (files, or an image dragged from a page)? */
export function hasImages(dt: DataTransfer | null): boolean {
  if (!dt) return false
  if ([...dt.items].some((i) => i.kind === 'file' && IMAGE_FILE.test(i.type))) return true
  return [...dt.files].some((f) => IMAGE_FILE.test(f.type))
}
/** An image's address in a drag from a web page (none — undefined). */
export function draggedImageUrl(dt: DataTransfer | null): string | undefined {
  if (!dt) return undefined
  const html = dt.getData('text/html')
  const m = /<img[^>]+src="([^"]+)"/i.exec(html)
  const src = m?.[1]?.replace(/&amp;/g, '&')
  if (src && (/^https?:\/\//i.test(src) || src.startsWith('data:image/'))) return src
  return undefined
}

/** "Delete the audio, keep the transcript": the recording's line goes, and with it the file. */
export async function dropAudio(path: string, audio: string): Promise<void> {
  const d = doc(path)
  const lines = d.text.split('\n')
  const i = lines.findIndex((l) => l.trim() === `![[${audio}]]`)
  if (i < 0) return
  lines.splice(i, 1)
  // no double blank line left behind
  if (i < lines.length && i > 0 && !lines[i].trim() && !lines[i - 1].trim()) lines.splice(i, 1)
  setText(path, lines.join('\n'))
  await save(path)
}
export async function saveAll(): Promise<void> {
  await Promise.all([...docs.keys()].map(save))
}
window.addEventListener('beforeunload', () => void saveAll())

/** Changed outside the app: an open note without unsaved typing is reloaded. */
export async function onOutside(paths: string[]): Promise<void> {
  await loadTree()
  for (const p of paths) {
    const d = docs.get(p)
    if (!d || d.text !== d.saved) continue
    try {
      const t = await window.qa.vaultRead(p)
      d.text = t
      d.saved = t
    } catch {
      // deleted outside: its tab closes
      closeEverywhere(p)
    }
  }
}

// ---------- panes & tabs ----------
export interface Tab {
  path: string
  mode: 'edit' | 'read'
}
export interface Pane {
  id: string
  tabs: Tab[]
  active?: string
}
interface Layout {
  panes: Pane[]
  cur: number
  /** The left pane's share when split. */
  split: number
  side: number
  open: string[]
  sideTab: 'files' | 'search'
  /** The text's scale, % (Ctrl + wheel). */
  zoom: number
  sort: SortMode
  /** The files panel is hidden. */
  sideHidden?: boolean
}
export type SortMode = 'name' | 'name-desc' | 'mtime' | 'mtime-old' | 'ctime' | 'ctime-old'
export const SORTS: Array<{ id: SortMode; label: string }> = [
  { id: 'name', label: 'По имени (А → Я)' },
  { id: 'name-desc', label: 'По имени (Я → А)' },
  { id: 'mtime', label: 'Изменённые — новые сверху' },
  { id: 'mtime-old', label: 'Изменённые — старые сверху' },
  { id: 'ctime', label: 'Созданные — новые сверху' },
  { id: 'ctime-old', label: 'Созданные — старые сверху' },
]
/** Folders first, then by the chosen order. */
export function sortNodes(ns: VaultNode[], mode: SortMode): VaultNode[] {
  const by: Record<SortMode, (a: VaultNode, b: VaultNode) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }),
    'name-desc': (a, b) => b.name.localeCompare(a.name, 'ru', { numeric: true }),
    mtime: (a, b) => b.mtime - a.mtime,
    'mtime-old': (a, b) => a.mtime - b.mtime,
    ctime: (a, b) => b.ctime - a.ctime,
    'ctime-old': (a, b) => a.ctime - b.ctime,
  }
  return [...ns].sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : by[mode](a, b)))
}
const KEY = 'qa.nb'
function readLayout(): Layout {
  const def: Layout = { panes: [{ id: 'p1', tabs: [] }], cur: 0, split: 0.5, side: 260, open: [], sideTab: 'files', zoom: 100, sort: 'name' }
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Layout> | null
    if (!v?.panes?.length) return def
    return { ...def, ...v, cur: Math.min(v.cur ?? 0, v.panes.length - 1) }
  } catch {
    return def
  }
}
export const layout = reactive<Layout>(readLayout())
watch(
  layout,
  () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout))
    } catch {
      // not remembered — fine
    }
  },
  { deep: true },
)
export const curPane = () => layout.panes[layout.cur] ?? layout.panes[0]
export const activePath = () => curPane()?.active

export function openFile(path: string, opts: { pane?: number; newPane?: boolean } = {}): void {
  if (opts.newPane && layout.panes.length < 2) layout.panes.push({ id: `p${Date.now()}`, tabs: [] })
  const i = opts.newPane ? layout.panes.length - 1 : (opts.pane ?? layout.cur)
  const p = layout.panes[i]
  if (!p.tabs.some((t) => t.path === path)) {
    // next to the active tab
    const at = p.tabs.findIndex((t) => t.path === p.active)
    p.tabs.splice(at < 0 ? p.tabs.length : at + 1, 0, { path, mode: 'edit' })
  }
  p.active = path
  layout.cur = i
  doc(path)
  // its folders open in the tree
  const parts = path.split('/')
  for (let k = 1; k < parts.length; k++) {
    const dir = parts.slice(0, k).join('/')
    if (!layout.open.includes(dir)) layout.open.push(dir)
  }
}
export function closeTab(pi: number, path: string): void {
  const p = layout.panes[pi]
  if (!p) return
  void save(path)
  const i = p.tabs.findIndex((t) => t.path === path)
  if (i < 0) return
  p.tabs.splice(i, 1)
  if (p.active === path) p.active = p.tabs[Math.min(i, p.tabs.length - 1)]?.path
  // an empty second pane goes away
  if (!p.tabs.length && layout.panes.length > 1) {
    layout.panes.splice(pi, 1)
    layout.cur = 0
  }
}
export function closeEverywhere(path: string): void {
  for (let i = layout.panes.length - 1; i >= 0; i--)
    for (const t of [...layout.panes[i].tabs]) if (t.path === path || t.path.startsWith(path + '/')) closeTab(i, t.path)
}
/** The active note in a second pane alongside (or the second pane closes). */
export function toggleSplit(): void {
  if (layout.panes.length > 1) {
    const [a, b] = layout.panes
    for (const t of b.tabs) if (!a.tabs.some((x) => x.path === t.path)) a.tabs.push(t)
    layout.panes.splice(1, 1)
    layout.cur = 0
    return
  }
  const path = activePath()
  layout.panes.push({ id: `p${Date.now()}`, tabs: path ? [{ path, mode: 'edit' }] : [], active: path })
  layout.cur = 1
}

/** Renamed / moved: open documents and tabs (and a board's undo history) follow. */
export function remap(from: string, to: string): void {
  remapHistory(from, to)
  for (const [k, d] of [...docs]) {
    const n = remapPath(k, from, to)
    if (n !== k) {
      docs.delete(k)
      docs.set(n, d)
    }
  }
  for (const p of layout.panes) {
    for (const t of p.tabs) t.path = remapPath(t.path, from, to)
    if (p.active) p.active = remapPath(p.active, from, to)
  }
  layout.open = layout.open.map((x) => remapPath(x, from, to))
}

// ---------- voice in the notes ----------
/** The transcription of a recording in progress: path of the audio → state. */
export const transcribing = reactive(new Map<string, 'run' | 'error'>())
export const transcribeError = ref('')
export async function transcribe(audio: string): Promise<string> {
  transcribing.set(audio, 'run')
  transcribeError.value = ''
  try {
    const bytes = await window.qa.vaultReadAudio(audio)
    const wav = await toWav16k(new Blob([bytes as BlobPart], { type: 'audio/webm' }))
    const text = await window.qa.vaultTranscribe(wav)
    transcribing.delete(audio)
    return text
  } catch (e) {
    transcribing.set(audio, 'error')
    transcribeError.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
    throw e
  }
}
/** The transcript goes right under its recording (as plain text — it can be edited). */
export function putTranscript(path: string, audio: string, text: string): void {
  const d = doc(path)
  const lines = d.text.split('\n')
  const i = lines.findIndex((l) => l.trim() === `![[${audio}]]`)
  const body = text.trim() || '(тишина — ничего не распознано)'
  if (i < 0) lines.push('', body)
  else lines.splice(i + 1, 0, body, '')
  setText(path, lines.join('\n'))
}

/** Blob URLs of the recordings (read once). */
const urls = new Map<string, Promise<string>>()
export function audioUrl(rel: string): Promise<string> {
  let u = urls.get(rel)
  if (!u) {
    u = window.qa.vaultReadAudio(rel).then((b) => URL.createObjectURL(new Blob([b as BlobPart], { type: 'audio/webm' })))
    u.catch(() => urls.delete(rel))
    urls.set(rel, u)
  }
  return u
}

/** The active tab of a pane shows its linked file instead (a note ↔ its board), in the same place. */
export function swapTab(pi: number, to: string): void {
  const p = layout.panes[pi]
  if (!p?.active) return
  const from = p.active
  const i = p.tabs.findIndex((t) => t.path === from)
  if (p.tabs.some((t) => t.path === to)) p.tabs.splice(i, 1)
  else p.tabs[i] = { path: to, mode: 'edit' }
  p.active = to
  doc(to)
}
/** A tab dropped at the edge: the panes split, the tab goes to the new side. */
export function splitWith(fromPane: number, path: string, side: 'left' | 'right'): void {
  if (layout.panes.length > 1) return
  const pane = { id: `p${Date.now()}`, tabs: [] as Tab[], active: undefined as string | undefined }
  if (side === 'right') {
    layout.panes.push(pane)
    moveTab(fromPane, path, 1, 0)
  } else {
    layout.panes.unshift(pane)
    moveTab(fromPane + 1, path, 0, 0)
  }
}

/** A tab dragged onto another place (in its pane or the other one). */
export function moveTab(fromPane: number, path: string, toPane: number, index: number): void {
  const a = layout.panes[fromPane]
  const b = layout.panes[toPane]
  if (!a || !b) return
  const i = a.tabs.findIndex((t) => t.path === path)
  if (i < 0) return
  const [tab] = a.tabs.splice(i, 1)
  if (a === b) b.tabs.splice(index > i ? index - 1 : index, 0, tab)
  else {
    const dup = b.tabs.findIndex((t) => t.path === path)
    if (dup >= 0) b.tabs.splice(dup, 1)
    b.tabs.splice(Math.min(index, b.tabs.length), 0, tab)
    if (a.active === path) a.active = a.tabs[Math.min(i, a.tabs.length - 1)]?.path
  }
  b.active = path
  layout.cur = toPane
  if (!a.tabs.length && layout.panes.length > 1 && a !== b) {
    layout.panes.splice(fromPane, 1)
    layout.cur = 0
  }
}

export { fixDuration } from './recorder'

export const noteName = (path: string) => (path.split('/').pop() ?? path).replace(/\.(md|qboard)$/i, '')
export const dirOf = (path: string) => path.split('/').slice(0, -1).join('/')
