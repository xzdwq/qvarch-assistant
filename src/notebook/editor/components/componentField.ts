import { EditorState, StateField } from '@codemirror/state'
import type { BlockKind } from '../../domain/blockSpec'
import { findBlocks } from '../../domain/findBlocks'
import { findLoops, loopAt, loopDepths } from '../../domain/loop'

/**
 * Where the note's components are (a table, a chart, a runnable block, a loop's start…): their ranges in the text,
 * found again whenever the text changes. Live preview, the guard, drag and drop and the widgets all go by them.
 * (No DOM here — CodeMirror's state only: tested in node.)
 */
export interface ComponentRange {
  kind: BlockKind
  from: number
  to: number
  src: string
  /** Its first line (an unnamed runnable block is known by it). */
  line: number
  /** The loop it is in (its key; '' — none) and how many loops it is in (their bands on the left). */
  loop: string
  band: number
  /** The note's headings as JSON (the table of contents only; '' for the others). */
  headings: string
}
export type Heading = { level: number; text: string; pos: number }

/** The headings of a note (for its contents): outside code fences. */
function headingsOf(state: EditorState): Heading[] {
  const out: Heading[] = []
  let fence = ''
  for (let no = 1; no <= state.doc.lines; no++) {
    const l = state.doc.line(no)
    const f = /^\s*(`{3,}|~{3,})/.exec(l.text)
    if (f) {
      if (!fence) fence = f[1]
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = ''
      continue
    }
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l.text)
    if (m) out.push({ level: m[1].length, text: m[2], pos: l.from })
  }
  return out
}
function findComponentRanges(state: EditorState): ComponentRange[] {
  const lines = state.doc.toString().split('\n')
  const found = findBlocks(lines)
  const loops = findLoops(lines)
  const depth = loopDepths(loops, lines.length)
  const heads = found.some((b) => b.kind === 'toc') ? JSON.stringify(headingsOf(state)) : ''
  return found.map((b) => ({
    kind: b.kind,
    from: state.doc.line(b.line0).from,
    to: state.doc.line(b.line1).to,
    src: b.src,
    line: b.line0,
    loop: loopAt(loops, b.line0)?.key ?? '',
    band: depth[b.line0],
    headings: b.kind === 'toc' ? heads : '',
  }))
}
export const componentRangesField = StateField.define<ComponentRange[]>({
  create: findComponentRanges,
  update: (v, tr) => (tr.docChanged ? findComponentRanges(tr.state) : v),
})
/** The components' ranges of a state (none — the field is not there). */
export const componentRanges = (state: EditorState): ComponentRange[] => state.field(componentRangesField, false) ?? []
