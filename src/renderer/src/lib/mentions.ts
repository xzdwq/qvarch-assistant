import { shallowRef } from 'vue'

/**
 * Events ↔ notes: which notes mention an event (by its id) — loaded when asked, again after a note with an event
 * link is saved; and the ways across: a note opened from an event, an event opened in Моя работа from a note.
 */
export const mentions = shallowRef<Record<string, string[]>>({})
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
  window.dispatchEvent(new CustomEvent('qa:view', { detail: 'notebook' }))
}
/** An event shown in Моя работа (its day, the event picked). */
export const openEventInWork = (day: string, id: string) => window.dispatchEvent(new CustomEvent('qa:open-day', { detail: { day, id } }))
