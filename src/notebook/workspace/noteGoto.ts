import { openNote } from '@renderer/lib/mentions'

/**
 * A note opened at a place (a link's `#место`: a heading or a line's start — links.ts placeLine): the place waits
 * for the note's editor — open already, or one that opens it now — which shows the line and takes the place.
 */
const wanted = new Map<string, string>()
export const NOTE_PLACE_EVENT = 'qa:note-place'

/** A place of a note to show as the note opens (none — the note as it opens). */
export function askPlace(path: string, place?: string): void {
  if (!place?.trim()) return void wanted.delete(path)
  wanted.set(path, place)
  setTimeout(() => window.dispatchEvent(new CustomEvent(NOTE_PLACE_EVENT, { detail: path })))
}
/** A note opened (in the notebook view) at a place. */
export async function openNoteAt(path: string, place?: string): Promise<void> {
  askPlace(path, place)
  await openNote(path)
}
/** The place a note's editor is to show (none — nothing asked). */
export const placeWanted = (path: string): string | undefined => wanted.get(path)
/** The place shown (or not found in the note's text): asked no more. */
export const placeShown = (path: string): void => void wanted.delete(path)
