import { shallowRef } from 'vue'
import { openPlace } from './views'

/**
 * Events ↔ notes: which notes mention an event (by its id) — loaded when asked, again after a note with an event
 * link is saved; and the ways across: a note opened from an event, an event opened in Моя работа from a note.
 */
const mentions = shallowRef<Record<string, string[]>>({})
let timer: ReturnType<typeof setTimeout> | undefined
export function refreshMentions(soon = false): void {
  clearTimeout(timer)
  timer = setTimeout(
    () =>
      void window.qa
        .eventMentions()
        .then((m) => (mentions.value = m))
        .catch(() => undefined),
    soon ? 600 : 0,
  )
}
let loadedAt = 0
/** The index wanted (a view showing events): loaded unless it was just now. */
export function ensureMentions(): void {
  if (Date.now() - loadedAt < 5000) return
  loadedAt = Date.now()
  refreshMentions()
}
export const notesOf = (eventId: string) => mentions.value[eventId] ?? []
export const noteTitle = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '')
/** A note shown (the notebook opened on it). */
export async function openNote(path: string): Promise<void> {
  const { openFile } = await import('./notebook')
  openFile(path)
  openPlace('notebook')
}
