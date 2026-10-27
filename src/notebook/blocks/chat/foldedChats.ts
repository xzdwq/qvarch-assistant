import { ref } from 'vue'

/**
 * The chats folded in the notes (only their head shown): this person's own view, kept on this computer by the room —
 * a shared note's chat folds for oneself, not for everyone.
 */
const KEY = 'qa.chat.folded'

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
const folded = ref(load())

export const isFolded = (room: string): boolean => folded.value.has(room)

/** A room's chat folded / unfolded. */
export function setFolded(room: string, on: boolean): void {
  const s = new Set(folded.value)
  if (on) s.add(room)
  else s.delete(room)
  folded.value = s
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]))
  } catch {
    // kept for this run only
  }
}
