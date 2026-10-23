import { itemId, transformItem, translate, type BoardItem } from '@shared/whiteboard'
import type { BoardCtx } from './boardContext'
import type { BoardImages } from './useBoardImages'

/** How far a pasted copy lands from its original (screen px). */
const PASTE_OFFSET_PX = 24

/** What is done to the selection: delete, copy / paste / duplicate (the board's own clipboard), nudge, select all. */
export function useSelectionActions(b: BoardCtx, images: BoardImages) {
  const { doc } = b
  /** Copied items (this app run). */
  let clip: BoardItem[] = []
  /** The clipboard's picture when the board's own Ctrl+C was made: a newer one is pasted as a picture. */
  let clipSig = ''

  function deleteSelected(): void {
    if (!doc.sel.value.size) return
    const ids = doc.sel.value
    doc.sel.value = new Set()
    doc.commit({ ...doc.board.value, items: doc.board.value.items.filter((i) => !ids.has(i.id)) })
  }

  function copySelected(): void {
    clip = doc.board.value.items.filter((i) => doc.sel.value.has(i.id))
    void window.qa.vaultClipImage(false).then((r) => (clipSig = r.sig))
  }

  /** The copied items pasted a little apart (and copied again from there — the next paste goes further), selected. */
  function pasteClip(dx = PASTE_OFFSET_PX / b.viewport.zoom()): void {
    if (!clip.length) return
    const m = translate(dx, dx)
    const fresh = clip.map((i) => ({ ...transformItem(i, m), id: itemId() }))
    clip = fresh
    doc.addItems(fresh)
    doc.sel.value = new Set(fresh.map((i) => i.id))
    if (b.tools.tp.value.tool !== 'select') b.tools.tp.value.tool = 'select'
  }

  /** Ctrl+V: a picture copied anywhere after the board's own copy — it; else the board's copied items. */
  async function pasteAny(): Promise<void> {
    const r = await window.qa.vaultClipImage(false).catch(() => ({ sig: '' }))
    if (r.sig && r.sig !== clipSig) {
      clipSig = r.sig
      try {
        const saved = await window.qa.vaultClipImage(true)
        const hover = b.scene.hover
        if (saved.rel) return images.addImages([saved.rel], hover ? b.viewport.toWorld(...hover) : undefined)
      } catch (e) {
        return b.warn(e)
      }
    }
    pasteClip()
  }

  /** A copy of the selection beside it. */
  function duplicate(): void {
    copySelected()
    pasteClip()
  }

  /** The selection moved by a little (world units). */
  function nudge(dx: number, dy: number): void {
    if (!doc.sel.value.size) return
    const m = translate(dx, dy)
    doc.commit({ ...doc.board.value, items: doc.board.value.items.map((i) => (doc.sel.value.has(i.id) ? transformItem(i, m) : i)) })
  }

  function selectAll(): void {
    b.tools.tp.value.tool = 'select'
    doc.sel.value = new Set(doc.board.value.items.map((i) => i.id))
    b.frames.schedule()
  }

  function clearSelection(): void {
    doc.sel.value = new Set()
    b.frames.schedule()
  }

  return { deleteSelected, copySelected, pasteClip, pasteAny, duplicate, nudge, selectAll, clearSelection }
}
export type SelectionActions = ReturnType<typeof useSelectionActions>
