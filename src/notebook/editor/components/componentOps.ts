import { EditorState, Transaction } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { findLoops, type LoopRange } from '@nb/domain/loop'
import { COMPONENT_DELETE, COMPONENT_INPUT, COMPONENT_MOVE } from '../editorHost'
import { componentRanges, type ComponentRange } from './componentField'

/** What can be done to a component in the text: find it by its DOM, replace, remove, duplicate, leave it with the keys. */

/** The component a widget's DOM stands for (its range now). */
export function componentAt(view: EditorView, dom: HTMLElement): ComponentRange | undefined {
  let pos: number
  try {
    pos = view.posAtDOM(dom)
  } catch {
    return undefined
  }
  const rs = componentRanges(view.state)
  return rs.find((r) => r.from === pos) ?? rs.find((r) => pos >= r.from && pos <= r.to)
}
/** A component's text replaced by what it wrote. */
export function replaceComponent(view: EditorView, dom: HTMLElement, src: string): void {
  const r = componentAt(view, dom)
  if (!r || r.src === src) return
  view.dispatch({ changes: { from: r.from, to: r.to, insert: src }, annotations: Transaction.userEvent.of(COMPONENT_INPUT) })
}
/** What goes with a component taken out: its lines, and one of two blank lines it leaves next to each other. */
export function cutRangeOf(view: EditorView, r: Pick<ComponentRange, 'from' | 'to'>): { from: number; to: number } {
  const doc = view.state.doc
  const len = doc.length
  if (r.to >= len) return { from: Math.max(0, r.from - 1), to: r.to }
  const cut = { from: r.from, to: r.to + 1 }
  const prevBlank = r.from > 0 && !doc.lineAt(r.from - 1).text.trim()
  const after = r.to + 1 <= len ? doc.lineAt(r.to + 1) : undefined
  if (prevBlank && after && !after.text.trim() && after.to < len) cut.to = after.to + 1
  return cut
}
/** A loop's start or end component: the loop (its start, its end line). */
function loopOfComponent(view: EditorView, r: ComponentRange): LoopRange | undefined {
  const no = view.state.doc.lineAt(r.from).number
  const loops = () => findLoops(view.state.doc.toString().split('\n'))
  switch (r.kind) {
    case 'loop':
      return loops().find((l) => l.line0 === no)
    case 'loopEnd':
      return loops().find((l) => l.end === no)
    default:
      return undefined
  }
}
/** A loop's start with all it holds, down to its end (any other component — itself). */
export function wholeComponent(view: EditorView, r: ComponentRange): ComponentRange {
  const l = r.kind === 'loop' ? loopOfComponent(view, r) : undefined
  if (!l || l.end === undefined) return r
  const to = view.state.doc.line(l.end).to
  return { ...r, to, src: view.state.sliceDoc(r.from, to) }
}
/** What goes when a component is deleted (a loop: its start and its end — the blocks it held stay where they are). */
export function cutPartsOf(view: EditorView, r: ComponentRange): Array<{ from: number; to: number }> {
  const l = loopOfComponent(view, r)
  const doc = view.state.doc
  return l && l.end !== undefined ? [cutRangeOf(view, { from: doc.line(l.line0).from, to: doc.line(l.headEnd).to }), cutRangeOf(view, { from: doc.line(l.end).from, to: doc.line(l.end).to })] : [cutRangeOf(view, r)]
}
/** Out of a component with the keys: the line after (made when there is none) / the line before. */
export function exitComponent(view: EditorView, dom: HTMLElement, dir: 1 | -1): void {
  const r = componentAt(view, dom)
  if (!r) return
  const len = view.state.doc.length
  if (dir === 1) {
    if (r.to >= len) view.dispatch({ changes: { from: len, insert: '\n' }, selection: { anchor: len + 1 }, annotations: Transaction.userEvent.of(COMPONENT_INPUT) })
    else view.dispatch({ selection: { anchor: r.to + 1 }, scrollIntoView: true })
  } else if (r.from === 0) view.dispatch({ changes: { from: 0, insert: '\n' }, selection: { anchor: 0 }, annotations: Transaction.userEvent.of(COMPONENT_INPUT) })
  else view.dispatch({ selection: { anchor: r.from - 1 }, scrollIntoView: true })
  view.focus()
}

/**
 * Typing at a component's edge goes onto a line of its own (not into the table's last row); Backspace / Delete
 * that would glue a text line onto a component do nothing (an empty line still goes).
 */
export const componentGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.isUserEvent(COMPONENT_INPUT) || tr.isUserEvent(COMPONENT_DELETE) || tr.isUserEvent(COMPONENT_MOVE) || !(tr.isUserEvent('input') || tr.isUserEvent('delete'))) return tr
  const ranges = componentRanges(tr.startState)
  if (!ranges.length) return tr
  const doc = tr.startState.doc
  let fix: { from: number; insert: string } | undefined
  let block = false
  let count = 0
  tr.changes.iterChanges((fA, tA, _fB, _tB, ins) => {
    count++
    const text = ins.toString()
    for (const r of ranges) {
      if (fA === tA && text) {
        if (fA === r.to && !text.startsWith('\n')) fix = { from: fA, insert: `\n${text}` }
        else if (fA === r.from && !text.endsWith('\n')) fix = { from: fA, insert: `${text}\n` }
      } else if (!text) {
        // the line break after / before a component, its neighbour line not empty
        if (fA === r.to && tA === r.to + 1 && doc.lineAt(tA).length) block = true
        if (tA === r.from && fA === r.from - 1 && doc.lineAt(fA).length) block = true
      }
    }
  })
  if (count !== 1) return tr
  if (block) return []
  if (fix) return { changes: fix, selection: { anchor: fix.from + fix.insert.length - (fix.insert.endsWith('\n') && !fix.insert.startsWith('\n') ? 1 : 0) }, userEvent: 'input', scrollIntoView: true }
  return tr
})

/**
 * A component on the note's last line: an empty line after it (there is always somewhere to type under it). Added
 * apart from the typing (after it, not into its transaction), at the very end (no cursor moves), out of the undo
 * history; never while a word is being composed (IME). Checked when the note opens and after every change.
 */
export const componentTail = ViewPlugin.fromClass(
  class {
    queued = false
    destroyed = false
    constructor(view: EditorView) {
      this.queue(view)
    }
    update(u: { docChanged: boolean; view: EditorView }): void {
      if (u.docChanged) this.queue(u.view)
    }
    destroy(): void {
      this.destroyed = true
    }
    /** The check queued after the current update (once, however many changes come in it). */
    queue(view: EditorView): void {
      if (this.queued) return
      this.queued = true
      queueMicrotask(() => {
        this.queued = false
        if (!this.destroyed) ensureLineAfterLastComponent(view)
      })
    }
  },
)
function ensureLineAfterLastComponent(v: EditorView): void {
  const doc = v.state.doc
  const last = doc.line(doc.lines)
  if (!last.length || v.composing) return
  if (!componentRanges(v.state).some((r) => r.to >= last.from)) return
  v.dispatch({ changes: { from: doc.length, insert: '\n' }, annotations: [Transaction.addToHistory.of(false), Transaction.userEvent.of(COMPONENT_INPUT)] })
}
