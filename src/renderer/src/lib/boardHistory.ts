import { remapPath } from '@shared/vault'
import type { Board } from '@shared/whiteboard'

/**
 * Undo / redo of each board, by its path — kept while the app runs, so leaving the board (another section,
 * another tab) and coming back keeps the history. A change made outside clears it (the board calls `clear`).
 */
export interface BoardHistory {
  undo: Board[]
  redo: Board[]
}
const all = new Map<string, BoardHistory>()

export function historyOf(path: string): BoardHistory {
  let h = all.get(path)
  if (!h) all.set(path, (h = { undo: [], redo: [] }))
  return h
}

/** A file renamed / moved (or a folder with it): its history follows. */
export function remapHistory(from: string, to: string): void {
  for (const [k, h] of [...all]) {
    const n = remapPath(k, from, to)
    if (n === k) continue
    all.delete(k)
    all.set(n, h)
  }
}
