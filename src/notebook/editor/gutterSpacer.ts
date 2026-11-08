import { GutterMarker } from '@codemirror/view'

/**
 * A margin column of the note's own (who wrote a line, a comment's sign) keeps its width however the note is
 * scrolled: its spacer is as wide as its widest sign — a part with no sign on screen (a long component, its lines
 * not drawn) does not make it collapse and the text jump aside. A note with no signs at all — no width.
 */
class NoSpace extends GutterMarker {}
export const NO_GUTTER_SPACE: GutterMarker = new NoSpace()
