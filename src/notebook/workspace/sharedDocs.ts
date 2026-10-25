import { reactive, watch, watchEffect } from 'vue'
import type { DeviceInfo } from '@shared/transport/protocol'
import { formatOf, sharedDocOfFile, type SharedFormat } from '@shared/transport/sharedFormats'
import { fromB64, isEmptyUpdate, mergeUpdates, SharedText, toB64, type SharedModel, type UpdateOrigin } from '@shared/transport/sharedText'
import { NO_MEDIA, ROLE_RIGHTS, sharedMark, type MediaReport, type Space, type SpaceRole } from '@shared/transport/space'
import { serverCall, serverNow, serverOnline, useTransport } from '@renderer/lib/transport'
import { retryDelay } from '@shared/transport/constants'
import { onServerEvents, type ServerEventHandlers } from '@renderer/lib/serverEvents'
import { docs, onSaveAll, setText } from './noteDocs'
import { mediaAsked, mediaExpected, mediaReported } from './mediaFollow'

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
  syncTimer?: ReturnType<typeof setTimeout>
  /** Syncs failed in a row (the next waits longer). */
  syncFails?: number
  /** Asks for its files that failed, in a row (the next waits longer). */
  mediaFails?: number
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
/** (sooner than the file's own save: the state is never older than the file it goes with) */
const SAVE_MS = 250
const MEDIA_MS = 1500
/** Shared notes and folders joined by a code go here. */
export const SHARED_FOLDER = 'Общие'

const lives = new Map<string, Live>()
export const sharedInfo = reactive(new Map<string, SharedInfo>())
/** The spaces of this device (members, roles), as the server last said. */
export const spaces = reactive(new Map<string, Space>())
const online = serverOnline

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
    // not sent (refused, too busy, the connection dropped): a sync a while later sends whatever the server lacks
    serverCall('doc.update', { doc, update: toB64(update) }).catch((e: Error) => failed(doc, l, e))
  }, SEND_MS)
}
/** The document's state kept now, with the text it holds. */
function keepNow(doc: string, l: Live): Promise<void> {
  clearTimeout(l.saveTimer)
  l.saveTimer = undefined
  return window.qa.sharedSave(doc, { state: toB64(l.st.state()), text: l.st.value }).catch(() => undefined)
}
/** Every state waiting to be kept — kept now (the notes are being saved: the window closes, reloads). */
async function keepAll(): Promise<void> {
  await Promise.all([...lives].filter(([, l]) => l.saveTimer).map(([doc, l]) => keepNow(doc, l)))
}
onSaveAll(keepAll)
function keep(doc: string, l: Live): void {
  clearTimeout(l.saveTimer)
  l.saveTimer = setTimeout(() => keepNow(doc, l), SAVE_MS)
  // the files it names: expected at once (shown as on their way, never «not found» for a moment), asked a moment after
  mediaExpected(l.fmt.media(l.st.value), online.value)
  mediaSoon(doc, l)
}
/**
 * The pictures and recordings the file shows in step with the server, a moment after it settles (each sync — on
 * opening, on coming online — asks too: what came meanwhile is never missed). A file the server has not yet — its
 * coming is an event (`media.added`); one that failed (the network, the disk) — asked again later and later.
 */
function mediaSoon(doc: string, l: Live, wait = MEDIA_MS): void {
  clearTimeout(l.mediaTimer)
  l.mediaTimer = setTimeout(() => {
    const space = info(doc).space
    const rels = l.fmt.media(l.st.value)
    if (!space || !rels.length || !online.value) return
    mediaAsked(rels)
    window.qa
      .sharedMedia(space, rels)
      .catch((e: Error): MediaReport => ({ ...NO_MEDIA, failed: Object.fromEntries(rels.map((x) => [x, e.message])) }))
      .then((r) => {
        mediaReported(r, rels)
        if (!Object.keys(r.failed).length) return void (l.mediaFails = 0)
        if (lives.get(doc) === l) mediaSoon(doc, l, retryDelay((l.mediaFails = (l.mediaFails ?? 0) + 1)))
      })
  }, wait)
}

/** A document held: its updates kept, this person's sent, others' shown. */
function hold(doc: string, fmt: SharedFormat, st: SharedModel = fmt.model()): Live {
  let l = lives.get(doc)
  if (l) return l
  l = { fmt, st, ready: false, queue: [] }
  const live = l
  // this person's changes of a note marked with them and the server's time (every line knows who changed it last)
  if (st instanceof SharedText) st.stamp = () => ({ device: useTransport().value.deviceId, at: serverNow() })
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

/** Out of step (a sync or a send failed): said in the journal, tried again later and later — while online and held. */
function failed(doc: string, l: Live, e: Error): void {
  info(doc).live = false
  window.qa.sharedLog(`doc ${doc.slice(0, 8)}: ${e.message}`)
  clearTimeout(l.syncTimer)
  l.syncFails = (l.syncFails ?? 0) + 1
  const wait = retryDelay(l.syncFails)
  l.syncTimer = setTimeout(() => online.value && lives.get(doc) === l && void syncOrRetry(doc, l), wait)
}
/** In step with the server — or, failing, tried again later. */
async function syncOrRetry(doc: string, l: Live): Promise<void> {
  try {
    await sync(doc, l)
    l.syncFails = 0
  } catch (e) {
    failed(doc, l, e as Error)
  }
}
/** A document let go (deleted, its space left): nothing of it runs later. */
function release(doc: string): void {
  const l = lives.get(doc)
  if (l) for (const t of [l.sendTimer, l.saveTimer, l.mediaTimer, l.syncTimer]) clearTimeout(t)
  lives.delete(doc)
  sharedInfo.delete(doc)
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
      l.st.resume(kept, fileText)
      l.ready = true
    }
    if (online.value) await syncOrRetry(doc, l)
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
    // (one after another: dozens at once would be refused by the server as a flood)
    if (on) void (async () => {
      for (const [doc, l] of [...lives]) if (lives.get(doc) === l) await syncOrRetry(doc, l)
    })()
    else for (const doc of lives.keys()) info(doc).live = false
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
    release(doc)
  }
}
/** The files' changes not in the document yet (made a moment ago) go in first: someone else's change never drops them. */
function absorb(doc: string, l: Live): void {
  if (!l.ready) return
  for (const p of pathsOf(doc)) if (!readonlyPath(p)) l.st.setLocal(docs.get(p)!.text)
}
/** The shared documents' events of the server. */
const EVENTS: ServerEventHandlers = {
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
    if (!rels.length) return
    mediaAsked(rels)
    void window.qa
      .sharedMedia(p.space, rels)
      .then((r) => mediaReported(r, rels))
      .catch(() => undefined)
  },
}
onServerEvents(EVENTS)

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
  release(doc)
  void serverCall('doc.close', { doc }).catch(() => undefined)
}
/**
 * A shared note's text model (not a shared note here, or not in step yet — none). `fresh` — the editor's latest typing
 * put in first (a place is being made from the editor's positions); reading places never changes the document. The
 * places in its text (comments, cursors, components' origins): sharedPlaces.
 */
export function sharedTextOf(path: string, fresh = false): SharedText | undefined {
  const doc = sharedDocOfPath(path)
  const l = lives.get(doc)
  if (!l?.ready || !(l.st instanceof SharedText)) return undefined
  if (fresh) absorb(doc, l)
  return l.st
}
/** A document's text fetched from the server as a new file of this kind: its text, and its state kept here. */
export async function fetchText(doc: string, fmt: SharedFormat): Promise<string> {
  const st = fmt.model()
  const r = await serverCall('doc.open', { doc, sv: toB64(st.stateVector()) })
  st.apply(fromB64(r.update), 'remote')
  await window.qa.sharedSave(doc, { state: toB64(st.state()), text: st.value })
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
