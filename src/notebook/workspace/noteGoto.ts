import { openNote } from '@renderer/lib/mentions'

/**
 * A note opened at a place (a link's `#место`: a heading or a line's start — links.ts placeLine): the place waits
 * for the note's editor — open already, or one that opens it now — which shows the line and takes the place.
 */
/** A place in a note: a link's `#место` (a heading, a line's start), or a spot found by the search (its line from 0). */
export type NotePlace = string | { line: number; col: number; len: number }
const wanted = new Map<string, NotePlace>()
/** A note's editor is to show the place asked for (detail: the note's path). */
export const NOTE_PLACE_EVENT = 'qa:note-place'
/** A note's editor is to select a range of its text (detail: NoteRange). */
export const NOTE_GOTO_EVENT = 'qa:note-goto'
/** A range of a note's text (offsets) to select and scroll to. */
export interface NoteRange {
  path: string
  from: number
  to: number
}

/** The note's editor, if open, selects the range and scrolls to it (a comment's «к тексту»). */
export function gotoRange(range: NoteRange): void {
  window.dispatchEvent(new CustomEvent<NoteRange>(NOTE_GOTO_EVENT, { detail: range }))
}

/** A place of a note to show as the note opens (none — the note as it opens). */
export function askPlace(path: string, place?: NotePlace): void {
  if (place === undefined || (typeof place === 'string' && !place.trim())) return void wanted.delete(path)
  wanted.set(path, place)
  setTimeout(() => window.dispatchEvent(new CustomEvent(NOTE_PLACE_EVENT, { detail: path })))
}
/** A note opened (in the notebook view) at a place. */
export async function openNoteAt(path: string, place?: NotePlace): Promise<void> {
  askPlace(path, place)
  await openNote(path)
}
/** The place a note's editor is to show (none — nothing asked). */
export const placeWanted = (path: string): NotePlace | undefined => wanted.get(path)
/** The place shown (or not found in the note's text): asked no more. */
export const placeShown = (path: string): void => void wanted.delete(path)
