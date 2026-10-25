import { Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { BLOCK_SPECS } from '@nb/blocks/specs'
import { markOrigin, originsIn } from '@nb/workspace/sharedPlaces'
import { COMPONENT_MOVE, editorHost } from '../editorHost'
import { componentRanges } from './componentField'
import { componentAt, cutRangeOf, wholeComponent } from './componentOps'

/**
 * A component dragged by its handle: a line shows where it goes (between lines, never inside another component);
 * dropped — it moves there (one undo step); Esc — it stays. A loop's start carries the whole loop.
 */
export function dragComponent(view: EditorView, dom: HTMLElement, e0: PointerEvent): void {
  const at0 = componentAt(view, dom)
  if (!at0) return
  const r = wholeComponent(view, at0)
  const line = document.createElement('div')
  line.className = 'cm-comp-drop'
  document.body.append(line)
  const ghost = document.createElement('div')
  ghost.className = 'cm-comp-ghost'
  ghost.textContent = BLOCK_SPECS[r.kind].title
  document.body.append(ghost)
  dom.classList.add('cm-comp-moving')
  let target: number | undefined
  const content = view.contentDOM.getBoundingClientRect()
  /** The drop line put at the place under the pointer (the ghost follows the pointer). */
  const place = (x: number, y: number) => {
    ghost.style.left = `${x + 14}px`
    ghost.style.top = `${y + 10}px`
    const pos = view.posAtCoords({ x: content.left + 40, y }, false)
    const l = view.state.doc.lineAt(pos)
    const box = view.coordsAtPos(l.from)
    const below = box ? y > (box.top + box.bottom) / 2 : false
    let at = below ? Math.min(view.state.doc.length, l.to + 1) : l.from
    // never inside a component: before or after it, whichever is nearer
    const inside = componentRanges(view.state).find((c) => at > c.from && at <= c.to)
    if (inside) {
      const a = view.coordsAtPos(inside.from)
      const b = view.coordsAtPos(inside.to)
      at = a && b && y > (a.top + b.bottom) / 2 ? Math.min(view.state.doc.length, inside.to + 1) : inside.from
    }
    target = at === r.from || at === r.to + 1 || (at > r.from && at <= r.to) ? undefined : at
    const c = view.coordsAtPos(at, 1)
    line.style.display = target === undefined || !c ? 'none' : 'block'
    if (c) {
      line.style.left = `${content.left}px`
      line.style.width = `${content.width}px`
      line.style.top = `${(at >= view.state.doc.length && at > view.state.doc.lineAt(at).from ? c.bottom : c.top) - 1}px`
    }
  }
  place(e0.clientX, e0.clientY)
  const move = (ev: PointerEvent) => place(ev.clientX, ev.clientY)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('keydown', esc, true)
    line.remove()
    ghost.remove()
    dom.classList.remove('cm-comp-moving')
    if (target === undefined) return
    const len = view.state.doc.length
    const cut = cutRangeOf(view, r)
    // the place is in what is cut out (the blank line after it): just before the cut
    if (target > cut.from && target < cut.to) target = cut.from
    if (target === cut.from && cut.from === r.from) return
    const at = target
    // blank lines around it where text is next to it (a line right after a callout / a table would join it in Markdown)
    const doc = view.state.doc
    const lineAt = at >= len ? doc.line(doc.lines) : doc.lineAt(at)
    const prevText = at >= len ? lineAt.text : lineAt.number > 1 ? doc.line(lineAt.number - 1).text : ''
    const nextText = at >= len ? '' : lineAt.text
    const ins = at >= len && view.state.sliceDoc(len - 1, len) !== '\n' ? `\n\n${r.src}` : `${prevText.trim() && at < len ? '\n' : ''}${r.src}\n${nextText.trim() ? '\n' : ''}`
    // a shared note: its origin (who put it in, when) goes with it — its text is put in anew where it lands
    const path = view.state.facet(editorHost).notePath()
    const origin = originsIn(path).get(r.line)
    const tr = view.state.update({ changes: [{ ...cut, insert: '' }, { from: at, insert: ins }], annotations: Transaction.userEvent.of(COMPONENT_MOVE), scrollIntoView: true })
    view.dispatch(tr)
    if (origin) markOrigin(path, tr.changes.mapPos(at, -1) + ins.indexOf(r.src), origin)
  }
  const esc = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    target = undefined
    up()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('keydown', esc, true)
}
