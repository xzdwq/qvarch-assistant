import { ref } from 'vue'

/** How long "copied" stays in the tab bar (ms). */
const NOTE_MS = 1400

/** Copying to the clipboard with a short note of what was copied (shown in the tab bar). */
export function useCopyNote() {
  const note = ref('')
  /** The note shown for a moment. */
  function show(what: string): void {
    note.value = what
    setTimeout(() => note.value === what && (note.value = ''), NOTE_MS)
  }
  /** A text onto the clipboard, the note shown. */
  async function copy(text: string, what = 'Скопировано'): Promise<void> {
    await navigator.clipboard.writeText(text)
    show(what)
  }
  return { note, show, copy }
}
export type CopyNote = ReturnType<typeof useCopyNote>
