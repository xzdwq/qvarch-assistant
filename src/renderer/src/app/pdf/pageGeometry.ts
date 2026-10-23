import type { Ref } from 'vue'

/** The pages on screen (the `.pg` elements in the scroll box, each with its `data-page`): which is where. */
export function usePageGeometry(scrollEl: Ref<HTMLElement | undefined>) {
  const pageEls = () => [...(scrollEl.value?.querySelectorAll<HTMLElement>('.pg') ?? [])]

  /** The page under (or nearest to) a screen point, with its rectangle. */
  function pageAt(cx: number, cy: number): { page: number; r: DOMRect } | undefined {
    let best: { page: number; r: DOMRect; d: number } | undefined
    for (const el of pageEls()) {
      const r = el.getBoundingClientRect()
      const d = Math.max(0, r.top - cy, cy - r.bottom) + Math.max(0, r.left - cx, cx - r.right)
      if (!best || d < best.d) best = { page: Number(el.dataset.page), r, d }
    }
    return best && { page: best.page, r: best.r }
  }

  /** A page's rectangle on screen. */
  const pageRect = (n: number) => pageEls().find((el) => Number(el.dataset.page) === n)?.getBoundingClientRect()

  /** The page most in view. */
  function visiblePage(): number {
    const box = scrollEl.value?.getBoundingClientRect()
    let best = 1
    let bestArea = -1
    for (const el of pageEls()) {
      const r = el.getBoundingClientRect()
      const area = Math.max(0, Math.min(r.bottom, box?.bottom ?? 0) - Math.max(r.top, box?.top ?? 0))
      if (area > bestArea) {
        bestArea = area
        best = Number(el.dataset.page)
      }
    }
    return best
  }

  /** The middle (points from the page's top) of what is seen of a page; undefined — not measurable. */
  function seenMiddle(n: number, zoom: number): number | undefined {
    const r = pageRect(n)
    const box = scrollEl.value?.getBoundingClientRect()
    if (!r || !box) return undefined
    const top = Math.max(r.top, box.top)
    const bottom = Math.min(r.bottom, box.bottom)
    return ((top + bottom) / 2 - r.top) / zoom
  }

  return { pageAt, pageRect, visiblePage, seenMiddle }
}
export type PageGeometry = ReturnType<typeof usePageGeometry>
