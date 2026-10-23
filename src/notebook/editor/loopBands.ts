import { EditorState, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { findLoops, loopDepths } from '@nb/domain/loop'

/**
 * A loop's band: on the left of all it holds (its start, its blocks, its text, its end) — a loop in a loop, one
 * more band. Text lines get it as a line decoration; components set it on their own box (setLoopBand).
 */

/** The band on a component's box (0 — in no loop). */
export function setLoopBand(dom: HTMLElement, band: number): void {
  dom.classList.toggle('cm-loopband', band > 0)
  if (band > 0) dom.style.setProperty('--ld', String(band))
  else dom.style.removeProperty('--ld')
}
/** The lines of text in loops: their bands. */
function buildBands(state: EditorState): DecorationSet {
  const lines = state.doc.toString().split('\n')
  const loops = findLoops(lines)
  if (!loops.some((l) => l.end !== undefined)) return Decoration.none
  const depth = loopDepths(loops, lines.length)
  const out: Range<Decoration>[] = []
  for (let i = 1; i <= lines.length; i++) if (depth[i]) out.push(Decoration.line({ class: 'cm-loopband', attributes: { style: `--ld: ${depth[i]}` } }).range(state.doc.line(i).from))
  return Decoration.set(out)
}
export const loopBands = StateField.define<DecorationSet>({
  create: buildBands,
  update: (v, tr) => (tr.docChanged ? buildBands(tr.state) : v),
  provide: (f) => EditorView.decorations.from(f),
})
