import { reactive } from 'vue'

/**
 * «Метаданные» open — each note its own (a pane showing another note shows its own state; back to the note — as it was
 * left). Opened and closed by its button only.
 */
const open = reactive(new Set<string>())

export const isDocAiOpen = (path: string): boolean => open.has(path)
export function setDocAiOpen(path: string, on: boolean): void {
  if (on) open.add(path)
  else open.delete(path)
}
