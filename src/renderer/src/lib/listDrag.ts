/**
 * Reordering a vertical list by dragging a row's handle. The pointer is followed on the window (a row moved in
 * the DOM loses its pointer capture — the drag must not stop with it), the place is found from the rows' layout
 * positions (offsetTop: no transforms of a move animation, no CSS zoom), every change of place is reported at
 * once, and the end once.
 */
export function startListDrag(
  e: PointerEvent,
  o: {
    /** The element whose children are the rows (in order). */
    list: HTMLElement
    /** The dragged row's index now. */
    index: number
    move: (from: number, to: number) => void
    done: () => void
  },
): void {
  if (e.button !== 0) return
  e.preventDefault()
  let at = o.index
  const rows = () => [...o.list.children].filter((c): c is HTMLElement => c instanceof HTMLElement)
  const onMove = (ev: PointerEvent) => {
    const box = o.list.getBoundingClientRect()
    // layout px per screen px (CSS zoom of an ancestor)
    const k = o.list.offsetHeight ? box.height / o.list.offsetHeight : 1
    const y = (ev.clientY - box.top) / k + o.list.scrollTop
    const list = rows()
    const base = list[0]?.offsetTop ?? 0
    let to = 0
    list.forEach((r, i) => {
      if (i !== at && r.offsetTop - base + r.offsetHeight / 2 < y) to++
    })
    to = Math.max(0, Math.min(list.length - 1, to))
    if (to !== at) {
      o.move(at, to)
      at = to
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    document.body.style.cursor = ''
    o.done()
  }
  document.body.style.cursor = 'grabbing'
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}
