import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { componentAt } from './componentOps'
import { componentRanges } from './componentField'

/**
 * Several of the note's blocks chosen at once (Ctrl + click on a handle — one more / one less, Shift + click — all
 * from the last one chosen): the handle menu then acts on all of them. Kept by the blocks' places in the text (they
 * move with it); a block gone — out of the choice. Esc or a click in the text — none chosen.
 */

/** The chosen blocks (their starts), the last chosen last. */
export const setBlockSel = StateEffect.define<number[]>()
export const blockSelField = StateField.define<number[]>({
  create: () => [],
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setBlockSel)) return e.value
    if (!tr.docChanged || !v.length) return v
    const starts = new Set(componentRanges(tr.state).map((r) => r.from))
    return v.map((p) => tr.changes.mapPos(p)).filter((p) => starts.has(p))
  },
})
export const blockSel = (view: EditorView): number[] => view.state.field(blockSelField, false) ?? []

/** How a click on a handle changes the choice. */
export type BlockSelectHow = 'toggle' | 'range' | 'clear'
const SELECT: Record<BlockSelectHow, (sel: number[], at: number, starts: number[]) => number[]> = {
  toggle: (sel, at) => (sel.includes(at) ? sel.filter((p) => p !== at) : [...sel, at]),
  range: (sel, at, starts) => {
    const anchor = sel.at(-1) ?? at
    const [a, b] = anchor < at ? [anchor, at] : [at, anchor]
    const between = starts.filter((p) => p >= a && p <= b)
    // the anchor stays the last one: a next Shift + click goes from it
    return [...new Set([...sel, ...between.filter((p) => p !== anchor), anchor])]
  },
  clear: () => [],
}
/** The choice changed by a click on this block's handle. */
export function selectBlock(view: EditorView, dom: HTMLElement, how: BlockSelectHow): void {
  const r = componentAt(view, dom)
  if (!r && how !== 'clear') return
  const sel = blockSel(view)
  const next = SELECT[how](sel, r?.from ?? 0, componentRanges(view.state).map((x) => x.from))
  if (next.length !== sel.length || next.some((p, i) => p !== sel[i])) view.dispatch({ effects: setBlockSel.of(next) })
}

/** The choice: kept in the state, dropped by Esc and by a click in the text (not on a handle). */
export const blockSelection: Extension = [
  blockSelField,
  keymap.of([
    {
      key: 'Escape',
      run: (view) => {
        if (!blockSel(view).length) return false
        view.dispatch({ effects: setBlockSel.of([]) })
        return true
      },
    },
  ]),
  EditorView.domEventHandlers({
    mousedown(e, view) {
      if (blockSel(view).length && !(e.target instanceof Element && e.target.closest('.nb-h'))) view.dispatch({ effects: setBlockSel.of([]) })
      return false
    },
  }),
]
