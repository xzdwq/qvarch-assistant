import { onBeforeUnmount, onMounted, ref } from 'vue'
import { curPane, type Pane } from '@nb/workspace/paneLayout'
import { NoteEditors } from './noteEditors'

/**
 * Calendar events and the notes: «В событие» from the editor's menu (the selected text becomes a new event and,
 * in its place, the event's chip), and the card of an event chip clicked in a note.
 */
export function useNoteEvents(editors: NoteEditors) {
  /** The selected text for a new event. */
  const eventText = ref<string>()
  /** Where the text made into an event is (its editor and place) — it becomes the event's chip. */
  let eventAt: { key: string; from: number; to: number } | undefined
  function toEvent(p: Pane, text: string, at: { from: number; to: number }): void {
    eventAt = { key: NoteEditors.key(p), ...at }
    eventText.value = text
  }
  function onEventMade(day: string, e: { id: string; label: string }): void {
    const at = eventAt
    const text = eventText.value
    eventAt = undefined
    if (!at || !text) return
    editors.get(at.key)?.linkEvent(at, text, { day, id: e.id, label: e.label || text })
  }

  /** An event chip clicked in a note: its card. */
  const evCard = ref<{ day: string; id: string; x: number; y: number; path?: string }>()
  const onEvCard = (e: Event) => {
    const d = (e as CustomEvent<{ day: string; id: string; x: number; y: number }>).detail
    evCard.value = { ...d, path: curPane()?.active }
  }
  onMounted(() => window.addEventListener('qa:event-card', onEvCard))
  onBeforeUnmount(() => window.removeEventListener('qa:event-card', onEvCard))
  return { eventText, toEvent, onEventMade, evCard }
}
