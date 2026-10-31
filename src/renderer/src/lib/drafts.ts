import { computed, reactive, toValue, type MaybeRefOrGetter, type WritableComputedRef } from 'vue'
import { draftsFromDisk, draftsToKeep, type Draft } from '@shared/drafts'

/**
 * What is typed into a field and not used yet, by the field's place (shared/drafts.ts): a component made again (a
 * section left and come back to, another note and back) gets it as it was. One store for the window — the same
 * place shown twice (a chat in two notes) shows the same text; the kept ones go to localStorage (the island's
 * window and this one see each other's).
 */
const KEY = 'qa:drafts'
function readDisk(): Record<string, Draft> {
  try {
    return draftsFromDisk(JSON.parse(localStorage.getItem(KEY) ?? '{}'), Date.now())
  } catch {
    return {}
  }
}
const store = reactive<Record<string, Draft>>(readDisk())
let timer: ReturnType<typeof setTimeout> | undefined
function writeDisk(): void {
  clearTimeout(timer)
  timer = undefined
  try {
    const kept = draftsToKeep(store, Date.now())
    if (Object.keys(kept).length) localStorage.setItem(KEY, JSON.stringify(kept))
    else localStorage.removeItem(KEY)
  } catch {
    // (the disk refused: they live while the app does)
  }
}
window.addEventListener('beforeunload', () => timer && writeDisk())
// another window typed into a kept draft (or sent it)
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return
  const disk = readDisk()
  for (const [k, d] of Object.entries(store)) if (d.keep && !disk[k]) delete store[k]
  Object.assign(store, disk)
})

/**
 * A field's text kept by its place (`key` — what the field is for and where: `chat:<room>`, `tasks:search`); `keep`
 * — it outlives the app's closing too (a message being written; never a secret). Emptied — forgotten.
 */
export function useDraft(key: MaybeRefOrGetter<string>, o: { keep?: boolean } = {}): WritableComputedRef<string> {
  return computed({
    get: () => store[toValue(key)]?.v ?? '',
    set: (v: string) => {
      const k = toValue(key)
      if (v) store[k] = { v, at: Date.now(), keep: !!o.keep }
      else delete store[k]
      if (o.keep) timer ??= setTimeout(writeDisk, 400)
    },
  })
}
