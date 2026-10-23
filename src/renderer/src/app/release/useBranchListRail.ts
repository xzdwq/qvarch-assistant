import { nextTick, ref, watch, type Ref } from 'vue'
import { colors, rs } from '../../lib/releaseStore'
import { useRedrawOnResize } from './useRedrawOnResize'

/**
 * The branch list's rail: one coloured dot per branch row, the line between two dots in the lower one's colour.
 * Measured from the rows (`.brow`, direct children of the list), so redrawn when they change or resize.
 */
export function useBranchListRail(listEl: Ref<HTMLElement | undefined>, collapsed: () => boolean) {
  const listRail = ref({ svg: '', h: 0 })
  function drawListRail(): void {
    const el = listEl.value
    if (!el) return
    const rows = [...el.querySelectorAll<HTMLElement>(':scope > .brow')]
    if (!rows.length) {
      listRail.value = { svg: '', h: 0 }
      return
    }
    const centers = rows.map((r) => r.offsetTop + Math.min(r.offsetHeight / 2, 12))
    const last = rows[rows.length - 1]
    const x = 11
    let svg = ''
    rs.branches.forEach((b, i) => {
      if (i > 0 && centers[i] !== undefined) svg += `<line x1="${x}" y1="${centers[i - 1]}" x2="${x}" y2="${centers[i]}" stroke="${colors.colorFor(b.name)}" stroke-width="2" />`
    })
    rs.branches.forEach((b, i) => {
      if (centers[i] !== undefined) svg += `<circle cx="${x}" cy="${centers[i]}" r="4" fill="${colors.colorFor(b.name)}" />`
    })
    listRail.value = { svg, h: last.offsetTop + last.offsetHeight }
  }
  watch([() => rs.branches, () => rs.expanded.size, () => rs.commits.size, collapsed], () => void nextTick(drawListRail), { flush: 'post' })
  useRedrawOnResize(listEl, drawListRail)
  return listRail
}
