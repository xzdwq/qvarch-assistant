import { shallowRef, watch } from 'vue'
import type { VaultNode } from '@shared/vault'
import { findNode } from '@shared/vaultTree'
import { guardDeletions, planFolder, type FolderStep, type LocalNote, type SharedFolderLink } from '@shared/transport/sharedFolder'
import { formatOf, sharedDocOfFile } from '@shared/transport/sharedFormats'
import { toB64 } from '@shared/transport/sharedText'
import { docTitleOf, ROLE_RIGHTS, type Space } from '@shared/transport/space'
import { serverCall, serverOnline } from '@renderer/lib/transport'
import { onServerEvents } from '@renderer/lib/serverEvents'
import { docs, setText } from './noteDocs'
import { closeEverywhere } from './paneLayout'
import { adopt, fetchText, joinDoc, SHARED_FOLDER, spaces, track, untrack } from './sharedDocs'
import { remap } from './noteSync'
import { loadTree, tree } from './vaultTreeStore'

/**
 * The shared folders of this notebook: a folder linked to a space (its `.qa-space`) is kept in step with the server's
 * list of its documents — a note added, moved, renamed or deleted here goes to everyone, and theirs come here;
 * every document of it is kept in step though not open (others' edits written to its file).
 */
const online = serverOnline
const SYNC_MS = 700

/** A path in the folder → in the notebook, and back. */
const inDir = (dir: string, rel: string) => (dir ? `${dir}/${rel}` : rel)
const relIn = (dir: string, path: string) => (dir ? path.slice(dir.length + 1) : path)
const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')
const nameOf = docTitleOf

/** A file's text now (the open one's, else the file's). */
async function textOf(path: string): Promise<string> {
  const d = docs.get(path)
  return d?.loaded ? d.text : window.qa.vaultRead(path)
}
/** The notes and boards of a folder (its subfolders too) in a tree; the folder not in it — undefined (not «empty»). */
function notesUnder(dir: string, nodes: VaultNode[] = tree.value): string[] | undefined {
  const top = dir ? findNode(nodes, dir) : undefined
  if (dir && !top?.dir) return undefined
  const out: string[] = []
  const walk = (ns: VaultNode[]) => ns.forEach((n) => (n.dir ? walk(n.children ?? []) : formatOf(n.path) && out.push(n.path)))
  walk(top ? (top.children ?? []) : nodes)
  return out
}
/**
 * The folder's notes as they are on the disk now, each with its document — read anew (the page's tree may not be
 * loaded yet); the folder not found or a note not read — undefined: nothing may be planned from a listing not sure.
 */
async function listFolder(dir: string): Promise<LocalNote[] | undefined> {
  const paths = notesUnder(dir, await window.qa.vaultTree())
  if (!paths) return undefined
  const out: LocalNote[] = []
  for (const path of paths) {
    const text = await textOf(path).catch(() => undefined)
    if (text === undefined) return undefined
    out.push({ path: relIn(dir, path), doc: sharedDocOfFile(path, text) })
  }
  return out
}
/** A note moved within the notebook (open tabs follow); its new path. */
async function moveNote(from: string, to: string): Promise<string> {
  const moved = await window.qa.vaultMove(from, parentOf(to), nameOf(to))
  remap(from, moved)
  return moved
}

/** A document of the server made here: its text fetched, its note / board written (a free name when taken). */
async function fetchDoc(dir: string, doc: string, rel: string): Promise<string> {
  const fmt = formatOf(rel)
  if (!fmt) throw new Error(`не заметка и не доска: ${rel}`)
  const text = await fetchText(doc, fmt)
  const path = await window.qa.vaultCreate(inDir(dir, parentOf(rel)), fmt.kind, nameOf(rel), text)
  track(doc, path, text)
  return path
}

/** Each step done here and with the server; `known` — where each document is now. */
const STEPS: { [K in FolderStep['do']]: (s: Extract<FolderStep, { do: K }>, dir: string, sp: Space, known: Record<string, string>) => Promise<void> } = {
  fetch: async (s, dir, _sp, known) => {
    known[s.doc] = relIn(dir, await fetchDoc(dir, s.doc, s.path))
  },
  moveLocal: async (s, dir, _sp, known) => {
    const path = await moveNote(inDir(dir, s.from), inDir(dir, s.to))
    known[s.doc] = relIn(dir, path)
    track(s.doc, path, await textOf(path))
  },
  moveServer: async (s, dir, _sp, known) => {
    const r = await serverCall('space.moveDoc', { doc: s.doc, path: s.path })
    // the path was taken there: the note follows the server's
    const path = r.path === s.path ? inDir(dir, s.path) : await moveNote(inDir(dir, s.path), inDir(dir, r.path))
    known[s.doc] = relIn(dir, path)
    track(s.doc, path, await textOf(path))
  },
  deleteLocal: async (s, dir, _sp, known) => {
    const path = inDir(dir, s.path)
    closeEverywhere(path)
    await window.qa.vaultDelete(path)
    delete known[s.doc]
    untrack(s.doc)
  },
  deleteServer: async (s, _dir, _sp, known) => {
    await serverCall('space.deleteDoc', { doc: s.doc })
    delete known[s.doc]
    untrack(s.doc)
  },
  add: async (s, dir, sp, known) => {
    let path = inDir(dir, s.path)
    const fmt = formatOf(path)!
    // a copy of a shared file: the other document's mark goes (it becomes a document of its own)
    const text = s.stale ? fmt.unmark(await textOf(path)) : await textOf(path)
    const st = fmt.model()
    st.setLocal(text)
    const r = await serverCall('space.addDoc', { space: sp.id, path: s.path, update: toB64(st.state()) })
    if (r.path !== s.path) path = await moveNote(path, inDir(dir, r.path))
    await adopt(r.doc, sp.id, st, path)
    known[r.doc] = r.path
  },
  keep: async (s, dir, _sp, known) => {
    const path = inDir(dir, s.path)
    known[s.doc] = s.path
    track(s.doc, path, await textOf(path))
  },
}
/** One who may not change the space (a reader, a commenter): the folder follows the server, never the other way. */
function asFollower(s: FolderStep, known: Record<string, string>): FolderStep | undefined {
  if (s.do === 'moveServer') return { do: 'moveLocal', doc: s.doc, from: s.path, to: known[s.doc] }
  if (s.do === 'add' || s.do === 'deleteServer') return undefined
  return s
}

/** A shared folder brought into step (one at a time; a change meanwhile — once more after). */
async function bringIntoStep(link: SharedFolderLink): Promise<void> {
  const sp = spaces.get(link.space)
  if (!sp || sp.kind !== 'folder') return
  const local = await listFolder(link.dir)
  if (!local) return void window.qa.sharedLog(`folder ${link.dir}: not read — skipped this time`)
  const known = { ...link.docs }
  const mayEdit = ROLE_RIGHTS[sp.role].edit
  let changedTree = false
  const plan = guardDeletions(planFolder(sp.docs, local, link.docs), sp.docs)
  if (plan.held) window.qa.sharedLog(`folder ${link.dir}: ${plan.held} documents «deleted here» at once — held back, fetched again`)
  for (const planned of plan.steps) {
    const s = mayEdit ? planned : asFollower(planned, link.docs)
    if (!s) continue
    if (s.do !== 'keep') changedTree = true
    await (STEPS[s.do] as (x: FolderStep, dir: string, sp: Space, k: Record<string, string>) => Promise<void>)(s, link.dir, sp, known).catch((e: Error) => console.warn(`shared folder ${s.do}:`, e.message))
  }
  await window.qa.sharedFolderLink(link.dir, { space: link.space, docs: known })
  if (changedTree) await loadTree()
}

/** The shared folders as last brought into step. */
const links = shallowRef<SharedFolderLink[]>([])
/**
 * A path written by someone else (a board block in a shared note: their notebook's path) found here: the same file
 * of a shared folder — its path in the folder ends the written one (`Проекты/Доски/x.qboard` → `Общие/Проекты/Доски/x.qboard`).
 * The longest match wins; none — undefined.
 */
export function sharedPathHere(written: string): string | undefined {
  let best: { path: string; len: number } | undefined
  for (const l of links.value)
    for (const rel of Object.values(l.docs)) {
      if (written !== rel && !written.endsWith(`/${rel}`)) continue
      if (!best || rel.length > best.len) best = { path: inDir(l.dir, rel), len: rel.length }
    }
  return best?.path
}

let running: Promise<void> | undefined
let again = false
let timer: ReturnType<typeof setTimeout> | undefined
/** Every shared folder in step, a moment after the last change. */
function soon(): void {
  clearTimeout(timer)
  timer = setTimeout(() => void runAll(), SYNC_MS)
}
async function runAll(): Promise<void> {
  if (!online.value) return
  if (running) return void (again = true)
  running = (async () => {
    for (const link of await window.qa.sharedFolders()) await bringIntoStep(link)
    links.value = await window.qa.sharedFolders()
  })()
  await running.catch((e: Error) => console.warn('shared folders:', e.message))
  running = undefined
  if (again) {
    again = false
    soon()
  }
}
let started = false
/** The shared folders followed from the app's start: online, the tree changed (here or outside), a space's list changed. */
export function startSharedFolders(): void {
  if (started) return
  started = true
  watch(online, (on) => on && soon(), { immediate: true })
  watch(tree, soon)
  watch(() => [...spaces.values()].filter((s) => s.kind === 'folder').map((s) => JSON.stringify(s.docs)), soon)
  // the space gone for this device: its folder stays as plain notes
  onServerEvents({ 'space.gone': (p) => void unlinkFolder(p.space).catch(() => undefined) })
}

/** A shared note or folder joined by a code: its note / folder made here. Its path. */
export async function joinByCode(code: string): Promise<string> {
  const sp = await serverCall('space.join', { code })
  spaces.set(sp.id, sp)
  return sp.kind === 'folder' ? joinFolder(sp) : joinDoc(sp)
}
/** A note written: the open one's text (the editor follows), else its file. */
async function writeNote(path: string, text: string): Promise<void> {
  if (docs.get(path)?.loaded) setText(path, text)
  else await window.qa.vaultWrite(path, text)
}

/** A folder shared: a space of its own, then each of its notes added to it. */
export async function shareFolder(dir: string): Promise<Space> {
  const r = await serverCall('space.share', { title: nameOf(dir) || 'Блокнот', kind: 'folder' })
  spaces.set(r.space.id, r.space)
  await window.qa.sharedFolderLink(dir, { space: r.space.id, docs: {} })
  await runAll()
  return r.space
}
/** A shared folder joined: made in «Общие», its documents fetched. Its path. */
export async function joinFolder(sp: Space): Promise<string> {
  const had = (await window.qa.sharedFolders()).find((l) => l.space === sp.id)
  if (had) return had.dir
  const dir = await window.qa.vaultCreate(SHARED_FOLDER, 'folder', sp.title)
  await window.qa.sharedFolderLink(dir, { space: sp.id, docs: {} })
  await loadTree()
  await runAll()
  return dir
}
/** The folder of a space left / closed: no longer linked; its notes stay as plain notes (their marks go). */
export async function unlinkFolder(space: string): Promise<void> {
  const link = (await window.qa.sharedFolders()).find((l) => l.space === space)
  if (!link) return
  await window.qa.sharedFolderLink(link.dir, null)
  for (const path of notesUnder(link.dir, await window.qa.vaultTree()) ?? []) {
    const text = await textOf(path).catch(() => '')
    const doc = sharedDocOfFile(path, text)
    if (doc && link.docs[doc] !== undefined) await writeNote(path, formatOf(path)!.unmark(text))
  }
  await loadTree()
}
