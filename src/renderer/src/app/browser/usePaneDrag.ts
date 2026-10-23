import { ref } from 'vue'
import { bLayout, moveTab, splitWith } from '../../lib/browser'

/**
 * The panes by the pointer: the split's width dragged; tabs dragged — along a row, the order; onto the other pane's
 * row, moved there; onto a page's edge, a split; onto the other pane, moved into it.
 */
export function usePaneDrag(deps: { show: (pi: number, id: string) => void }) {
  /** The panes' box (its panes found under the pointer). */
  const panesEl = ref<HTMLElement>()
  const tabDrag = ref<{ pane: number; id: string; x: number; y: number }>()
  /** Where a dragged tab would go: a side of the page (a split), or the other pane. */
  const zone = ref<{ pane: number; side: 'left' | 'right' | 'here' }>()
  function onSplitResize(e: PointerEvent): void {
    const x0 = e.clientX
    const s0 = bLayout.split
    const w = panesEl.value?.clientWidth ?? 1000
    const move = (ev: PointerEvent) => (bLayout.split = Math.min(0.8, Math.max(0.2, s0 + (ev.clientX - x0) / w)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  let dragged = false
  function onTabDown(e: PointerEvent, pi: number, id: string): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const x0 = e.clientX
    const y0 = e.clientY
    let from = pi
    const move = (ev: PointerEvent) => {
      if (!tabDrag.value) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
        tabDrag.value = { pane: from, id, x: ev.clientX, y: ev.clientY }
        document.body.style.cursor = 'grabbing'
      }
      tabDrag.value.x = ev.clientX
      tabDrag.value.y = ev.clientY
      from = dragOver(from, id, ev.clientX, ev.clientY)
      tabDrag.value.pane = from
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      if (!tabDrag.value) return
      dragged = true
      setTimeout(() => (dragged = false))
      const z = zone.value
      tabDrag.value = undefined
      zone.value = undefined
      if (!z) return
      if (z.side === 'here') moveTab(from, id, z.pane, bLayout.panes[z.pane].tabs.length)
      else splitWith(from, id, z.side)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  /** The tab dragged over (x, y): the order in a row, a move to the other pane's row, a drop zone. Its pane now. */
  function dragOver(from: number, id: string, x: number, y: number): number {
    zone.value = undefined
    const panes = [...(panesEl.value?.querySelectorAll<HTMLElement>(':scope > .pane') ?? [])]
    const pi = panes.findIndex((el) => {
      const r = el.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    })
    if (pi < 0) return from
    const el = panes[pi]
    const bar = el.querySelector<HTMLElement>('.tbar')!.getBoundingClientRect()
    if (y <= bar.bottom) {
      const list = el.querySelector<HTMLElement>('.tlist')
      if (!list) return from
      const box = list.getBoundingClientRect()
      const k = list.offsetWidth ? box.width / list.offsetWidth : 1
      const lx = (x - box.left) / k
      const others = bLayout.panes[pi].tabs.filter((t) => t !== id)
      const at = [...list.querySelectorAll<HTMLElement>('.tab')].filter((t) => t.dataset.id !== id && others.includes(t.dataset.id!)).filter((t) => t.offsetLeft + t.offsetWidth / 2 < lx).length
      if (pi === from) {
        if (bLayout.panes[pi].tabs.indexOf(id) !== at) bLayout.panes[pi].tabs = [...others.slice(0, at), id, ...others.slice(at)]
        return from
      }
      const before = bLayout.panes.length
      moveTab(from, id, pi, at)
      return bLayout.panes.length < before && from < pi ? pi - 1 : pi
    }
    if (bLayout.panes.length === 1) {
      if (bLayout.panes[0].tabs.length < 2) return from
      const r = el.getBoundingClientRect()
      if (x < r.left + r.width * 0.3) zone.value = { pane: pi, side: 'left' }
      else if (x > r.right - r.width * 0.3) zone.value = { pane: pi, side: 'right' }
    } else if (pi !== from) zone.value = { pane: pi, side: 'here' }
    return from
  }
  function onTabClick(pi: number, id: string): void {
    if (!dragged) deps.show(pi, id)
  }
  return { panesEl, tabDrag, zone, onSplitResize, onTabDown, onTabClick }
}
