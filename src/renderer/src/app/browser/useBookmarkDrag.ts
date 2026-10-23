import { ref, type ComputedRef, type Ref } from 'vue'
import type { Bookmark } from '@shared/browser'
import { findBookmark, insertBookmark, parentOfBookmark, withoutBookmarks } from '@shared/browser/bookmarkTree'
import { bookmarks } from '../../lib/browser'

/** Where a dragged bookmark goes: into a folder, or a place in the bar / a folder's list (its mark beside a bookmark). */
type BmDrop = { into: string } | { folder?: string; at: number; mark: string; side: 'before' | 'after' }

/**
 * Bookmarks dragged with the pointer: along the bar or a folder's list — their place; onto a folder (its middle) —
 * into it; out of a folder's list onto the bar — out of it. Held over a folder for a moment, it opens. A click — opened.
 */
export function useBookmarkDrag(deps: {
  bmDrag: Ref<string | undefined>
  folderPop: Ref<{ id: string; trail: string[] } | undefined>
  popFolder: ComputedRef<Bookmark | undefined>
  openFolder: (id: string, anchor?: HTMLElement, deeper?: boolean) => void
  openBm: (b: Bookmark, e: MouseEvent) => void
  saveBms: (list: Bookmark[]) => void
}) {
  const { bmDrag } = deps
  const bmGhost = ref<{ x: number; y: number; title: string }>()
  const bmDrop = ref<BmDrop>()
  function onBmDown(e: PointerEvent, b: Bookmark): void {
    if (e.button !== 0) return
    const x0 = e.clientX
    const y0 = e.clientY
    const el = e.currentTarget as HTMLElement
    let moved = false
    let hoverFolder = ''
    let hoverTimer: ReturnType<typeof setTimeout> | undefined
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      moved = true
      bmDrag.value = b.id
      bmGhost.value = { x: ev.clientX, y: ev.clientY, title: b.title }
      bmDrop.value = dropAt(ev.clientX, ev.clientY, b)
      // held over a folder: it opens (to drop at a place inside)
      const into = bmDrop.value && 'into' in bmDrop.value ? bmDrop.value.into : ''
      if (into !== hoverFolder) {
        hoverFolder = into
        clearTimeout(hoverTimer)
        if (into) {
          hoverTimer = setTimeout(() => {
            const chip = document.querySelector<HTMLElement>(`[data-bm="${into}"]`)
            if (chip?.classList.contains('bmrow')) deps.openFolder(into, undefined, true)
            else deps.openFolder(into, chip ?? undefined)
          }, 700)
        }
      }
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      clearTimeout(hoverTimer)
      const d = bmDrop.value
      bmDrag.value = undefined
      bmGhost.value = undefined
      bmDrop.value = undefined
      if (!moved) return deps.openBm(b, { ...ev, currentTarget: el, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, button: ev.button } as unknown as MouseEvent)
      if (d) moveBm(b, d)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  /** What is under the pointer: a folder to go into, or a place in the bar / a folder's list. */
  function dropAt(x: number, y: number, b: Bookmark): BmDrop | undefined {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const target = el?.closest<HTMLElement>('[data-bm]')
    const inside = (folderId: string) => !!b.children && (folderId === b.id || !!findBookmark(b.children, (x) => x.id === folderId))
    if (target) {
      const id = target.dataset.bm!
      if (id === b.id) return undefined
      const t = findBookmark(bookmarks.value, (x) => x.id === id)
      const r = target.getBoundingClientRect()
      const row = target.classList.contains('bmrow')
      // along: the bar runs left-right, a list top-down
      const pos = row ? (y - r.top) / r.height : (x - r.left) / r.width
      if (t?.children && pos > 0.25 && pos < 0.75 && !inside(id)) return { into: id }
      const parent = parentOfBookmark(bookmarks.value, id)?.id
      if (parent && inside(parent)) return undefined
      const sibs = parent ? (findBookmark(bookmarks.value, (x) => x.id === parent)?.children ?? []) : bookmarks.value
      const idx = sibs.findIndex((x) => x.id === id)
      return { folder: parent, at: pos < 0.5 ? idx : idx + 1, mark: id, side: pos < 0.5 ? 'before' : 'after' }
    }
    if (el?.closest('.bbar')) return { at: bookmarks.value.length, mark: '', side: 'after' }
    const pop = deps.folderPop.value
    if (el?.closest('.bmpop') && pop && !inside(pop.id)) return { folder: pop.id, at: deps.popFolder.value?.children?.length ?? 0, mark: '', side: 'after' }
    return undefined
  }
  function moveBm(b: Bookmark, d: BmDrop): void {
    const from = parentOfBookmark(bookmarks.value, b.id)?.id
    const sibs = from ? (findBookmark(bookmarks.value, (x) => x.id === from)?.children ?? []) : bookmarks.value
    const was = sibs.findIndex((x) => x.id === b.id)
    const list = withoutBookmarks(bookmarks.value, (x) => x.id === b.id)
    if ('into' in d) return deps.saveBms(insertBookmark(list, d.into, b))
    // the same list: its own place left it, the ones after it moved up by one
    const at = d.folder === from && was >= 0 && was < d.at ? d.at - 1 : d.at
    deps.saveBms(insertBookmark(list, d.folder, b, at))
  }
  /** A bookmark's mark while one is dragged: «into» it, or the drop's place before / after it. */
  const dropCls = (id: string) => {
    const d = bmDrop.value
    if (!d) return ''
    if ('into' in d) return d.into === id ? 'dropin' : ''
    return d.mark === id ? `drop-${d.side}` : ''
  }
  return { bmGhost, onBmDown, dropCls }
}
