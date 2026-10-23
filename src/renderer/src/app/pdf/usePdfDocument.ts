import { markRaw, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PageBox } from '@shared/pdfPlacement'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** How long the zoom rests before the pages are drawn again (ms). */
const ZOOM_RENDER_MS = 120

/**
 * The PDF being signed: opened (its original bytes kept for saving), its pages measured and drawn onto their
 * canvases at the zoom (and the screen's pixel density).
 */
export function usePdfDocument(onOpened: () => void) {
  const fileName = ref('')
  /** The file's bytes as opened (the signed copy is made from them). */
  let original: Uint8Array | undefined
  const doc = shallowRef<pdfjs.PDFDocumentProxy>()
  const pages = ref<PageBox[]>([])
  const zoom = ref(1.25)
  const busy = ref('')
  const canvases = new Map<number, HTMLCanvasElement>()

  /** A page's canvas (a template ref callback): kept by its page number. */
  const setCanvas = (i: number) => (el: unknown) => {
    if (el instanceof HTMLCanvasElement) canvases.set(i, el)
    else canvases.delete(i)
  }

  let renderSeq = 0
  /** Every page drawn (a newer call stops an older one). */
  async function renderAll(): Promise<void> {
    const d = doc.value
    if (!d) return
    const my = ++renderSeq
    const dpr = window.devicePixelRatio || 1
    for (let i = 1; i <= d.numPages; i++) {
      if (my !== renderSeq) return
      const c = canvases.get(i)
      if (!c) continue
      const p = await d.getPage(i)
      const vp = p.getViewport({ scale: zoom.value * dpr })
      c.width = Math.floor(vp.width)
      c.height = Math.floor(vp.height)
      await p.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
    }
  }
  let zoomTimer: ReturnType<typeof setTimeout> | undefined
  watch(zoom, () => {
    clearTimeout(zoomTimer)
    zoomTimer = setTimeout(() => void renderAll(), ZOOM_RENDER_MS)
  })
  const setZoom = (z: number) => (zoom.value = Math.min(3, Math.max(0.5, Math.round(z * 100) / 100)))

  /** A PDF opened: measured, shown; `onOpened` — what belonged to the previous one goes. */
  async function openFile(f: File | undefined): Promise<void> {
    if (!f) return
    busy.value = 'Открываю…'
    try {
      original = new Uint8Array(await f.arrayBuffer())
      // pdf.js may take the buffer over — it gets a copy, the original stays for saving
      const d = await pdfjs.getDocument({ data: original.slice() }).promise
      const list: PageBox[] = []
      for (let i = 1; i <= d.numPages; i++) {
        const p = await d.getPage(i)
        const vp = p.getViewport({ scale: 1 })
        list.push({ w: vp.width, h: vp.height, view: p.view })
      }
      void doc.value?.destroy()
      doc.value = markRaw(d)
      pages.value = list
      onOpened()
      fileName.value = f.name
      await nextTick()
      void renderAll()
    } catch (e) {
      alert(`Не удалось открыть PDF: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      busy.value = ''
    }
  }

  onBeforeUnmount(() => void doc.value?.destroy())

  return { fileName, original: () => original, pages, zoom, busy, setCanvas, setZoom, openFile }
}
