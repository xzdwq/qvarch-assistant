import { StateEffect, StateField } from '@codemirror/state'
import { gutter, GutterMarker } from '@codemirror/view'
import { peerSlot } from './peerCursors'

/**
 * Who changed each line of a shared note last: a thin bar of their colour on the left of the line numbers (the
 * same colour as their cursor and their name in «Совместная работа»). A cursor alone changes nothing.
 */
export const setLineAuthors = StateEffect.define<Map<number, string>>()
const authorsField = StateField.define<Map<number, string>>({
  create: () => new Map(),
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setLineAuthors) ? e.value : acc), v),
})

class AuthorMark extends GutterMarker {
  constructor(readonly slot: number) {
    super()
  }
  eq(o: GutterMarker): boolean {
    return o instanceof AuthorMark && o.slot === this.slot
  }
  toDOM(): Node {
    const d = document.createElement('div')
    d.className = 'cm-author-bar'
    d.style.setProperty('--peer', `var(--peer-${this.slot + 1})`)
    return d
  }
}
const marks = new Map<number, AuthorMark>()
const markOf = (slot: number) => marks.get(slot) ?? marks.set(slot, new AuthorMark(slot)).get(slot)!

export const lineAuthors = [
  authorsField,
  gutter({
    class: 'cm-authors',
    lineMarker: (view, line) => {
      const device = view.state.field(authorsField).get(view.state.doc.lineAt(line.from).number - 1)
      return device ? markOf(peerSlot(device)) : null
    },
    lineMarkerChange: (u) => u.startState.field(authorsField) !== u.state.field(authorsField),
  }),
]
