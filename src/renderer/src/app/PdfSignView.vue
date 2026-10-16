<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { degrees, PDFDocument } from 'pdf-lib'
import Icon from '../components/Icon.vue'
import ZoomChip from '../components/ZoomChip.vue'
import SignaturePad from '../components/SignaturePad.vue'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Подпись PDF: open a PDF, make a signature (drawn, typed in a handwriting font or from a picture) once —
 * it is kept — and put it anywhere on any page, as many times as needed (drag it from the panel or click
 * it). A placed one moves (across pages too), resizes, turns, takes a colour and transparency; then the
 * signed copy is saved. Nothing leaves the computer.
 */
interface Placed {
  id: string
  page: number
  /** In PDF points from the page's top-left (independent of the zoom); the box before turning. */
  x: number
  y: number
  w: number
  h: number
  url: string
  /** Turn, degrees clockwise (around the centre). */
  rot: number
  /** 0…1 */
  opacity: number
  /** Repaint in this colour (the drawing's shape, one colour). */
  tint?: string
}

// ---------- the drawings ----------
const sigs = ref<Array<{ id: string; url: string }>>([])
const padOpen = ref(false)
const loadSigs = async () => (sigs.value = await window.qa.sigList())
onMounted(loadSigs)
async function saveSig(url: string): Promise<void> {
  padOpen.value = false
  await window.qa.sigSave(url)
  await loadSigs()
}
async function dropSig(id: string): Promise<void> {
  await window.qa.sigDelete(id)
  await loadSigs()
}

// ---------- the document ----------
const fileName = ref('')
let original: Uint8Array | undefined
const doc = shallowRef<pdfjs.PDFDocumentProxy>()
/** Each page's size in points and its crop box (where drawings go on save). */
const pages = ref<Array<{ w: number; h: number; view: number[] }>>([])
const zoom = ref(1.25)
const items = ref<Placed[]>([])
const selected = ref<string>()
const busy = ref('')
const fileIn = ref<HTMLInputElement>()

async function openFile(f: File | undefined): Promise<void> {
  if (!f) return
  busy.value = 'Открываю…'
  try {
    original = new Uint8Array(await f.arrayBuffer())
    // pdf.js may take the buffer over — it gets a copy, the original stays for saving
    const d = await pdfjs.getDocument({ data: original.slice() }).promise
    const list: typeof pages.value = []
    for (let i = 1; i <= d.numPages; i++) {
      const p = await d.getPage(i)
      const vp = p.getViewport({ scale: 1 })
      list.push({ w: vp.width, h: vp.height, view: p.view })
    }
    void doc.value?.destroy()
    doc.value = markRaw(d)
    pages.value = list
    items.value = []
    selected.value = undefined
    fileName.value = f.name
    await nextTick()
    void renderAll()
  } catch (e) {
    alert(`Не удалось открыть PDF: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    busy.value = ''
    if (fileIn.value) fileIn.value.value = ''
  }
}

const canvases = new Map<number, HTMLCanvasElement>()
const setCanvas = (i: number) => (el: unknown) => {
  if (el instanceof HTMLCanvasElement) canvases.set(i, el)
  else canvases.delete(i)
}
let renderSeq = 0
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
  zoomTimer = setTimeout(() => void renderAll(), 120)
})
const setZoom = (z: number) => (zoom.value = Math.min(3, Math.max(0.5, Math.round(z * 100) / 100)))

// ---------- pages on screen ----------
const scrollEl = ref<HTMLElement>()
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
const pageRect = (n: number) => pageEls().find((el) => Number(el.dataset.page) === n)?.getBoundingClientRect()
/** The page most in view — a click on a drawing puts it there. */
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

// ---------- placing ----------
async function sizeOf(url: string): Promise<{ w: number; h: number }> {
  const img = new Image()
  img.src = url
  await img.decode()
  return { w: img.naturalWidth, h: img.naturalHeight }
}
/** The centre stays on the page. */
const clampX = (x: number, w: number, pw: number) => Math.max(-w / 2, Math.min(pw - w / 2, x))
async function place(url: string, page: number, cx?: number, cy?: number): Promise<void> {
  const pg = pages.value[page - 1]
  if (!pg) return
  const s = await sizeOf(url)
  const w = Math.min(170, pg.w * 0.4)
  const h = (w * s.h) / s.w
  const x = Math.max(0, Math.min(pg.w - w, (cx ?? pg.w / 2) - w / 2))
  const y = Math.max(0, Math.min(pg.h - h, (cy ?? pg.h * 0.75) - h / 2))
  const id = crypto.randomUUID()
  items.value = [...items.value, { id, page, x, y, w, h, url, rot: 0, opacity: 1 }]
  selected.value = id
}
/** A click on a drawing: the middle of what is seen of the page most in view. */
function addToPage(url: string): void {
  const n = visiblePage()
  const r = pageRect(n)
  const box = scrollEl.value?.getBoundingClientRect()
  if (!r || !box) return void place(url, n)
  const top = Math.max(r.top, box.top)
  const bottom = Math.min(r.bottom, box.bottom)
  void place(url, n, undefined, ((top + bottom) / 2 - r.top) / zoom.value)
}
function onDragStart(e: DragEvent, url: string): void {
  e.dataTransfer?.setData('text/x-sig', url)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}
const readUrl = (f: File) =>
  new Promise<string>((res) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.readAsDataURL(f)
  })
/** A drawing from the panel → there; a PDF file → open it; a picture file → put it there. */
async function onDrop(e: DragEvent): Promise<void> {
  const at = pageAt(e.clientX, e.clientY)
  const pos = at && ([at.page, (e.clientX - at.r.left) / zoom.value, (e.clientY - at.r.top) / zoom.value] as const)
  const url = e.dataTransfer?.getData('text/x-sig')
  if (url) {
    if (pos) void place(url, ...pos)
    return
  }
  const f = e.dataTransfer?.files?.[0]
  if (!f) return
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) return void openFile(f)
  if (/^image\/(png|jpeg|webp)$/.test(f.type) && pos) {
    // pdf-lib takes PNG: a JPEG / WebP goes through a canvas
    const src = await readUrl(f)
    const png = f.type === 'image/png' ? src : await toPng(src)
    void place(png, ...pos)
  }
}
async function toPng(src: string): Promise<string> {
  const i = new Image()
  i.src = src
  await i.decode()
  const c = document.createElement('canvas')
  c.width = i.naturalWidth
  c.height = i.naturalHeight
  c.getContext('2d')!.drawImage(i, 0, 0)
  return c.toDataURL('image/png')
}

const update = (id: string, patch: Partial<Placed>) => (items.value = items.value.map((x) => (x.id === id ? { ...x, ...patch } : x)))
const sel = computed(() => items.value.find((x) => x.id === selected.value))

/** Moving: follows the pointer from page to page. */
function startMove(e: PointerEvent, it: Placed): void {
  selected.value = it.id
  const r0 = pageRect(it.page)
  if (!r0) return
  const gx = (e.clientX - r0.left) / zoom.value - it.x
  const gy = (e.clientY - r0.top) / zoom.value - it.y
  const move = (ev: PointerEvent) => {
    const hit = pageAt(ev.clientX, ev.clientY)
    if (!hit) return
    const pg = pages.value[hit.page - 1]
    const cur = items.value.find((x) => x.id === it.id)
    if (!cur) return
    update(it.id, {
      page: hit.page,
      x: clampX((ev.clientX - hit.r.left) / zoom.value - gx, cur.w, pg.w),
      y: clampX((ev.clientY - hit.r.top) / zoom.value - gy, cur.h, pg.h),
    })
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true })
}
/** Resizing from a corner (sx, sy = ±1), keeping the proportions; the opposite corner stays put. */
function startSize(e: PointerEvent, it: Placed, sx: number, sy: number): void {
  selected.value = it.id
  const x0 = e.clientX
  const y0 = e.clientY
  const s = { ...it }
  const a = (s.rot * Math.PI) / 180
  const ratio = s.h / s.w
  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - x0) / zoom.value
    const dy = (ev.clientY - y0) / zoom.value
    // the pointer's shift in the drawing's own (turned) frame
    const lx = dx * Math.cos(a) + dy * Math.sin(a)
    const ly = -dx * Math.sin(a) + dy * Math.cos(a)
    const w = Math.max(20, s.w + Math.max(sx * lx, (sy * ly) / ratio))
    const h = w * ratio
    // the centre moves by half the growth toward the dragged corner
    const ox = (sx * (w - s.w)) / 2
    const oy = (sy * (h - s.h)) / 2
    const cx = s.x + s.w / 2 + ox * Math.cos(a) - oy * Math.sin(a)
    const cy = s.y + s.h / 2 + ox * Math.sin(a) + oy * Math.cos(a)
    update(it.id, { w, h, x: cx - w / 2, y: cy - h / 2 })
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true })
}
/** Turning around the centre (Shift — by 15°; close to straight snaps straight). */
function startRotate(e: PointerEvent, it: Placed): void {
  selected.value = it.id
  const r = pageRect(it.page)
  if (!r) return
  const cx = r.left + (it.x + it.w / 2) * zoom.value
  const cy = r.top + (it.y + it.h / 2) * zoom.value
  const a0 = Math.atan2(e.clientY - cy, e.clientX - cx)
  const rot0 = it.rot
  const move = (ev: PointerEvent) => {
    let d = rot0 + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI
    d = ((d % 360) + 540) % 360 - 180
    if (ev.shiftKey) d = Math.round(d / 15) * 15
    else if (Math.abs(d) < 3) d = 0
    update(it.id, { rot: Math.round(d * 10) / 10 })
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true })
}
const removeItem = (id: string) => {
  items.value = items.value.filter((x) => x.id !== id)
  if (selected.value === id) selected.value = undefined
}
function duplicate(it: Placed): void {
  const pg = pages.value[it.page - 1]
  const id = crypto.randomUUID()
  items.value = [...items.value, { ...it, id, x: clampX(it.x + 14, it.w, pg.w), y: clampX(it.y + 14, it.h, pg.h) }]
  selected.value = id
}
function setOpacity(v: number): void {
  if (!sel.value || !Number.isFinite(v)) return
  update(sel.value.id, { opacity: Math.min(100, Math.max(5, Math.round(v))) / 100 })
}

// ---------- colour: the drawing's shape repainted ----------
const tints = ref<Record<string, string>>({})
const tintKey = (url: string, c: string) => `${c}|${url.length}|${url.slice(-48)}`
async function tinted(url: string, c: string): Promise<string> {
  const k = tintKey(url, c)
  if (tints.value[k]) return tints.value[k]
  const i = new Image()
  i.src = url
  await i.decode()
  const cv = document.createElement('canvas')
  cv.width = i.naturalWidth
  cv.height = i.naturalHeight
  const g = cv.getContext('2d')!
  g.drawImage(i, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = c
  g.fillRect(0, 0, cv.width, cv.height)
  const out = cv.toDataURL('image/png')
  tints.value = { ...tints.value, [k]: out }
  return out
}
const shown = (it: Placed) => (it.tint ? (tints.value[tintKey(it.url, it.tint)] ?? it.url) : it.url)
function setTint(c: string | undefined): void {
  if (!sel.value) return
  update(sel.value.id, { tint: c })
  if (c) void tinted(sel.value.url, c)
}
const TINTS = ['#111827', '#1d3fa8', '#b91c1c']

/** Where the toolbar sits: above the turned drawing's bounds, centred. */
function barStyle(it: Placed): Record<string, string> {
  const a = (it.rot * Math.PI) / 180
  const bh = Math.abs(it.w * Math.sin(a)) + Math.abs(it.h * Math.cos(a))
  const top = (it.y + it.h / 2 - bh / 2) * zoom.value
  return { left: `${(it.x + it.w / 2) * zoom.value}px`, top: `${top - 46}px` }
}

function onKey(e: KeyboardEvent): void {
  const t = e.target
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || padOpen.value) return
  const it = sel.value
  if (!it) return
  if (e.key === 'Delete' || e.key === 'Backspace') removeItem(it.id)
  else if (e.key === 'Escape') selected.value = undefined
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault()
    const step = e.shiftKey ? 10 : 1
    const pg = pages.value[it.page - 1]
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
    update(it.id, { x: clampX(it.x + dx, it.w, pg.w), y: clampX(it.y + dy, it.h, pg.h) })
  } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
    e.preventDefault()
    duplicate(it)
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  void doc.value?.destroy()
})

// ---------- saving ----------
async function save(): Promise<void> {
  if (!original) return
  busy.value = 'Сохраняю…'
  try {
    const pdf = await PDFDocument.load(original)
    const embedded = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>()
    for (const it of items.value) {
      const page = pdf.getPage(it.page - 1)
      const view = pages.value[it.page - 1].view
      const src = it.tint ? await tinted(it.url, it.tint) : it.url
      let png = embedded.get(src)
      if (!png) embedded.set(src, (png = await pdf.embedPng(src)))
      // pdf.js measures from the crop box's top-left (y down), PDF draws from its bottom-left (y up) and
      // turns an image around its bottom-left corner, counter-clockwise: place that corner so the centre stays
      const a = (-it.rot * Math.PI) / 180
      const cx = view[0] + it.x + it.w / 2
      const cy = view[3] - it.y - it.h / 2
      page.drawImage(png, {
        x: cx - (it.w / 2) * Math.cos(a) + (it.h / 2) * Math.sin(a),
        y: cy - (it.w / 2) * Math.sin(a) - (it.h / 2) * Math.cos(a),
        width: it.w,
        height: it.h,
        rotate: degrees(-it.rot),
        opacity: it.opacity,
      })
    }
    const bytes = await pdf.save()
    const name = fileName.value.replace(/\.pdf$/i, '') + ' (подписан).pdf'
    const where = await window.qa.pdfSave(bytes, name)
    if (where) busy.value = 'Сохранено'
    setTimeout(() => (busy.value = ''), 1600)
  } catch (e) {
    busy.value = ''
    alert(`Не удалось сохранить: ${e instanceof Error ? e.message : String(e)}`)
  }
}
const pageItems = (n: number) => items.value.filter((x) => x.page === n)
const hasDoc = computed(() => !!pages.value.length)
const CORNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const
</script>

<template>
  <div class="ps">
    <aside class="side">
      <div class="sh">
        <b>Подписи</b>
        <button class="ib" title="Создать подпись" @click="padOpen = true"><Icon name="plus" :size="14" /></button>
      </div>
      <div class="sigs">
        <div v-for="s in sigs" :key="s.id" class="sig" draggable="true" :title="hasDoc ? 'Клик — на страницу, или перетащите' : 'Откройте PDF'" @dragstart="onDragStart($event, s.url)" @click="hasDoc && addToPage(s.url)">
          <img :src="s.url" alt="" />
          <button class="sx" title="Удалить" @click.stop="dropSig(s.id)"><Icon name="x" :size="11" /></button>
        </div>
        <button v-if="!sigs.length" class="sadd" @click="padOpen = true"><Icon name="signature" :size="16" />Создать подпись</button>
      </div>
    </aside>

    <section class="main">
      <div class="bar">
        <button class="btn" @click="fileIn?.click()"><Icon name="upload" :size="13" />Открыть PDF</button>
        <input ref="fileIn" type="file" accept="application/pdf,.pdf" hidden @change="openFile(($event.target as HTMLInputElement).files?.[0])" />
        <span class="fn" :title="fileName">{{ fileName }}</span>
        <span class="sp"></span>
        <span v-if="busy" class="busy">{{ busy }}</span>
        <template v-if="hasDoc">
          <ZoomChip :model-value="zoom * 100" :min="25" :max="400" @update:model-value="(v) => setZoom(v / 100)" />
          <button class="btn pri" :disabled="!items.length" @click="save"><Icon name="download" :size="13" />Сохранить PDF</button>
        </template>
      </div>
      <div ref="scrollEl" class="pages" @pointerdown.self="selected = undefined" @dragover.prevent @drop.prevent="onDrop">
        <div v-if="!hasDoc" class="empty">
          <Icon name="signature" :size="34" />
          <p>Откройте или перетащите сюда PDF, создайте подпись слева и поставьте её на страницу</p>
          <button class="btn pri" @click="fileIn?.click()"><Icon name="upload" :size="13" />Открыть PDF</button>
        </div>
        <div
          v-for="(p, i) in pages"
          :key="i"
          class="pg"
          :data-page="i + 1"
          :style="{ width: `${p.w * zoom}px`, height: `${p.h * zoom}px` }"
          @pointerdown.self="selected = undefined"
        >
          <canvas :ref="setCanvas(i + 1)" :style="{ width: `${p.w * zoom}px`, height: `${p.h * zoom}px` }" @pointerdown="selected = undefined"></canvas>
          <div
            v-for="it in pageItems(i + 1)"
            :key="it.id"
            class="it"
            :class="{ on: selected === it.id }"
            :style="{ left: `${it.x * zoom}px`, top: `${it.y * zoom}px`, width: `${it.w * zoom}px`, height: `${it.h * zoom}px`, transform: `rotate(${it.rot}deg)` }"
            @pointerdown.stop.prevent="startMove($event, it)"
          >
            <img :src="shown(it)" alt="" draggable="false" :style="{ opacity: it.opacity }" />
            <template v-if="selected === it.id">
              <span
                v-for="[sx, sy] in CORNERS"
                :key="`${sx}${sy}`"
                class="hd"
                :class="[sx < 0 ? 'l' : 'r', sy < 0 ? 't' : 'b']"
                @pointerdown.stop.prevent="startSize($event, it, sx, sy)"
              ></span>
              <button class="rot" title="Повернуть (Shift — по 15°), двойной клик — ровно" @pointerdown.stop.prevent="startRotate($event, it)" @dblclick="update(it.id, { rot: 0 })">
                <Icon name="rotate" :size="13" />
              </button>
            </template>
          </div>
          <!-- the selected drawing's toolbar: colour, transparency, copy, remove -->
          <div v-if="sel && sel.page === i + 1" class="tb" :style="barStyle(sel)" @pointerdown.stop>
            <span class="tcols">
              <button class="tc orig" :class="{ on: !sel.tint }" title="Исходный цвет" @click="setTint(undefined)"></button>
              <button v-for="c in TINTS" :key="c" class="tc" :class="{ on: sel.tint === c }" :style="{ background: c }" @click="setTint(c)"></button>
              <label class="tc pick" :class="{ on: !!sel.tint && !TINTS.includes(sel.tint) }" title="Свой цвет" :style="sel.tint && !TINTS.includes(sel.tint) ? { background: sel.tint } : undefined">
                <input type="color" :value="sel.tint ?? '#1d3fa8'" @input="setTint(($event.target as HTMLInputElement).value)" />
              </label>
            </span>
            <span class="sep"></span>
            <span class="op" title="Непрозрачность, %">
              <Icon name="opacity" :size="14" />
              <input type="number" min="5" max="100" step="5" :value="Math.round(sel.opacity * 100)" @input="setOpacity(Number(($event.target as HTMLInputElement).value))" />
            </span>
            <span class="sep"></span>
            <button class="tbb" title="Копия (Ctrl+D)" @click="duplicate(sel)"><Icon name="copy" :size="14" /></button>
            <button class="tbb" title="Убрать (Delete)" @click="removeItem(sel.id)"><Icon name="trash" :size="14" /></button>
          </div>
          <span class="pn">{{ i + 1 }} / {{ pages.length }}</span>
        </div>
      </div>
    </section>
    <SignaturePad v-if="padOpen" @save="saveSig" @close="padOpen = false" />
  </div>
</template>

<style scoped>
.ps {
  display: flex;
  height: 100%;
  min-height: 0;
}
.side {
  flex: none;
  width: 220px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}
.sh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.sigs {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}
.sig {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80px;
  padding: 6px;
  border-radius: 4px;
  background: var(--text-hi);
  cursor: grab;
  border: 2px solid transparent;
}
.sig:hover {
  border-color: var(--accent);
}
.sig img {
  max-width: 100%;
  max-height: 100%;
  pointer-events: none;
}
.sx {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  padding: 3px;
  border: 0;
  border-radius: var(--r2);
  background: rgba(0, 0, 0, 0.55);
  color: var(--text-hi);
}
.sig:hover .sx {
  display: inline-flex;
}
.sadd {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 8px;
  border: 1px dashed var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
}
.sadd:hover {
  color: var(--text);
  border-color: var(--accent);
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.sp {
  flex: 1;
}
.fn {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
  font-size: 12.5px;
}
.busy {
  color: var(--accent-fg);
  font-size: 12px;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}
.btn.pri {
  border-color: transparent;
  background: var(--accent);
  color: var(--on-accent);
}
.btn:disabled {
  opacity: 0.45;
}
.ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.ib:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.zoom {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11.5px;
  color: var(--accent-fg);
}
.zoom span {
  min-width: 40px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.zoom button {
  display: inline-flex;
  padding: 4px 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.zoom button:hover {
  color: var(--text);
}
.pages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 58px 18px 18px;
  background: var(--bg);
}
.empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--muted);
  font-size: 13px;
}
.pg {
  position: relative;
  flex: none;
  background: var(--text-hi);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
}
.pg canvas {
  display: block;
}
.pn {
  position: absolute;
  right: 8px;
  bottom: -18px;
  color: var(--dim);
  font-size: 11px;
}
/* a drawing on the page */
.it {
  position: absolute;
  cursor: move;
  outline: 1px dashed transparent;
  transform-origin: 50% 50%;
}
.it:hover {
  outline-color: rgb(var(--accent-rgb) / 0.6);
}
.it.on {
  z-index: 2;
  outline: 1px solid var(--accent);
}
.it img {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
  user-select: none;
}
.hd {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--text-hi);
}
.hd.l {
  left: -5px;
}
.hd.r {
  right: -5px;
}
.hd.t {
  top: -5px;
}
.hd.b {
  bottom: -5px;
}
.hd.l.t,
.hd.r.b {
  cursor: nwse-resize;
}
.hd.r.t,
.hd.l.b {
  cursor: nesw-resize;
}
.rot {
  position: absolute;
  top: 50%;
  right: -38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-top: -13px;
  padding: 0;
  border: 1.5px solid var(--accent);
  border-radius: 50%;
  background: var(--text-hi);
  color: var(--accent);
  cursor: grab;
}
/* the toolbar over the selected drawing */
.tb {
  position: absolute;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 8px;
  transform: translateX(-50%);
  border: 1px solid rgb(var(--accent-rgb) / 0.55);
  border-radius: 4px;
  background: var(--text-hi);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  color: var(--panel-3);
  white-space: nowrap;
}
.tcols {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.tc {
  position: relative;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}
.tc.on {
  border-color: var(--accent);
}
.tc.orig {
  background: linear-gradient(135deg, var(--text-hi) 45%, var(--down) 45%, var(--down) 55%, var(--text-hi) 55%);
}
.tc.pick {
  overflow: hidden;
  background: conic-gradient(var(--down), var(--warn), var(--warn), var(--up), #06b6d4, var(--info), var(--accent), #ec4899, var(--down));
  cursor: pointer;
}
.tc.pick input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.sep {
  width: 1px;
  height: 20px;
  background: var(--text);
}
.op {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--border-3);
}
.op input {
  width: 52px;
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--text-2);
  border-radius: var(--r2);
  background: var(--text-hi);
  color: var(--panel);
  font-size: 12.5px;
  text-align: center;
}
.tbb {
  display: inline-flex;
  padding: 5px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--border-3);
}
.tbb:hover {
  background: var(--text-hi);
  color: var(--panel);
}
</style>
