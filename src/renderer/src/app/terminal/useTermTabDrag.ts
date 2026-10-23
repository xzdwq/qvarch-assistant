import { computed, ref, type Ref } from 'vue'
import { moveTermTab, splitTermWith, termLayout } from '../../lib/terminal'
import type { TermShells } from './useTermShells'

/**
 * Tabs are dragged with the pointer (not the browser's drag and drop): over a tab row — the tab takes its place
 * there at once (the others make room), in this pane or the other one; over a pane's body — the edge zones split
 * the window (one pane), the other pane takes it (two). A small label follows the pointer.
 */
export function useTermTabDrag(panesEl: Ref<HTMLElement | undefined>, shells: TermShells) {
  const tabDrag = ref<{ pane: number; id: string; x: number; y: number }>()
  const zone = ref<{ pane: number; side: 'left' | 'right' | 'here' }>()
  /** A drag just ended — the click that follows it does not count. */
  let dragged = false

  function onTabDown(e: PointerEvent, pi: number, id: string): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return
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
      if (z.side === 'here') moveTermTab(from, id, z.pane, termLayout.panes[z.pane].tabs.length)
      else splitTermWith(from, id, z.side)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  /** Where the dragged tab is over: moves it in a tab row, or picks a drop zone. Returns its pane now. */
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
      // the tab row: its place among the other tabs, by their middles
      const list = el.querySelector<HTMLElement>('.tlist')
      if (!list) return from
      const box = list.getBoundingClientRect()
      // layout px per screen px (the section's CSS zoom); offsetLeft is free of the move animation
      const k = list.offsetWidth ? box.width / list.offsetWidth : 1
      const lx = (x - box.left) / k
      const others = termLayout.panes[pi].tabs.filter((t) => t !== id)
      const at = [...list.querySelectorAll<HTMLElement>('.tab')].filter((t) => t.dataset.id !== id && others.includes(t.dataset.id!)).filter((t) => t.offsetLeft + t.offsetWidth / 2 < lx).length
      if (pi === from) {
        const cur = termLayout.panes[pi].tabs
        if (cur.indexOf(id) === at) return from
        termLayout.panes[pi].tabs = [...others.slice(0, at), id, ...others.slice(at)]
        return from
      }
      const before = termLayout.panes.length
      moveTermTab(from, id, pi, at)
      // the pane it left may have closed (its only tab came here): the panes shift
      return termLayout.panes.length < before && from < pi ? pi - 1 : pi
    }
    // the body: the edges split (one pane, at least two tabs); the other pane takes it
    if (termLayout.panes.length === 1) {
      if (termLayout.panes[0].tabs.length < 2) return from
      const r = el.getBoundingClientRect()
      if (x < r.left + r.width * 0.3) zone.value = { pane: pi, side: 'left' }
      else if (x > r.right - r.width * 0.3) zone.value = { pane: pi, side: 'right' }
    } else if (pi !== from) zone.value = { pane: pi, side: 'here' }
    return from
  }
  const dragTitle = computed(() => shells.byId(tabDrag.value?.id)?.title ?? '')
  /** A tab clicked (not the end of a drag): shown. */
  function onTabClick(pi: number, id: string): void {
    if (!dragged) shells.show(pi, id)
  }
  return { tabDrag, zone, dragTitle, onTabDown, onTabClick }
}
