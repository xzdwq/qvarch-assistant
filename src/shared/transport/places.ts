/**
 * Places of a shared note's text as the app and the server pass them — Yjs relative positions (base64) that follow
 * everyone's edits. Plain data only (the text's model is the app's: sharedText.ts).
 */

/** A place of the text: its start and end. */
export interface TextAnchor {
  start: string
  end: string
}
/** A participant's cursor: its selection, the caret at its start or end. */
export interface PeerSel extends TextAnchor {
  caretAtStart: boolean
}
const REL_POS = /^[A-Za-z0-9+/=]{1,200}$/
export const isPeerSel = (x: unknown): x is PeerSel => {
  const s = x as PeerSel
  return !!s && typeof s === 'object' && typeof s.start === 'string' && REL_POS.test(s.start) && typeof s.end === 'string' && REL_POS.test(s.end) && typeof s.caretAtStart === 'boolean'
}

/** Who put a component into a shared note and when (the server's clock, epoch ms) — kept in the document itself. */
export interface BlockOrigin {
  by: string
  device: string
  at: number
}
