import type { Entry, Note } from './types'

/**
 * The block a note belongs to: the most specific one running at the note's moment (the shortest
 * containing it — a call inside a task wins). Resolved on display, not stored: a call block is
 * created only after the call ends, so a note typed during the call still lands on it.
 */
export function noteEntry(note: Pick<Note, 'at'>, entries: Entry[]): Entry | undefined {
  let best: Entry | undefined
  for (const e of entries)
    if (e.start <= note.at && note.at < e.end && (!best || e.end - e.start < best.end - best.start)) best = e
  return best
}

/** Notes with text, oldest first. */
export function visibleNotes(notes: Note[] | undefined): Note[] {
  return (notes ?? []).filter((n) => n.text.trim() || n.audio || n.transcript).sort((a, b) => a.at - b.at)
}
