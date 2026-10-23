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

/** The document of a path (read from disk the first time it is asked for). */
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
/** Written now (if anything is pending); the media it lost or got back follow. */
export async function save(path: string): Promise<void> {
  clearTimeout(timers.get(path))
  timers.delete(path)
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
export async function saveAll(): Promise<void> {
  await Promise.all([...docs.keys()].map(save))
}
window.addEventListener('beforeunload', () => void saveAll())
/** Has typing not yet on disk. */
export const isDirty = (path: string) => {
  const d = docs.get(path)
  return !!d && d.loaded && d.text !== d.saved
}
