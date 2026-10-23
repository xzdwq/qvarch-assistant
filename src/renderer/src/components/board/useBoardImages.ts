import { ref, type Ref } from 'vue'
import { itemId, type ImageItem } from '@shared/whiteboard'
import { draggedImageUrl, hasImages, takeImages } from '../../lib/notebook'
import type { BoardCtx } from './boardContext'

/** Several pictures added at once are put this far apart (screen px). */
const IMAGE_STAGGER_PX = 24
/** A picture takes at most this part of the view. */
const IMAGE_MAX_VIEW = 0.7

/** Pictures onto the board: picked from files, dropped onto the sheet, pasted (by the clipboard actions). */
export function useBoardImages(b: BoardCtx, imgInput: Ref<HTMLInputElement | undefined>) {
  const { doc, viewport } = b
  /** A file is dragged over the sheet (its drop frame shown). */
  const dropping = ref(false)

  /**
   * Pictures (already in the vault) onto the board, centred at a point (the view's middle): as big as on the
   * screen, at most most of the view; several — a little apart. They come selected, to be moved / sized at once.
   */
  async function addImages(rels: string[], at?: readonly [number, number]): Promise<void> {
    const v = viewport.view.value
    if (!rels.length || !v) return
    const [cx, cy] = at ?? viewport.middle()
    const fresh: ImageItem[] = []
    let off = 0
    for (const src of rels) {
      const p = b.pictures.get(src)
      await p.ready
      const nw = p.img?.naturalWidth || 480
      const nh = p.img?.naturalHeight || 320
      // a screenshot's pixels are the screen's: as big as it was on it
      let w = nw / devicePixelRatio / v.z
      let h = nh / devicePixelRatio / v.z
      const k = Math.min(1, (viewport.W.value * IMAGE_MAX_VIEW) / v.z / w, (viewport.H.value * IMAGE_MAX_VIEW) / v.z / h)
      w *= k
      h *= k
      fresh.push({ id: itemId(), type: 'image', x: cx - w / 2 + off, y: cy - h / 2 + off, w, h, src })
      off += IMAGE_STAGGER_PX / v.z
    }
    doc.addItems(fresh)
    b.tools.tp.value.tool = 'select'
    doc.sel.value = new Set(fresh.map((i) => i.id))
    b.sheet.value?.focus({ preventScroll: true })
  }

  /** The file picker for pictures. */
  function pickImages(): void {
    if (!imgInput.value) return
    imgInput.value.value = ''
    imgInput.value.click()
  }
  async function onImagesPicked(): Promise<void> {
    const files = [...(imgInput.value?.files ?? [])]
    if (files.length) await addImages(await takeImages({ files }, b.warn))
  }

  function onDragOver(e: DragEvent): void {
    const t = e.dataTransfer?.types ?? []
    if (!t.includes('Files') && !t.includes('text/html')) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    dropping.value = true
  }
  function onDragLeave(e: DragEvent): void {
    if (!b.sheet.value?.contains(e.relatedTarget as Node | null)) dropping.value = false
  }
  /** Picture files (or a picture dragged from a page) dropped: onto the board where they fell. */
  async function onDrop(e: DragEvent): Promise<void> {
    dropping.value = false
    const dt = e.dataTransfer
    const uri = hasImages(dt) ? undefined : draggedImageUrl(dt)
    if (!dt || (!hasImages(dt) && !uri)) return
    e.preventDefault()
    const files = [...dt.files]
    const at = viewport.toWorld(...b.local(e))
    await addImages(await takeImages({ files, uri }, b.warn), at)
  }

  return { dropping, addImages, pickImages, onImagesPicked, onDragOver, onDragLeave, onDrop }
}
export type BoardImages = ReturnType<typeof useBoardImages>
