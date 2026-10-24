import { computed, reactive, watch, watchEffect } from 'vue'
import type { DeviceInfo, TransportEvent } from '@shared/transport/protocol'
import { formatOf, sharedDocOfFile, type SharedFormat } from '@shared/transport/sharedFormats'
import { fromB64, isEmptyUpdate, mergeUpdates, SharedText, toB64, type SharedModel, type UpdateOrigin } from '@shared/transport/sharedText'
import { QUOTE_MAX, type CommentAnchor } from '@shared/transport/chat'
import { ROLE_RIGHTS, sharedMark, type Space, type SpaceRole } from '@shared/transport/space'
import { serverCall, useTransport } from '@renderer/lib/transport'
import { docs, setText } from './noteDocs'
import { mediaReported } from './noteMedia'

/**
 * The shared files of this window — notes and boards: a file marked as a server's document (a note — its first line
 * `<!-- qa:shared doc=… -->`, a board — `"shared"` in its JSON) is kept in step with it. Its text — typed, drawn, a
 * block's edit, a change of its file — goes in as a change (sharedFormats: a note's text, a board's items); others'
 * changes come out as its new text (autosaved like any). The document's state is kept on this computer: changes made
 * offline reach the server when it is back, a file changed while the app was closed counts as a change.
 */
interface Live {
  fmt: SharedFormat
  st: SharedModel
  /** Its text may be shown: the kept state or the server's is in. */
  ready: boolean
  /** Changes not sent yet. */
  queue: Uint8Array[]
  sendTimer?: ReturnType<typeof setTimeout>
  saveTimer?: ReturnType<typeof setTimeout>
  mediaTimer?: ReturnType<typeof setTimeout>
  /** Asks for its files not here yet, in a row. */
  mediaRetries?: number
  /** Its file's text as last read or written (a shared folder's document not open). */
  fileText?: string
  starting?: Promise<void>
}
/** What the screen shows of a shared document. */
export interface SharedInfo {
  role?: SpaceRole
  space?: string
  /** Who has it open now (this device too). */
  presence: DeviceInfo[]
  /** In step with the server now. */
  live: boolean
}
const SEND_MS = 40
const SAVE_MS = 800
const MEDIA_MS = 1500
/** A file not here yet: asked again this often, this many times (then — on the next change). */
const MEDIA_RETRY_MS = 15_000
const MEDIA_RETRIES = 40
/** Shared notes and folders joined by a code go here. */
export const SHARED_FOLDER = 'Общие'

const lives = new Map<string, Live>()
export const sharedInfo = reactive(new Map<string, SharedInfo>())
/** The spaces of this device (members, roles), as the server last said. */
export const spaces = reactive(new Map<string, Space>())
const transport = useTransport()
const online = computed(() => transport.value.status === 'online')

const info = (doc: string): SharedInfo => {
  if (!sharedInfo.has(doc)) sharedInfo.set(doc, { presence: [], live: false })
  return sharedInfo.get(doc)!
}
/** The shared document of an open file (none — '' ). */
export const sharedDocOfPath = (path: string): string => {
  const d = docs.get(path)
  return d?.loaded ? sharedDocOfFile(path, d.text) : ''
}
/** A file one may only read (a shared one of a reader / commenter). */
export function readonlyPath(path: string): boolean {
  const role = sharedInfo.get(sharedDocOfPath(path))?.role
  return !!role && !ROLE_RIGHTS[role].edit
}
/** The space of a file (shared — its space as the server said). */
export const spaceOfPath = (path: string): Space | undefined => {
  const sp = sharedInfo.get(sharedDocOfPath(path))?.space
  return sp ? spaces.get(sp) : undefined
}
/** The shared document a path is open as (its space too) — for the run results of a note. */
export const sharedOfPath = (path: string): { doc: string; space: string } | undefined => {
  const doc = sharedDocOfPath(path)
  const space = doc ? sharedInfo.get(doc)?.space : undefined
  return doc && space ? { doc, space } : undefined
}

/** Where each shared document is in this notebook (as met: opened, kept in step, found by its mark). */
export const docPaths = reactive(new Map<string, string>())
/** A shared document changed (anyone's change): the comments' places follow it. */
export const sharedTick = reactive({ n: 0 })
/** The open files showing a document. */
const pathsOf = (doc: string) => [...docs].filter(([p, d]) => d.loaded && sharedDocOfFile(p, d.text) === doc).map(([p]) => p)
/** The files of the shared folders' documents (kept in step though not open). */
const files = new Map<string, string>()
/** Every file showing it gets its text (as any change — autosaved); none open — its file is written. */
function show(doc: string, l: Live): void {
  const open = pathsOf(doc)
  for (const p of open) if (docs.get(p)!.text !== l.st.value) setText(p, l.st.value)
  const file = files.get(doc)
  if (!open.length && file && l.fileText !== l.st.value) {
    l.fileText = l.st.value
    void window.qa.vaultWrite(file, l.st.value).catch(() => undefined)
  }
}

function send(doc: string, l: Live): void {
  clearTimeout(l.sendTimer)
  l.sendTimer = setTimeout(() => {
    if (!l.queue.length || !online.value || !info(doc).live) return
    const update = mergeUpdates(l.queue.splice(0))
    // not sent (the connection dropped): the next sync sends whatever the server lacks
    serverCall('doc.update', { doc, update: toB64(update) }).catch(() => (info(doc).live = false))
  }, SEND_MS)
}
function keep(doc: string, l: Live): void {
  clearTimeout(l.saveTimer)
  l.saveTimer = setTimeout(() => void window.qa.sharedSave(doc, toB64(l.st.state())), SAVE_MS)
  l.mediaRetries = 0
  mediaSoon(doc, l)
}
/**
 * The pictures and recordings the file shows in step with the server (a moment after it settles); one not here yet —
 * asked again in a while (an event of its coming may be missed), as long as the document is held.
 */
function mediaSoon(doc: string, l: Live, wait = MEDIA_MS): void {
  clearTimeout(l.mediaTimer)
  l.mediaTimer = setTimeout(() => {
    const space = info(doc).space
    const rels = l.fmt.media(l.st.value)
    if (rels.length) window.qa.sharedLog(`media ask ${doc.slice(0, 8)} space=${space?.slice(0, 8) ?? '—'} online=${online.value} ${rels.join(', ')}`)
    if (!space || !rels.length || !online.value) return
    window.qa
      .sharedMedia(space, rels)
      .then((r) => {
        mediaReported(r)
        if (Object.keys(r.problems).length && lives.get(doc) === l && (l.mediaRetries = (l.mediaRetries ?? 0) + 1) <= MEDIA_RETRIES) mediaSoon(doc, l, MEDIA_RETRY_MS)
      })
      .catch((e: Error) => mediaReported({ fetched: [], problems: Object.fromEntries(rels.map((x) => [x, e.message])) }))
  }, wait)
}

/** A document held: its updates kept, this person's sent, others' shown. */
function hold(doc: string, fmt: SharedFormat, st: SharedModel = fmt.model()): Live {
  let l = lives.get(doc)
  if (l) return l
  l = { fmt, st, ready: false, queue: [] }
  const live = l
  st.onUpdate((u: Uint8Array, origin: UpdateOrigin) => {
    sharedTick.n++
    keep(doc, live)
    if (origin === 'local') {
      live.queue.push(u)
      send(doc, live)
    }
    if (origin === 'remote' && live.ready) show(doc, live)
  })
  lives.set(doc, l)
  return l
}

/** In step with the server: what it has taken, what it lacks sent; its role, the space; its changes come from now on. */
async function sync(doc: string, l: Live): Promise<void> {
  const r = await serverCall('doc.open', { doc, sv: toB64(l.st.stateVector()) })
  absorb(doc, l)
  l.st.apply(fromB64(r.update), 'remote')
  Object.assign(info(doc), { role: r.role, space: r.space, live: true })
  if (!l.ready) {
    // never had it here: the file's text (made from the server's, or changed before) goes on top of the server's
    const p = pathsOf(doc)[0]
    const text = p ? docs.get(p)!.text : l.fileText
    if (text !== undefined) l.st.setLocal(text)
    l.ready = true
    show(doc, l)
  }
  const missing = l.st.missingFor(fromB64(r.sv))
  if (!isEmptyUpdate(missing)) await serverCall('doc.update', { doc, update: toB64(missing) })
  // in step now: the pictures it shows too (nothing may have changed — no update would ask for them)
  mediaSoon(doc, l)
}
/** A shared file met: its kept state in, the file's changes since — a change; then in step with the server. */
function start(doc: string, fmt: SharedFormat, fileText: string): void {
  const l = hold(doc, fmt)
  if (l.starting) return
  l.fileText = fileText
  l.starting = (async () => {
    const kept = await window.qa.sharedLoad(doc)
    if (kept) {
      l.st.apply(fromB64(kept), 'load')
      l.st.setLocal(fileText)
      l.ready = true
    }
    if (online.value) await sync(doc, l)
  })().catch(() => undefined)
}

// every shared file open: started once; its text changed here — a change (one may only read — put back)
watchEffect(() => {
  for (const [path, d] of docs) {
    if (!d.loaded) continue
    const fmt = formatOf(path)
    const doc = fmt?.docOf(d.text)
    if (!fmt || !doc) continue
    docPaths.set(doc, path)
    const l = lives.get(doc)
    if (!l) {
      start(doc, fmt, d.text)
      continue
    }
    if (!l.ready || d.text === l.st.value) continue
    if (readonlyPath(path)) setText(path, l.st.value)
    else l.st.setLocal(d.text)
  }
})
// online again: every document in step; offline — none is
watch(
  online,
  (on) => {
    for (const [doc, l] of lives) {
      if (on) void sync(doc, l).catch(() => undefined)
      else info(doc).live = false
    }
    if (on) void loadSpaces()
  },
  { immediate: true },
)

async function loadSpaces(): Promise<void> {
  const list = await serverCall('space.list', {}).catch(() => undefined)
  if (!list) return
  spaces.clear()
  for (const s of list) spaces.set(s.id, s)
}
/** A space gone for this device: its files stay as plain local ones (the mark goes). */
function leftSpace(space: string): void {
  spaces.delete(space)
  for (const [doc, inf] of sharedInfo) {
    if (inf.space !== space) continue
    for (const p of pathsOf(doc)) setText(p, formatOf(p)!.unmark(docs.get(p)!.text))
    lives.delete(doc)
    sharedInfo.delete(doc)
  }
}
/** The files' changes not in the document yet (made a moment ago) go in first: someone else's change never drops them. */
function absorb(doc: string, l: Live): void {
  if (!l.ready) return
  for (const p of pathsOf(doc)) if (!readonlyPath(p)) l.st.setLocal(docs.get(p)!.text)
}
const EVENTS: Partial<{ [K in TransportEvent['e']]: (p: Extract<TransportEvent, { e: K }>['p']) => void }> = {
  'doc.update': (p) => {
    const l = lives.get(p.doc)
    if (!l) return
    absorb(p.doc, l)
    l.st.apply(fromB64(p.update), 'remote')
  },
  'doc.presence': (p) => (info(p.doc).presence = p.devices),
  'space.changed': (sp) => {
    spaces.set(sp.id, sp)
    for (const inf of sharedInfo.values()) if (inf.space === sp.id) inf.role = sp.role
  },
  'space.gone': (p) => leftSpace(p.space),
  // a picture / a recording came after the note was opened: fetched (a file waited for by the note shows at once)
  'media.added': (p) => {
    const embedded = new Set([...lives.values()].flatMap((l) => l.fmt.media(l.st.value)))
    const rels = p.rels.filter((r) => embedded.has(r))
    window.qa.sharedLog(`media.added ${p.rels.join(', ')} → embedded here: ${rels.join(', ') || 'нет'}`)
    if (rels.length) void window.qa.sharedMedia(p.space, rels).then(mediaReported).catch(() => undefined)
  },
}
window.qa.onServer((ev) => (EVENTS[ev.e] as ((p: unknown) => void) | undefined)?.(ev.p))

/**
 * A file's text made a document of a space (the server gave it its id): its mark put in (the same for everyone), the
 * file written, then in step with the server. Returns the file's new text.
 */
export async function adopt(doc: string, space: string, st: SharedModel, path: string): Promise<string> {
  const fmt = formatOf(path)!
  const l = hold(doc, fmt, st)
  st.setLocal(fmt.mark(st.value, doc))
  l.ready = true
  l.starting = Promise.resolve()
  Object.assign(info(doc), { space })
  docPaths.set(doc, path)
  if (docs.get(path)?.loaded) setText(path, st.value)
  else {
    files.set(doc, path)
    l.fileText = st.value
    await window.qa.vaultWrite(path, st.value)
  }
  await sync(doc, l)
  return st.value
}
/** A note shared: a space of its own, its text the document's first state. */
export async function shareNote(path: string, title: string): Promise<Space> {
  const d = docs.get(path)
  const fmt = formatOf(path)
  if (!d?.loaded || !fmt) throw new Error('Заметка ещё не открыта')
  const st = fmt.model()
  st.setLocal(d.text)
  const r = await serverCall('space.share', { title, update: toB64(st.state()) })
  if (!r.doc) throw new Error('Сервер не создал документ')
  spaces.set(r.space.id, r.space)
  await adopt(r.doc, r.space.id, st, path)
  return r.space
}

/** A shared folder's document kept in step though not open: its file and its text as read now. */
export function track(doc: string, path: string, text: string): void {
  files.set(doc, path)
  docPaths.set(doc, path)
  const l = lives.get(doc)
  const fmt = formatOf(path)
  if (!l) return void (fmt && start(doc, fmt, text))
  // its file changed outside (not open — no editor sees it): a change
  if (l.ready && !pathsOf(doc).length && text !== l.fileText && text !== l.st.value) {
    l.fileText = text
    l.st.setLocal(text)
  }
}
/** A document no longer of a shared folder here (deleted, or the folder left). */
export function untrack(doc: string): void {
  files.delete(doc)
  docPaths.delete(doc)
  lives.delete(doc)
  sharedInfo.delete(doc)
  void serverCall('doc.close', { doc }).catch(() => undefined)
}
/** A place of a shared note (its editor's positions) as a comment's anchor; not a shared note's — none. */
export function anchorFor(path: string, from: number, to: number): CommentAnchor | undefined {
  const l = lives.get(sharedDocOfPath(path))
  if (!l?.ready || !(l.st instanceof SharedText)) return undefined
  // (what was typed a moment ago first: the positions are the editor's)
  absorb(sharedDocOfPath(path), l)
  return { ...l.st.anchor(from, to), quote: l.st.value.slice(from, to).slice(0, QUOTE_MAX) }
}
/** Where a comment's place is in a shared note now (its text gone — `gone`); not known here — none. */
export function rangeFor(path: string, a: CommentAnchor): { from: number; to: number; gone: boolean } | undefined {
  const l = lives.get(sharedDocOfPath(path))
  if (!l?.ready || !(l.st instanceof SharedText)) return undefined
  return l.st.resolve(a) ?? undefined
}
/** A document's text fetched from the server as a new file of this kind: its text, and its state kept here. */
export async function fetchText(doc: string, fmt: SharedFormat): Promise<string> {
  const st = fmt.model()
  const r = await serverCall('doc.open', { doc, sv: toB64(st.stateVector()) })
  st.apply(fromB64(r.update), 'remote')
  await window.qa.sharedSave(doc, toB64(st.state()))
  return st.value
}

/** A shared note joined: its note made in «Общие» (or the one already here). Its path. */
export async function joinDoc(sp: Space): Promise<string> {
  const doc = sp.docs.find((d) => !d.deleted)
  if (!doc) throw new Error('В пространстве нет документов')
  const hits = await window.qa.vaultSearch(sharedMark(doc.id))
  const had = hits.find((h) => h.path.endsWith('.md'))?.path
  if (had) return had
  const fmt = formatOf(doc.path) ?? formatOf('.md')!
  return window.qa.vaultCreate(SHARED_FOLDER, fmt.kind, doc.title, await fetchText(doc.id, fmt))
}
