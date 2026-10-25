import { watch } from 'vue'
import { boardBlocksOf, boardMd } from '@nb/blocks/board/model'
import { formatOf, sharedDocOfFile } from '@shared/transport/sharedFormats'
import { toB64 } from '@shared/transport/sharedText'
import { docTitleOf, ROLE_RIGHTS } from '@shared/transport/space'
import { serverCall, serverOnline } from '@renderer/lib/transport'
import { docs, setText } from './noteDocs'
import { adopt, docPaths, fetchText, sharedOfPath, spaces, track } from './sharedDocs'
import { loadTree, tree } from './vaultTreeStore'

/**
 * The boards of a shared note: a board put into a shared note (`@доска`) becomes a document of the note's space — the
 * block gets its id (`doc:`), the others get the board made next to the note. A board is always found by its id,
 * never by its name: a participant's own board of the same name is never taken for it (a new one gets a free name).
 */
const ATTACH_MS = 1200
const online = serverOnline
const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')

/** Documents looked for by their mark and not found (not asked again until the tree changes). */
const missing = new Set<string>()
/** The file of a shared document here (looked for by its mark when not met yet); none — undefined. */
export function pathOfShared(doc: string): string | undefined {
  const p = docPaths.get(doc)
  if (p || missing.has(doc)) return p
  missing.add(doc)
  void window.qa.sharedFind(doc).then((found) => found && (missing.delete(doc), docPaths.set(doc, found)))
  return undefined
}

/** Boards being made documents now (a second pass meanwhile does not do it twice). */
const attaching = new Set<string>()
/** A board of a shared note made a document of its space (a board shared already — its id taken); its id. */
async function attachBoard(boardPath: string, space: string, kind: 'doc' | 'folder'): Promise<string | undefined> {
  const fmt = formatOf(boardPath)
  if (!fmt) return undefined
  const d = docs.get(boardPath)
  const text = d?.loaded ? d.text : await window.qa.vaultRead(boardPath).catch(() => undefined)
  if (text === undefined) return undefined
  const had = sharedDocOfFile(boardPath, text)
  // a shared folder's board becomes its document by the folder's own sync (not twice)
  if (had || kind === 'folder') return had || undefined
  const st = fmt.model()
  st.setLocal(text)
  const r = await serverCall('space.addDoc', { space, path: boardPath.split('/').pop()!, update: toB64(st.state()) })
  await adopt(r.doc, space, st, boardPath)
  return r.doc
}
/** The boards of the open shared notes one may edit: each one's block given its board's id (made a document if new). */
async function attachAll(): Promise<void> {
  for (const [path, d] of [...docs]) {
    const sh = d.loaded && path.endsWith('.md') ? sharedOfPath(path) : undefined
    const sp = sh && spaces.get(sh.space)
    if (!sh || !sp || !ROLE_RIGHTS[sp.role].edit) continue
    for (const b of boardBlocksOf(d.text)) {
      if (b.doc || !b.path || attaching.has(b.path)) continue
      attaching.add(b.path)
      try {
        const doc = await attachBoard(b.path, sh.space, sp.kind)
        const now = docs.get(path)!.text
        if (doc && now.includes(b.src)) setText(path, now.replace(b.src, boardMd(b.path, b.mode, doc)))
      } catch (e) {
        console.warn('shared board:', (e as Error).message)
      } finally {
        attaching.delete(b.path)
      }
    }
  }
}

/** The boards of the shared notes of this device that are not here yet: made next to their note (a free name). */
async function fetchMissing(): Promise<void> {
  for (const sp of spaces.values()) {
    if (sp.kind !== 'doc') continue
    const note = sp.docs.find((x) => !x.deleted && formatOf(x.path)?.kind === 'note')
    const notePath = note && (docPaths.get(note.id) ?? (await window.qa.sharedFind(note.id)))
    if (!notePath) continue
    for (const x of sp.docs) {
      if (x.deleted || x.id === note.id) continue
      const fmt = formatOf(x.path)
      if (!fmt) continue
      if (docPaths.has(x.id)) continue
      const here = await window.qa.sharedFind(x.id)
      if (here) {
        track(x.id, here, await window.qa.vaultRead(here))
        continue
      }
      const text = await fetchText(x.id, fmt)
      const made = await window.qa.vaultCreate(parentOf(notePath), fmt.kind, docTitleOf(x.path), text)
      missing.delete(x.id)
      track(x.id, made, text)
      await loadTree()
    }
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
function soon(): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (!online.value) return
    void attachAll()
      .then(fetchMissing)
      .catch((e: Error) => console.warn('shared boards:', e.message))
  }, ATTACH_MS)
}
let started = false
/** Followed from the app's start: the open notes' texts (a board put in), the spaces' documents (a board added there). */
export function startSharedAttachments(): void {
  if (started) return
  started = true
  watch(() => [...docs].map(([p, d]) => (p.endsWith('.md') && d.loaded && d.text.includes('```board') ? `${p}:${boardBlocksOf(d.text).length}:${d.text.length}` : '')).join(), soon)
  watch(() => [...spaces.values()].map((s) => s.docs.length).join(), soon)
  watch(online, (on) => on && soon(), { immediate: true })
  // the tree changed: documents not found before may be here now
  watch(tree, () => missing.clear())
}
