import { RangeSet, StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, gutter, GutterMarker, type DecorationSet } from '@codemirror/view'
import { openComment } from '@nb/workspace/noteComments'
import { editorHost } from './editorHost'
import { ICON_COMMENT } from './icons'

/**
 * The comments of a shared note in its text: each open one's place underlined, a sign on its first line's margin; a
 * click on either opens its discussion. The places come from the comments (setCommentMarks), the text's own edits
 * move them until the next ones come.
 */
export interface CommentMark {
  room: string
  from: number
  to: number
}
export const setCommentMarks = StateEffect.define<CommentMark[]>()

class CommentSign extends GutterMarker {
  constructor(readonly rooms: string[]) {
    super()
  }
  eq(o: CommentSign): boolean {
    return o.rooms.join() === this.rooms.join()
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-comment-sign'
    s.dataset.room = this.rooms[0]
    s.innerHTML = this.rooms.length > 1 ? `${ICON_COMMENT}${this.rooms.length}` : ICON_COMMENT
    s.title = this.rooms.length > 1 ? `Комментариев: ${this.rooms.length}` : 'Комментарий'
    return s
  }
}

interface Marks {
  deco: DecorationSet
  signs: RangeSet<GutterMarker>
}
function build(view: { doc: { length: number; lineAt(p: number): { from: number } } }, marks: CommentMark[]): Marks {
  const len = view.doc.length
  const deco: Array<Range<Decoration>> = []
  const byLine = new Map<number, string[]>()
  for (const m of marks) {
    const from = Math.min(m.from, len)
    const to = Math.min(m.to, len)
    if (to > from) deco.push(Decoration.mark({ class: 'cm-comment', attributes: { 'data-room': m.room } }).range(from, to))
    const line = view.doc.lineAt(from).from
    byLine.set(line, [...(byLine.get(line) ?? []), m.room])
  }
  return {
    deco: Decoration.set(deco, true),
    signs: RangeSet.of([...byLine].map(([at, rooms]) => new CommentSign(rooms).range(at)), true),
  }
}

const marksField = StateField.define<Marks>({
  create: () => ({ deco: Decoration.none, signs: RangeSet.empty }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setCommentMarks)) return build(tr.state, e.value)
    return tr.docChanged ? { deco: v.deco.map(tr.changes), signs: v.signs.map(tr.changes) } : v
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

/** A click on a comment's underlined place: its discussion opened (the cursor is placed there too). */
const opening = EditorView.domEventHandlers({
  mousedown(e, v) {
    const room = (e.target as HTMLElement | null)?.closest<HTMLElement>('.cm-comment')?.dataset.room
    if (room) openComment(v.state.facet(editorHost).notePath(), room)
    return false
  },
})

export const commentMarks = [
  marksField,
  gutter({
    class: 'cm-comment-gutter',
    markers: (v) => v.state.field(marksField).signs,
    domEventHandlers: {
      // a click on a sign: the first comment of its line opened
      mousedown(v, _line, e) {
        const room = (e.target as HTMLElement | null)?.closest<HTMLElement>('.cm-comment-sign')?.dataset.room
        if (!room) return false
        openComment(v.state.facet(editorHost).notePath(), room)
        return true
      },
    },
  }),
  opening,
]
