import { StateEffect, StateField } from '@codemirror/state'
import { gutter, GutterMarker } from '@codemirror/view'
import type { LineAuthor } from '@shared/transport/sharedText'
import { peerSlot } from './peerCursors'

/**
 * Who changed each line last: a thin bar on the left of the line numbers — a person's in their colour (the same as
 * their cursor and their name in «Совместная работа»), an AI agent's striped in the AI's colour, its first line of a
 * run with ✦ in its owner's colour; the agent's name on hover. A cursor alone changes nothing.
 */
export const setLineAuthors = StateEffect.define<Map<number, LineAuthor>>()
const authorsField = StateField.define<Map<number, LineAuthor>>({
  create: () => new Map(),
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setLineAuthors) ? e.value : acc), v),
})

class AuthorMark extends GutterMarker {
  constructor(
    readonly slot: number,
    readonly agent = '',
    readonly first = false,
  ) {
    super()
  }
  eq(o: GutterMarker): boolean {
    return o instanceof AuthorMark && o.slot === this.slot && o.agent === this.agent && o.first === this.first
  }
  toDOM(): Node {
    const d = document.createElement('div')
    d.className = `cm-author-bar${this.agent ? ' ai' : ''}${this.first ? ' first' : ''}`
    if (this.slot >= 0) d.style.setProperty('--peer', `var(--peer-${this.slot + 1})`)
    if (this.agent) d.title = `Написал ${this.agent}`
    return d
  }
}
const marks = new Map<string, AuthorMark>()
const markOf = (slot: number, agent = '', first = false) => {
  const key = `${slot}|${agent}|${first}`
  return marks.get(key) ?? marks.set(key, new AuthorMark(slot, agent, first)).get(key)!
}

export const lineAuthors = [
  authorsField,
  gutter({
    class: 'cm-authors',
    lineMarker: (view, line) => {
      const all = view.state.field(authorsField)
      const n = view.state.doc.lineAt(line.from).number - 1
      const who = all.get(n)
      if (!who) return null
      const slot = who.device ? peerSlot(who.device) : -1
      if (!who.agent) return slot >= 0 ? markOf(slot) : null
      const prev = all.get(n - 1)
      return markOf(slot, who.agent, prev?.agent !== who.agent || prev?.device !== who.device)
    },
    lineMarkerChange: (u) => u.startState.field(authorsField) !== u.state.field(authorsField),
  }),
]
