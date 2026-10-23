import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { mapToWorld, type MapFit } from '@shared/whiteboard'
import type { BoardCtx } from './boardContext'
import type { BoardPainter } from './paint/boardPainter'
import { MM_H, MM_W, paintMinimap } from './paint/minimap'
import { paintLiveLayer } from './paint/paintLive'

/** The sheet's canvas elements (template refs of the board). */
export interface SheetCanvases {
  cv: Ref<HTMLCanvasElement | undefined>
  lv: Ref<HTMLCanvasElement | undefined>
  mm: Ref<HTMLCanvasElement | undefined>
}

/**
 * The sheet's canvases: the board (`cv`), the live layer over it (`lv`) and the minimap (`mm`) — sized to the
 * sheet (device pixels) as it resizes, painted when the frames ask.
 */
export function useBoardCanvas(b: BoardCtx, painter: BoardPainter, preview: boolean, els: SheetCanvases) {
  const { cv, lv, mm } = els
  const { doc, viewport, tools } = b
  /** The minimap's map (to turn a click into a place). */
  let mmMap: MapFit | undefined

  /** Everything: the board, the live layer, the minimap. */
  function paintAll(): void {
    const c = cv.value
    const v = viewport.view.value
    if (!c || !v) return
    painter.paintBoard(c.getContext('2d')!, doc.board.value, doc.shown(), v, viewport.W.value, viewport.H.value, devicePixelRatio, b.text.editing.value?.id)
    paintLive()
    paintMm()
  }
  function paintLive(): void {
    if (lv.value) paintLiveLayer(lv.value, b, painter)
  }
  function paintMm(): void {
    const c = mm.value
    const v = viewport.view.value
    if (!c || !v || !tools.tp.value.minimap) return
    mmMap = paintMinimap(c, painter, doc.board.value, doc.shown(), v, viewport.W.value, viewport.H.value)
  }

  /** A press / drag on the minimap: the view's centre goes there. */
  function mmGo(e: PointerEvent): void {
    if (!mmMap || !viewport.view.value) return
    if (e.type === 'pointerdown') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    else if (!(e.buttons & 1)) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    viewport.centreOn(...mapToWorld(mmMap, e.clientX - r.left, e.clientY - r.top))
  }
  const sizeMinimap = () => {
    if (!mm.value) return
    mm.value.width = MM_W * devicePixelRatio
    mm.value.height = MM_H * devicePixelRatio
  }
  watch(
    () => tools.tp.value.minimap,
    async (on) => {
      if (!on) return
      await nextTick()
      sizeMinimap()
      b.frames.schedule()
    },
  )

  /** The sheet resized: the canvases follow; the first time — the remembered view (or the whole board). */
  function resize(): void {
    const el = b.sheet.value
    if (!el) return
    const r = el.getBoundingClientRect()
    viewport.W.value = Math.max(1, r.width)
    viewport.H.value = Math.max(1, r.height)
    for (const c of [cv.value, lv.value]) {
      if (!c) continue
      c.width = Math.round(viewport.W.value * devicePixelRatio)
      c.height = Math.round(viewport.H.value * devicePixelRatio)
    }
    sizeMinimap()
    if (preview) viewport.fit()
    else if (!viewport.view.value) {
      viewport.view.value = viewport.readView()
      if (!viewport.view.value) viewport.fit()
    }
    b.frames.render()
  }
  let ro: ResizeObserver | undefined
  onMounted(() => {
    ro = new ResizeObserver(resize)
    if (b.sheet.value) ro.observe(b.sheet.value)
    window.addEventListener('resize', resize)
    resize()
  })
  onBeforeUnmount(() => {
    ro?.disconnect()
    window.removeEventListener('resize', resize)
    b.frames.cancel()
  })

  return { paintAll, paintLive, mmGo }
}
