import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** Formatting the selection: wrapped in marks (bold, italic, inline code), a code block, headings, list items. */

/** The selection wrapped in a mark (Ctrl+B — **, Ctrl+I — *); a command for a keymap. */
export function wrapSelection(mark: string) {
  return (v: EditorView) => {
    v.dispatch(
      v.state.changeByRange((r) => {
        const text = v.state.sliceDoc(r.from, r.to)
        return { changes: { from: r.from, to: r.to, insert: `${mark}${text}${mark}` }, range: EditorSelection.range(r.from + mark.length, r.from + mark.length + text.length) }
      }),
    )
    return true
  }
}
/** The selection as code: several lines — a code block on lines of its own, one line — inline code. */
export function selectionToCode(v: EditorView): void {
  const r = v.state.selection.main
  const text = v.state.sliceDoc(r.from, r.to)
  if (!text.includes('\n')) return void wrapSelection('`')(v)
  const a = v.state.doc.lineAt(r.from)
  const b = v.state.doc.lineAt(r.to)
  const body = v.state.sliceDoc(a.from, b.to)
  const ins = `\`\`\`\n${body}\n\`\`\``
  v.dispatch({ changes: { from: a.from, to: b.to, insert: ins }, selection: { anchor: a.from + 4, head: a.from + 4 + body.length } })
}
/** The selected lines made headings (## ) or list items (- ) — the old marker replaced, empty lines skipped. */
export function selectionLinesAs(v: EditorView, what: 'heading' | 'list'): void {
  const r = v.state.selection.main
  const a = v.state.doc.lineAt(r.from)
  const b = v.state.doc.lineAt(r.to)
  const changes: Array<{ from: number; to: number; insert: string }> = []
  for (let n = a.number; n <= b.number; n++) {
    const line = v.state.doc.line(n)
    if (!line.text.trim()) continue
    const m = what === 'heading' ? /^\s*#{1,6}\s+/.exec(line.text) : /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line.text)
    const indent = what === 'list' ? (/^\s*/.exec(line.text)?.[0] ?? '') : ''
    const cut = m ? m[0].length : what === 'list' ? indent.length : 0
    changes.push({ from: line.from, to: line.from + cut, insert: what === 'heading' ? '## ' : `${indent}- ` })
  }
  v.dispatch({ changes })
}
