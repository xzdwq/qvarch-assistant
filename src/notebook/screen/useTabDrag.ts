import { ref } from 'vue'
import { layout, moveTab, splitWith } from '@nb/workspace/paneLayout'

/**
 * Tabs dragged: reordered in their row (the others make room, animated), moved to the other pane, or dropped at a
 * pane's edge — the window splits (like VS Code).
 */
export function useTabDrag() {
  const tabDrag = ref<{ pane: number; path: string }>()
  /** A pane's drop zone under the pointer: its edge (a split) or the whole of it (a move there). */
  const zone = ref<{ pane: number; side: 'left' | 'right' | 'here' }>()

  function onTabDragStart(pi: number, path: string, e: DragEvent): void {
    tabDrag.value = { pane: pi, path }
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      // not text/plain — an editor under the pointer must not take it as text
      e.dataTransfer.setData('application/x-qa-tab', path)
    }
  }
  /** The tab goes before / after the tab under the pointer (by its half); a tab of the other pane — into that pane. */
  function moveDragged(pi: number, to: number): void {
    const d = tabDrag.value
    if (!d) return
    if (d.pane === pi) {
      const cur = layout.panes[pi].tabs.findIndex((t) => t.path === d.path)
      if (cur < 0 || to === cur || to === cur + 1) return
      moveTab(pi, d.path, pi, to)
      return
    }
    const before = layout.panes.length
    moveTab(d.pane, d.path, pi, to)
    // the source pane may have closed (its last tab left): the panes shift
    tabDrag.value = { pane: layout.panes.length < before && d.pane < pi ? pi - 1 : pi, path: d.path }
  }
  /** The tab follows the pointer right away: over a tab's left half — before it, over its right half — after it. */
  function onTabDragOver(pi: number, index: number, e: DragEvent): void {
    if (!tabDrag.value) return
    e.preventDefault()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    moveDragged(pi, e.clientX > r.left + r.width / 2 ? index + 1 : index)
  }
  /** At the end of a pane's tab row. */
  function onTabRowEnd(pi: number, e: DragEvent): void {
    const d = tabDrag.value
    if (!d) return
    e.preventDefault()
    const n = layout.panes[pi].tabs.length
    if (d.pane === pi && layout.panes[pi].tabs[n - 1]?.path === d.path) return
    moveDragged(pi, n)
  }
  function onTabDrop(): void {
    tabDrag.value = undefined
    zone.value = undefined
  }
  /** Dropped at a pane's edge — the window splits; onto the other pane — the tab moves there. */
  function onZoneDrop(): void {
    const d = tabDrag.value
    const z = zone.value
    onTabDrop()
    if (!d || !z) return
    if (z.side === 'here') moveTab(d.pane, d.path, z.pane, layout.panes[z.pane].tabs.length)
    else splitWith(d.pane, d.path, z.side)
  }
  return { tabDrag, zone, onTabDragStart, onTabDragOver, onTabRowEnd, onTabDrop, onZoneDrop }
}
