import { EditorSelection, type ChangeSpec, type EditorState, type TransactionSpec } from '@codemirror/state'

/**
 * The note's formatting as pure edits of the editor's state (the toolbar's and the keys'): a mark around the
 * selection put or taken away (bold, italic, strikethrough, inline code), the selected lines made a heading, a list,
 * a checklist, a quote — or back to plain text when they already are — and a link around the selection.
 */
export type FormatEdit = (s: EditorState) => TransactionSpec | undefined

/** The inline marks: the mark, and whether a run of its sign around the text means it is there. */
export const INLINE_MARKS = {
  bold: { mark: '**', has: (run: number) => run >= 2 },
  // (`*` inside `**` is bold's own: italic — an odd run, `*x*` or `***x***`)
  italic: { mark: '*', has: (run: number) => run % 2 === 1 },
  strike: { mark: '~~', has: (run: number) => run >= 2 },
  code: { mark: '`', has: (run: number) => run >= 1 },
} as const
export type InlineMark = keyof typeof INLINE_MARKS

/** How many of `ch` stand right before `pos` (dir -1) or from it on (dir 1). */
function runAt(s: EditorState, pos: number, ch: string, dir: 1 | -1): number {
  let n = 0
  while (true) {
    const at = dir < 0 ? pos - n - 1 : pos + n
    if (at < 0 || at >= s.doc.length || s.sliceDoc(at, at + 1) !== ch) return n
    n++
  }
}

/** A mark around each selection: put on; there already (around it, or the selection's own ends) — taken away. */
export function toggleMark(kind: InlineMark): FormatEdit {
  const { mark, has } = INLINE_MARKS[kind]
  const m = mark.length
  return (s) =>
    s.changeByRange((r) => {
      const text = s.sliceDoc(r.from, r.to)
      if (has(Math.min(runAt(s, r.from, mark[0], -1), runAt(s, r.to, mark[0], 1)))) {
        return { changes: [{ from: r.from - m, to: r.from }, { from: r.to, to: r.to + m }], range: EditorSelection.range(r.from - m, r.to - m) }
      }
      const inner = text.length >= 2 * m && text.startsWith(mark) && text.endsWith(mark)
      if (inner && has(Math.min(runOf(text, mark[0]), runOf([...text].reverse().join(''), mark[0])))) {
        return { changes: { from: r.from, to: r.to, insert: text.slice(m, -m) }, range: EditorSelection.range(r.from, r.to - 2 * m) }
      }
      return { changes: { from: r.from, to: r.to, insert: `${mark}${text}${mark}` }, range: EditorSelection.range(r.from + m, r.to + m) }
    })
}
const runOf = (t: string, ch: string) => t.length - t.replace(new RegExp(`^\\${ch}+`), '').length

/** The lines a selection takes (an empty line kept only when it is the only one — the cursor's). */
function selectedLines(s: EditorState): Array<{ from: number; text: string }> {
  const r = s.selection.main
  const a = s.doc.lineAt(r.from).number
  const b = s.doc.lineAt(r.to).number
  const all = Array.from({ length: b - a + 1 }, (_, i) => s.doc.line(a + i))
  const filled = all.filter((l) => l.text.trim())
  return (filled.length ? filled : all.slice(0, 1)).map((l) => ({ from: l.from, text: l.text }))
}
/** The changes made: a cursor put after what was inserted at it; a selection — over its lines whole (to press again). */
function linesEdit(s: EditorState, changes: ChangeSpec[]): TransactionSpec {
  const set = s.changes(changes)
  const r = s.selection.main
  const selection = r.empty ? EditorSelection.cursor(set.mapPos(r.head, 1)) : EditorSelection.range(set.mapPos(s.doc.lineAt(r.from).from, -1), set.mapPos(r.to, 1))
  return { changes: set, selection }
}

/** A list item's sign (with its checkbox), a quote's, a heading's — each with its indent. */
const LIST_SIGN = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/
const QUOTE_SIGN = /^(\s*)>\s?/
const HEADING_SIGN = /^(\s*)#{1,6}\s+/

/** The kinds of lines: how a line of the kind is known, and its sign (`n` — its number among the lines made). */
export const LINE_KINDS = {
  bullet: { is: /^\s*[-*+]\s+(?!\[[ xX]\])/, sign: () => '- ', strip: LIST_SIGN },
  ordered: { is: /^\s*\d+[.)]\s+/, sign: (n: number) => `${n}. `, strip: LIST_SIGN },
  task: { is: /^\s*[-*+]\s+\[[ xX]\]\s+/, sign: () => '- [ ] ', strip: LIST_SIGN },
  quote: { is: /^\s*>/, sign: () => '> ', strip: QUOTE_SIGN },
} as const
export type LineKind = keyof typeof LINE_KINDS

/** The selected lines made of a kind (another list's sign replaced); all of it already — its sign taken away. */
export function toggleLines(kind: LineKind): FormatEdit {
  const k = LINE_KINDS[kind]
  return (s) => {
    const lines = selectedLines(s)
    const all = lines.every((l) => k.is.test(l.text))
    const changes = lines.map((l, i): ChangeSpec => {
      const m = k.strip.exec(l.text)
      const indent = m?.[1] ?? /^\s*/.exec(l.text)![0]
      const cut = m ? m[0].length : indent.length
      return { from: l.from, to: l.from + cut, insert: all ? indent : `${indent}${k.sign(i + 1)}` }
    })
    return linesEdit(s, changes)
  }
}

/** The selected lines made a heading of a level (0 — plain text); all of them at that level already — plain text. */
export function setHeading(level: number): FormatEdit {
  return (s) => {
    const lines = selectedLines(s)
    const sign = '#'.repeat(level)
    const same = level > 0 && lines.every((l) => new RegExp(`^\\s*${sign}\\s`).test(l.text))
    const changes = lines.map((l): ChangeSpec => {
      const m = HEADING_SIGN.exec(l.text)
      return { from: l.from, to: l.from + (m ? m[0].length : 0), insert: same || !level ? (m?.[1] ?? '') : `${sign} ` }
    })
    return linesEdit(s, changes)
  }
}

/** A web link around the selection: a selected address — its text to write; other text — its address to write (selected). */
export const linkEdit: FormatEdit = (s) => {
  const r = s.selection.main
  const text = s.sliceDoc(r.from, r.to)
  if (/^https?:\/\/\S+$/.test(text.trim())) {
    const ins = `[](${text.trim()})`
    return { changes: { from: r.from, to: r.to, insert: ins }, selection: EditorSelection.cursor(r.from + 1) }
  }
  const url = 'https://'
  const ins = `[${text}](${url})`
  const at = r.from + text.length + 3
  return { changes: { from: r.from, to: r.to, insert: ins }, selection: EditorSelection.range(at, at + url.length) }
}
/** A link to another note around the selection (`[[…]]`; none selected — the cursor inside, the notes offered). */
export const wikiLinkEdit: FormatEdit = (s) => {
  const r = s.selection.main
  const text = s.sliceDoc(r.from, r.to)
  return { changes: { from: r.from, to: r.to, insert: `[[${text}]]` }, selection: EditorSelection.cursor(r.from + 2 + text.length) }
}
