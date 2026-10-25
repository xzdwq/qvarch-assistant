import { QUOTE_MAX, type CommentAnchor } from '@shared/transport/chat'
import type { BlockOrigin, PeerSel } from '@shared/transport/sharedText'
import { sharedTextOf } from './sharedDocs'

/**
 * The places of a shared note's text that follow everyone's edits (Yjs relative positions): a comment's, a
 * participant's cursor, a component's origin (who put it in, when). Positions are the editor's. A place is made
 * from the text with the editor's latest typing in; reading places never changes the document.
 */

/** A place of a shared note as a comment's anchor; not a shared note's — none. */
export function anchorFor(path: string, from: number, to: number): CommentAnchor | undefined {
  const st = sharedTextOf(path, true)
  return st && { ...st.anchor(from, to), quote: st.value.slice(from, to).slice(0, QUOTE_MAX) }
}
/** Where a comment's place (a cursor's) is in a shared note now (its text gone — `gone`); not known here — none. */
export function rangeFor(path: string, a: { start: string; end: string }): { from: number; to: number; gone: boolean } | undefined {
  return sharedTextOf(path)?.resolve(a) ?? undefined
}
/** This person's selection in a shared note as the others get it (a caret — one place); not a shared note — none. */
export function selFor(path: string, anchor: number, head: number): PeerSel | undefined {
  const st = sharedTextOf(path, true)
  if (!st) return undefined
  if (anchor === head) return { ...st.caret(head), caretAtStart: false }
  return { ...st.anchor(Math.min(anchor, head), Math.max(anchor, head)), caretAtStart: head < anchor }
}
/** A component just put in (its first sign at `at`) marked as someone's, now (a shared note only). */
export function markOrigin(path: string, at: number, o: BlockOrigin): void {
  sharedTextOf(path, true)?.markOrigin(at, o)
}
/** The components' origins of a shared note by the line each starts on now (counted from 1, as the blocks' lines; not a shared note — none). */
export function originsIn(path: string): Map<number, BlockOrigin> {
  const st = sharedTextOf(path)
  const out = new Map<number, BlockOrigin>()
  if (!st) return out
  const text = st.value
  for (const [at, o] of st.originsNow()) out.set(lineOfIndex(text, at) + 1, o)
  return out
}
/** Who changed each line of a shared note last (0-based line → device; not a shared note — none). */
export const lineAuthorsIn = (path: string): Map<number, string> => sharedTextOf(path)?.lineAuthors() ?? new Map()
/** The 0-based line an index of a text is on. */
const lineOfIndex = (text: string, at: number): number => {
  let n = 0
  for (let i = text.indexOf('\n'); i !== -1 && i < at; i = text.indexOf('\n', i + 1)) n++
  return n
}
