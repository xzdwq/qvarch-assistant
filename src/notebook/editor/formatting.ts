import { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { toggleMark, type FormatEdit, type InlineMark } from './toolbar/formatEdits'

/** Formatting carried out in the editor: a pure edit (toolbar/formatEdits) dispatched; the selection made code. */

/** A formatting edit carried out (an undo step of its own, scrolled to). */
export function runEdit(v: EditorView, edit: FormatEdit): void {
  const spec = edit(v.state)
  if (spec) v.dispatch({ ...spec, scrollIntoView: true, annotations: Transaction.userEvent.of('input.format') })
}
/** A mark toggled — a command for a keymap (Ctrl+B — bold, Ctrl+I — italic). */
export const markKey = (kind: InlineMark) => (v: EditorView) => (runEdit(v, toggleMark(kind)), true)

/** The selection as code: several lines — a code block on lines of its own, one line — inline code. */
export function selectionToCode(v: EditorView): void {
  const r = v.state.selection.main
  const text = v.state.sliceDoc(r.from, r.to)
  if (!text.includes('\n')) return runEdit(v, toggleMark('code'))
  const a = v.state.doc.lineAt(r.from)
  const b = v.state.doc.lineAt(r.to)
  const body = v.state.sliceDoc(a.from, b.to)
  const ins = `\`\`\`\n${body}\n\`\`\``
  v.dispatch({ changes: { from: a.from, to: b.to, insert: ins }, selection: { anchor: a.from + 4, head: a.from + 4 + body.length } })
}
