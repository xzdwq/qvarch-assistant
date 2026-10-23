import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { imageSize, readDataUrl, toPng } from './imageData'
import type { PageGeometry } from './pageGeometry'
import { ARROW_SHIFTS, isArrowKey, type ArrowKey } from '@shared/arrowKeys'
import { clampCentre, newPlacement, resizeFromCorner, turnedBy, type PageBox, type Placed } from '@shared/pdfPlacement'

/** Until the pointer is released, its moves go to `move`. */
function followPointer(move: (ev: PointerEvent) => void): void {
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true })
}

/**
 * The drawings placed on the pages: put (dropped, clicked), selected, moved across pages, resized from a
 * corner, turned, recoloured, made see-through, copied, removed — by the pointer and the keys.
 */
export function usePlacements(o: {
  pages: Ref<PageBox[]>
  zoom: Ref<number>
  geometry: PageGeometry
  /** A drawing's tint is to be made (it shows once ready). */
  makeTint: (url: string, c: string) => void
  /** A PDF dropped: opened instead. */
  openPdf: (f: File) => void
  /** The keys are someone else's now (a dialog open). */
  keysBusy: () => boolean
}) {
  const { pages, zoom, geometry } = o
  const items = ref<Placed[]>([])
  const selected = ref<string>()
  const sel = computed(() => items.value.find((x) => x.id === selected.value))
  const update = (id: string, patch: Partial<Placed>) => (items.value = items.value.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const pageItems = (n: number) => items.value.filter((x) => x.page === n)

  /** A drawing put on a page, centred at (cx, cy) points (default — the page's middle, ¾ down), selected. */
  async function place(url: string, page: number, cx?: number, cy?: number): Promise<void> {
    const pg = pages.value[page - 1]
    if (!pg) return
    const box = newPlacement(pg, await imageSize(url), cx, cy)
    const id = crypto.randomUUID()
    items.value = [...items.value, { id, page, ...box, url, rot: 0, opacity: 1 }]
    selected.value = id
  }
  /** A click on a drawing: the middle of what is seen of the page most in view. */
  function addToPage(url: string): void {
    const n = geometry.visiblePage()
    const mid = geometry.seenMiddle(n, zoom.value)
    void place(url, n, undefined, mid)
  }
  function onDragStart(e: DragEvent, url: string): void {
    e.dataTransfer?.setData('text/x-sig', url)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
  }
  /** A drawing from the panel → there; a PDF file → open it; a picture file → put it there. */
  async function onDrop(e: DragEvent): Promise<void> {
    const at = geometry.pageAt(e.clientX, e.clientY)
    const pos = at && ([at.page, (e.clientX - at.r.left) / zoom.value, (e.clientY - at.r.top) / zoom.value] as const)
    const url = e.dataTransfer?.getData('text/x-sig')
    if (url) {
      if (pos) void place(url, ...pos)
      return
    }
    const f = e.dataTransfer?.files?.[0]
    if (!f) return
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) return void o.openPdf(f)
    if (/^image\/(png|jpeg|webp)$/.test(f.type) && pos) {
      // pdf-lib takes PNG: a JPEG / WebP goes through a canvas
      const src = await readDataUrl(f)
      const png = f.type === 'image/png' ? src : await toPng(src)
      void place(png, ...pos)
    }
  }

  /** Moving: follows the pointer from page to page. */
  function startMove(e: PointerEvent, it: Placed): void {
    selected.value = it.id
    const r0 = geometry.pageRect(it.page)
    if (!r0) return
    const gx = (e.clientX - r0.left) / zoom.value - it.x
    const gy = (e.clientY - r0.top) / zoom.value - it.y
    followPointer((ev) => {
      const hit = geometry.pageAt(ev.clientX, ev.clientY)
      if (!hit) return
      const pg = pages.value[hit.page - 1]
      const cur = items.value.find((x) => x.id === it.id)
      if (!cur) return
      update(it.id, {
        page: hit.page,
        x: clampCentre((ev.clientX - hit.r.left) / zoom.value - gx, cur.w, pg.w),
        y: clampCentre((ev.clientY - hit.r.top) / zoom.value - gy, cur.h, pg.h),
      })
    })
  }
  /** Resizing from a corner (sx, sy = ±1), keeping the proportions; the opposite corner stays put. */
  function startSize(e: PointerEvent, it: Placed, sx: number, sy: number): void {
    selected.value = it.id
    const x0 = e.clientX
    const y0 = e.clientY
    const s = { ...it }
    followPointer((ev) => update(it.id, resizeFromCorner(s, sx, sy, (ev.clientX - x0) / zoom.value, (ev.clientY - y0) / zoom.value)))
  }
  /** Turning around the centre (Shift — by 15°; close to straight snaps straight). */
  function startRotate(e: PointerEvent, it: Placed): void {
    selected.value = it.id
    const r = geometry.pageRect(it.page)
    if (!r) return
    const cx = r.left + (it.x + it.w / 2) * zoom.value
    const cy = r.top + (it.y + it.h / 2) * zoom.value
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx)
    followPointer((ev) => update(it.id, { rot: turnedBy(it.rot, Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0, ev.shiftKey) }))
  }

  function removeItem(id: string): void {
    items.value = items.value.filter((x) => x.id !== id)
    if (selected.value === id) selected.value = undefined
  }
  /** A copy a little lower-right (its centre kept on the page), selected. */
  function duplicate(it: Placed): void {
    const pg = pages.value[it.page - 1]
    const id = crypto.randomUUID()
    items.value = [...items.value, { ...it, id, x: clampCentre(it.x + 14, it.w, pg.w), y: clampCentre(it.y + 14, it.h, pg.h) }]
    selected.value = id
  }
  /** The selected drawing's opacity, % (5…100). */
  function setOpacity(v: number): void {
    if (!sel.value || !Number.isFinite(v)) return
    update(sel.value.id, { opacity: Math.min(100, Math.max(5, Math.round(v))) / 100 })
  }
  /** The selected drawing recoloured (undefined — its own colours). */
  function setTint(c: string | undefined): void {
    if (!sel.value) return
    update(sel.value.id, { tint: c })
    if (c) o.makeTint(sel.value.url, c)
  }

  /** An arrow key moves the drawing by a point (Shift — by 10), kept on its page. */
  function nudge(it: Placed, key: ArrowKey, e: KeyboardEvent): void {
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    const pg = pages.value[it.page - 1]
    const [dx, dy] = ARROW_SHIFTS[key].map((d) => d * step)
    update(it.id, { x: clampCentre(it.x + dx, it.w, pg.w), y: clampCentre(it.y + dy, it.h, pg.h) })
  }
  /** Keys (by `KeyboardEvent.key`) on the selected drawing. */
  const KEY_ACTIONS: Record<string, (it: Placed) => void> = {
    Delete: (it) => removeItem(it.id),
    Backspace: (it) => removeItem(it.id),
    Escape: () => (selected.value = undefined),
  }

  /** Keys on the selected drawing: Delete, Esc, arrows (Shift — by 10), Ctrl+D — a copy. */
  function onKey(e: KeyboardEvent): void {
    const t = e.target
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || o.keysBusy()) return
    const it = sel.value
    if (!it) return
    if (Object.hasOwn(KEY_ACTIONS, e.key)) KEY_ACTIONS[e.key](it)
    else if (isArrowKey(e.key)) nudge(it, e.key, e)
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
      e.preventDefault()
      duplicate(it)
    }
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

  /** A new document: nothing placed, nothing selected. */
  function reset(): void {
    items.value = []
    selected.value = undefined
  }

  return { items, selected, sel, update, pageItems, place, addToPage, onDragStart, onDrop, startMove, startSize, startRotate, removeItem, duplicate, setOpacity, setTint, reset }
}
export type Placements = ReturnType<typeof usePlacements>
