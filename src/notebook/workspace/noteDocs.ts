import { reactive } from 'vue'
import { syncMediaFiles } from './noteMedia'

/**
 * The open documents: one per path, whatever number of panes show it; typed text kept in memory at once and
 * written to disk shortly after the last key (autosave).
 */
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

/** Each document's first read from disk (resolved when it is in, or failed). */
const reads = new Map<string, Promise<void>>()
/** The document of a path (read from disk the first time it is asked for). */
export function doc(path: string): Doc {
  let d = docs.get(path)
  if (!d) {
    docs.set(path, { text: '', saved: '', loaded: false })
    d = docs.get(path)!
    const read = window.qa
      .vaultRead(path)
      .then((t) => {
        // typed into it before it loaded (a brand new note) — keep that
        if (!d!.loaded && d!.text === '') d!.text = t
        d!.saved = t
        d!.loaded = true
        if (d!.text !== t) void save(path)
      })
      .catch((e: Error) => {
        // never shown as an empty note: typing into it would be saved over the real file
        d!.error = e.message
      })
    reads.set(path, read)
  }
  return d
}
/** The document once it is read (for those that work in a note not open: the AI, a recording); unreadable — an error. */
export async function loadedDoc(path: string): Promise<Doc> {
  const d = doc(path)
  await reads.get(path)
  if (!d.loaded) throw new Error(`Заметка «${path}»: ${d.error ?? 'не прочитана'}`)
  return d
}
/** A note that could not be read — asked for again (what was typed meanwhile is kept, as for a new note). */
export function reloadDoc(path: string): void {
  const d = docs.get(path)
  if (!d || d.loaded) return
  docs.delete(path)
  reads.delete(path)
  doc(path).text = d.text
}

/** Typed: kept in memory at once, written to disk shortly after the last key. */
export function setText(path: string, text: string): void {
  const d = doc(path)
  if (d.text === text) return
  d.text = text
  clearTimeout(timers.get(path))
  timers.set(path, setTimeout(() => void save(path), SAVE_MS))
}
/** The saves of a path in flight, one after another (two overlapping ones would compare media against a stale text). */
const saving = new Map<string, Promise<void>>()
/** Written now (if anything is pending); the media it lost or got back follow. */
export function save(path: string): Promise<void> {
  clearTimeout(timers.get(path))
  timers.delete(path)
  const next = (saving.get(path) ?? Promise.resolve()).then(() => writeDoc(path))
  saving.set(path, next)
  void next.finally(() => saving.get(path) === next && saving.delete(path))
  return next
}
async function writeDoc(path: string): Promise<void> {
  const d = docs.get(path)
  if (!d || !d.loaded || d.text === d.saved) return
  const text = d.text
  const before = d.saved
  try {
    await window.qa.vaultWrite(path, text)
    // an event mentioned (or no more): its link to this note follows
    if (text.includes('qvarch://event/') || before.includes('qvarch://event/')) void import('@renderer/lib/mentions').then((m) => m.refreshMentions(true))
    d.saved = text
    d.error = undefined
    syncMediaFiles(before, text)
  } catch (e) {
    d.error = e instanceof Error ? e.message : String(e)
  }
}
/** A path is the note itself or a note inside the folder. */
const isUnder = (path: string, dir: string) => path === dir || path.startsWith(`${dir}/`)
/** Pending typing of a note / a folder's notes written now (before the files move or go). */
export const saveUnder = (dir: string) => Promise.all([...docs.keys()].filter((k) => isUnder(k, dir)).map(save)).then(() => undefined)
/** A note / a folder's notes gone: their documents forgotten, nothing pending written back. */
export function forgetUnder(dir: string): void {
  for (const k of [...docs.keys()].filter((k) => isUnder(k, dir))) {
    clearTimeout(timers.get(k))
    timers.delete(k)
    docs.delete(k)
    reads.delete(k)
  }
}
/** A document follows its note's new path (a pending save too — it writes the new file). */
export function moveDoc(from: string, to: string): void {
  const d = docs.get(from)
  if (!d) return
  docs.delete(from)
  docs.set(to, d)
  const read = reads.get(from)
  reads.delete(from)
  if (read) reads.set(to, read)
  if (!timers.has(from)) return
  clearTimeout(timers.get(from))
  timers.delete(from)
  timers.set(to, setTimeout(() => void save(to), SAVE_MS))
}
/** What else is written with the notes (the shared documents' kept states — never older than their files). */
const withSaveAll: Array<() => Promise<void>> = []
export const onSaveAll = (fn: () => Promise<void>) => void withSaveAll.push(fn)
export async function saveAll(): Promise<void> {
  await Promise.all([...[...docs.keys()].map(save), ...withSaveAll.map((fn) => fn())])
}
window.addEventListener('beforeunload', () => void saveAll())
/** Has typing not yet on disk. */
export const isDirty = (path: string) => {
  const d = docs.get(path)
  return !!d && d.loaded && d.text !== d.saved
}
