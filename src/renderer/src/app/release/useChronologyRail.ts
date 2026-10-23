import { computed, nextTick, ref, watch, type Ref } from 'vue'
import type { CommitInfo } from '@shared/release'
import { computeRail, drawRail, railWidth, type Row } from '../../lib/releaseRail'
import { colors, planTick, rs } from '../../lib/releaseStore'
import { plan } from './planView'
import { useRedrawOnResize } from './useRedrawOnResize'

/** The chronology's rows by date: the items, dev's context commits and merge markers, the anchor (unless folded). */
const rows = computed<Row[]>(() => {
  void planTick.value
  const p = plan.value
  if (!p || !p.items.length) return []
  const ctx = rs.contextCollapsed ? [] : (p.contextCommits ?? [])
  const markers: Row[] = Object.entries(p.mergeEventsByBranch ?? {}).flatMap(([branch, evs]) =>
    evs.map((ev) => ({ kind: 'mergeMarker' as const, date: ev.authorDate, branch, commit: { ...ev, parents: [], alreadyInMain: false } as CommitInfo & { prUrl: string | null; prNumber: number | null } })),
  )
  const markerShas = new Set(markers.map((m) => (m as { commit: CommitInfo }).commit.sha))
  return [
    ...p.items.map((item) => ({ kind: 'item' as const, date: item.authorDate, item })),
    ...ctx.filter((c) => !markerShas.has(c.sha)).map((c) => ({ kind: 'context' as const, date: c.authorDate, commit: c })),
    ...markers,
    ...(rs.contextCollapsed || !p.anchorCommit ? [] : [{ kind: 'anchor' as const, date: p.anchorCommit.authorDate, commit: p.anchorCommit }]),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
})

/**
 * The branch rail left of the chronology: lanes computed from the rows, drawn at the rows' measured centres
 * (`.trow`, direct children of the rows box) — redrawn when the rows change, fold or resize.
 */
export function useChronologyRail(rowsEl: Ref<HTMLElement | undefined>, collapsed: () => boolean) {
  const rail = computed(() => computeRail(rows.value, plan.value?.absorbedBranches ?? []))
  const railW = computed(() => railWidth(rail.value))
  const railSvg = ref('')
  const railH = ref(0)
  function drawNow(): void {
    const el = rowsEl.value
    if (!el || !rows.value.length) {
      railSvg.value = ''
      return
    }
    const rowEls = [...el.querySelectorAll<HTMLElement>(':scope > .trow')]
    const centers = rowEls.map((r) => r.offsetTop + r.offsetHeight / 2)
    railH.value = el.scrollHeight
    railSvg.value = drawRail(rail.value, rows.value, centers, el.scrollHeight, colors.colorFor)
  }
  watch([rows, () => rs.contextCollapsed, () => rs.expandedConflicts.size, collapsed], () => void nextTick(drawNow), { flush: 'post' })
  useRedrawOnResize(rowsEl, drawNow)

  /** Hovering a dot lights its whole branch on the rail. */
  function onRailOver(e: MouseEvent): void {
    const b = (e.target as Element).closest?.('[data-branch]')?.getAttribute('data-branch')
    const svg = (e.currentTarget as HTMLElement).querySelector('svg')
    if (!svg) return
    for (const el of svg.querySelectorAll<SVGElement>('[data-branch]')) {
      el.classList.toggle('hot', !!b && el.getAttribute('data-branch') === b)
      el.classList.toggle('dim', !!b && el.getAttribute('data-branch') !== b)
    }
  }
  return { rows, railW, railSvg, railH, onRailOver }
}
