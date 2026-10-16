<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  apply,
  boardBox,
  eraseInk,
  fitView,
  hitsItem,
  inFrame,
  isDarkPaper,
  isLineKind,
  itemBox,
  itemId,
  parseBoard,
  PAPERS,
  rotateAbout,
  scaleAbout,
  serializeBoard,
  shapeD,
  SHAPES,
  transformItem,
  translate,
  type Affine,
  type Board,
  type BoardBg,
  type BoardItem,
  type Box,
  type GridKind,
  type InkItem,
  type ShapeItem,
  type ShapeKind,
  type TextItem,
} from '@shared/whiteboard'
import Icon from './Icon.vue'
import ZoomChip from './ZoomChip.vue'
import { drawGradientStroke, drawNibGradient, nibPath, strokePath, type InkStyle } from '../lib/ink'
import { paperTiles } from '../lib/paper'
import { penNow, useTablet, useTabletCanvas, useTabletLive } from '../lib/tablet'
import { placeFloat, useAnchor } from '../lib/floating'
import { historyOf } from '../lib/boardHistory'

/**
 * Доска: an endless sheet in the notebook (a .qboard file). Ink: pen (pressure from the tablet run by Qvarch /
 * a real pen), marker; the eraser cuts out only what it touches (or whole lines); typed text; the selection
 * (a frame or a click) — move, scale, turn, delete, copy; pan & zoom (Ctrl+wheel; Shift / Alt + wheel, the hand,
 * Space, the middle / right button — the pen's side button); the wheel alone sizes the current tool; the paper
 * and its grid; a minimap; undo / redo (kept per board while the app runs); clear; PNG export.
 * The visible area is the tablet's "Qvarch canvas".
 */
const props = defineProps<{ path: string; text: string }>()
const emit = defineEmits<{ change: [text: string]; info: [text: string] }>()

useTabletLive()
const { state: tablet } = useTablet()

// ---------- the board & its file; the history lives outside (kept when the board is left) ----------
const board = shallowRef<Board>(parseBoard(props.text))
let lastJson = props.text
const hist = historyOf(props.path)
/** The selected items' ids (the selection tool). */
const sel = shallowRef<Set<string>>(new Set())
const canUndo = ref(hist.undo.length > 0)
const canRedo = ref(hist.redo.length > 0)
watch(
  () => props.text,
  (t) => {
    if (t === lastJson) return
    // changed outside (another pane, another editor): take it, the history no longer applies
    lastJson = t
    board.value = parseBoard(t)
    hist.undo.length = 0
    hist.redo.length = 0
    sel.value = new Set()
    schedule()
  },
)
/** The theme's accent for the canvas (it follows the user's colour). */
const acc = (a = 1) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '255 107 0'} / ${a})`

function commit(next: Board, undoable = true): void {
  if (undoable) {
    hist.undo.push(board.value)
    if (hist.undo.length > 300) hist.undo.shift()
    hist.redo.length = 0
  }
  board.value = next
  lastJson = serializeBoard(next)
  emit('change', lastJson)
  schedule()
}
watch(
  board,
  () => {
    canUndo.value = hist.undo.length > 0
    canRedo.value = hist.redo.length > 0
    // a selection keeps only what still exists
    if (sel.value.size) {
      const ids = new Set(board.value.items.map((i) => i.id))
      const kept = [...sel.value].filter((id) => ids.has(id))
      if (kept.length !== sel.value.size) sel.value = new Set(kept)
    }
    const ink = board.value.items.filter((i) => i.type === 'ink').length
    const text = board.value.items.length - ink
    emit('info', `Штрихов: ${ink}${text ? ` · Текстов: ${text}` : ''}`)
  },
  { immediate: true },
)
function undo(): void {
  const prev = hist.undo.pop()
  if (!prev) return
  hist.redo.push(board.value)
  commit(prev, false)
}
function redo(): void {
  const next = hist.redo.pop()
  if (!next) return
  hist.undo.push(board.value)
  commit(next, false)
}
function clearAll(): void {
  if (!board.value.items.length) return
  if (!confirm('Очистить всю доску? Отменить можно через Ctrl+Z.')) return
  commit({ ...board.value, items: [] })
}

// ---------- tools ----------
type Tool = 'select' | 'pen' | 'nib' | 'marker' | 'eraser' | 'text' | 'shape' | 'hand'
const LS = 'qa.board.tools'
interface ToolPrefs {
  tool: Tool
  penColor: string
  penSize: number
  markerColor: string
  markerSize: number
  /** Screen px. */
  eraserSize: number
  /** The eraser takes whole lines (else — only what it touches). */
  eraseWhole: boolean
  textSize: number
  minimap: boolean
  /** 0.05…1 */
  penOpacity: number
  markerOpacity: number
  /** The pen's line goes from its colour (light pressure) to this one (firm). */
  gradient: boolean
  gradColor: string
  /** The eraser grows with the pen's pressure. */
  eraserPressure: boolean
  shapeKind: ShapeKind
  shapeWidth: number
  shapeFill: boolean
  shapeDash: boolean
  /** The ink pen's nib: its width and its angle (degrees; a tablet's tilt turns it). */
  nibSize: number
  nibAngle: number
}
function readTools(): ToolPrefs {
  const d: ToolPrefs = {
    tool: 'pen',
    penColor: '#111827',
    penSize: 3,
    markerColor: '#facc15',
    markerSize: 14,
    eraserSize: 12,
    eraseWhole: false,
    textSize: 18,
    minimap: true,
    penOpacity: 1,
    markerOpacity: 0.4,
    gradient: false,
    gradColor: '#dc2626',
    eraserPressure: false,
    shapeKind: 'rect',
    shapeWidth: 2,
    shapeFill: false,
    shapeDash: false,
    nibSize: 6,
    nibAngle: 40,
  }
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(LS) ?? '{}') as Partial<ToolPrefs>) }
  } catch {
    return d
  }
}
const tp = ref<ToolPrefs>(readTools())
watch(
  tp,
  (v) => {
    try {
      localStorage.setItem(LS, JSON.stringify(v))
    } catch {
      // private mode — fine
    }
    schedule()
  },
  { deep: true },
)
const dark = computed(() => isDarkPaper(board.value.bg.color))
const INKS = computed(() => (dark.value ? ['#f3f4f6', '#93c5fd', '#fca5a5', '#86efac', '#fdba74', '#c4b5fd'] : ['#111827', '#2563eb', '#dc2626', '#16a34a', '#ea580c', '#7c3aed']))
const MARKERS = ['#facc15', '#4ade80', '#38bdf8', '#f472b6', '#fb923c']
/** The size presets and limits of each tool (the wheel goes between the limits). */
const SIZES: Record<'pen' | 'nib' | 'marker' | 'eraser' | 'text' | 'shape', { presets: number[]; min: number; max: number; key: 'penSize' | 'nibSize' | 'markerSize' | 'eraserSize' | 'textSize' | 'shapeWidth' }> = {
  pen: { presets: [3, 8], min: 0.5, max: 80, key: 'penSize' },
  nib: { presets: [4, 10], min: 1, max: 60, key: 'nibSize' },
  marker: { presets: [14, 28], min: 4, max: 160, key: 'markerSize' },
  eraser: { presets: [12, 40], min: 4, max: 240, key: 'eraserSize' },
  text: { presets: [18, 32], min: 8, max: 200, key: 'textSize' },
  shape: { presets: [2, 4], min: 0.5, max: 40, key: 'shapeWidth' },
}
const sized = computed(() => (tp.value.tool === 'hand' || tp.value.tool === 'select' ? undefined : SIZES[tp.value.tool]))
const size = computed(() => (sized.value ? tp.value[sized.value.key] : 0))
function setSize(s: number): void {
  const z = sized.value
  if (!z) return
  tp.value[z.key] = Math.round(Math.min(z.max, Math.max(z.min, s)) * 10) / 10
}
const usesColor = computed(() => tp.value.tool === 'pen' || tp.value.tool === 'nib' || tp.value.tool === 'marker' || tp.value.tool === 'text' || tp.value.tool === 'shape')
const palette = computed(() => (tp.value.tool === 'marker' ? MARKERS : INKS.value))
const color = computed(() => (tp.value.tool === 'marker' ? tp.value.markerColor : tp.value.penColor))
function setColor(c: string): void {
  if (tp.value.tool === 'marker') tp.value.markerColor = c
  else tp.value.penColor = c
  if (editing.value) editing.value.color = c
}
/** The nib's angle now: the tablet pen's tilt turns it, else the set one. */
function nibAngleNow(): number {
  const p = penNow()
  if (p && (p.tiltX || p.tiltY)) return Math.round(((Math.atan2(p.tiltY, p.tiltX) * 180) / Math.PI + 90 + 360) % 180)
  return tp.value.nibAngle
}
function inkStyle(): InkStyle & { opacity: number; marker: boolean; gradient?: string; nib?: number } {
  const p = tablet.value?.prefs
  const marker = tp.value.tool === 'marker'
  if (tp.value.tool === 'nib')
    return { color: color.value, size: size.value, streamline: p?.streamline ?? 0.55, smoothing: p?.smoothing ?? 0.6, thinning: 0, opacity: tp.value.penOpacity, marker: false, nib: nibAngleNow(), gradient: tp.value.gradient ? tp.value.gradColor : undefined }
  return {
    color: color.value,
    size: size.value,
    streamline: p?.streamline ?? 0.55,
    smoothing: p?.smoothing ?? 0.6,
    thinning: marker ? 0 : (p?.thinning ?? 0.55),
    opacity: marker ? tp.value.markerOpacity : tp.value.penOpacity,
    marker,
    gradient: !marker && tp.value.gradient ? tp.value.gradColor : undefined,
  }
}

// ---------- the view ----------
const wrap = ref<HTMLElement>()
const cv = ref<HTMLCanvasElement>()
const lv = ref<HTMLCanvasElement>()
const mm = ref<HTMLCanvasElement>()
const W = ref(1)
const H = ref(1)
const canvasTarget = useTabletCanvas(wrap)
const viewKey = () => `qa.board.view:${props.path}`
type View = { x: number; y: number; z: number }
const view = ref<View>()
function readView(): View | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(viewKey()) ?? 'null') as View | null
    return v && [v.x, v.y, v.z].every(Number.isFinite) ? v : undefined
  } catch {
    return undefined
  }
}
let viewTimer: ReturnType<typeof setTimeout> | undefined
watch(view, (v) => {
  clearTimeout(viewTimer)
  viewTimer = setTimeout(() => {
    try {
      if (v) localStorage.setItem(viewKey(), JSON.stringify(v))
    } catch {
      // fine
    }
  }, 400)
  schedule()
})
const zoomPct = computed(() => Math.round((view.value?.z ?? 1) * 100))
const toWorld = (sx: number, sy: number) => {
  const v = view.value!
  return [v.x + sx / v.z, v.y + sy / v.z] as const
}
const toScreen = (wx: number, wy: number) => {
  const v = view.value!
  return [(wx - v.x) * v.z, (wy - v.y) * v.z] as const
}
function zoomAt(f: number, sx = W.value / 2, sy = H.value / 2): void {
  const v = view.value
  if (!v) return
  const z = Math.min(8, Math.max(0.1, v.z * f))
  const [wx, wy] = toWorld(sx, sy)
  view.value = { x: wx - sx / z, y: wy - sy / z, z }
}
function fit(): void {
  const box = boardBox(board.value.items)
  view.value = box ? fitView(box, W.value, H.value) : { x: -W.value / 2, y: -H.value / 2, z: 1 }
}

// ---------- text: measuring ----------
const FONT = `Inter, "Segoe UI", system-ui, sans-serif`
const LINE = 1.25
let measureCtx: CanvasRenderingContext2D | null = null
function measure(text: string, size: number): { w: number; h: number } {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  const g = measureCtx!
  g.font = `${size}px ${FONT}`
  const lines = text.split('\n')
  const w = Math.max(size * 0.5, ...lines.map((l) => g.measureText(l).width))
  return { w: Math.ceil(w), h: Math.ceil(lines.length * size * LINE) }
}

// ---------- drawing ----------
const paths = new WeakMap<InkItem, Path2D>()
const pathOf = (i: InkItem): Path2D => {
  let p = paths.get(i)
  if (!p) {
    const pts: number[][] = []
    for (let k = 0; k < i.pts.length; k += 3) pts.push([i.pts[k], i.pts[k + 1], i.pts[k + 2]])
    p = i.nib !== undefined ? nibPath(pts, i, i.nib, true) : strokePath(pts, i, i.pen, true)
    paths.set(i, p)
  }
  return p
}

// ---------- textured paper ----------
const toothPats = new Map<string, CanvasPattern>()
function toothOf(g: CanvasRenderingContext2D, color: string): CanvasPattern | undefined {
  let p = toothPats.get(color)
  if (!p) {
    p = g.createPattern(paperTiles(color).tooth, 'repeat') ?? undefined
    if (p) toothPats.set(color, p)
  }
  return p
}
const tonePats = new Map<string, CanvasPattern>()
function toneOf(g: CanvasRenderingContext2D, color: string): CanvasPattern | undefined {
  let p = tonePats.get(color)
  if (!p) {
    p = g.createPattern(paperTiles(color).tone, 'repeat') ?? undefined
    if (p) tonePats.set(color, p)
  }
  return p
}
/** The ink layer on textured paper (the paper's tooth is cut out of it before it is laid down). */
let layerCv: HTMLCanvasElement | undefined
function layerFor(g: CanvasRenderingContext2D): CanvasRenderingContext2D {
  layerCv ??= document.createElement('canvas')
  if (layerCv.width !== g.canvas.width || layerCv.height !== g.canvas.height) {
    layerCv.width = g.canvas.width
    layerCv.height = g.canvas.height
  }
  const lg = layerCv.getContext('2d')!
  lg.setTransform(1, 0, 0, 1, 0, 0)
  lg.clearRect(0, 0, layerCv.width, layerCv.height)
  lg.setTransform(g.getTransform())
  return lg
}
/** How much ink the tooth takes away (a light grain). */
const TOOTH = 0.22
let raf = 0
function schedule(): void {
  if (!raf) raf = requestAnimationFrame(render)
}
/** Only the live layer (the stroke being drawn) — the board under it stays as it is. */
let liveRaf = 0
function scheduleLive(): void {
  if (raf || liveRaf) return
  liveRaf = requestAnimationFrame(() => {
    liveRaf = 0
    paintLive()
  })
}
/** The items while something is being done to them (the eraser, a move…) — committed on release. */
let preview: BoardItem[] | undefined
const shown = () => preview ?? board.value.items

function drawGrid(g: CanvasRenderingContext2D, bg: BoardBg, v: View, w: number, h: number): void {
  if (bg.grid === 'none' || bg.opacity <= 0) return
  let step = bg.step
  // too dense when zoomed out: coarser
  while (step * v.z < 9) step *= bg.major > 1 ? bg.major : 2
  const base = isDarkPaper(bg.color) ? '255,255,255' : '30,41,59'
  const minor = `rgba(${base},${0.22 * bg.opacity})`
  const major = `rgba(${base},${0.45 * bg.opacity})`
  const isMajor = (n: number) => bg.major > 1 && step === bg.step && Math.round(n) % bg.major === 0
  const i0 = Math.floor(v.x / step)
  const i1 = Math.ceil((v.x + w / v.z) / step)
  const j0 = Math.floor(v.y / step)
  const j1 = Math.ceil((v.y + h / v.z) / step)
  const sx = (i: number) => Math.round((i * step - v.x) * v.z) + 0.5
  const sy = (j: number) => Math.round((j * step - v.y) * v.z) + 0.5
  g.lineWidth = 1
  if (bg.grid === 'dots') {
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const m = isMajor(i) && isMajor(j)
        g.fillStyle = m ? major : minor
        g.beginPath()
        g.arc(sx(i) - 0.5, sy(j) - 0.5, m ? 1.7 : 1.15, 0, Math.PI * 2)
        g.fill()
      }
    return
  }
  if (bg.grid === 'iso') {
    // three families: vertical and ±30° — a triangular grid for isometric sketches
    g.strokeStyle = minor
    const dirs = [
      [0, 1],
      [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)],
      [Math.cos((5 * Math.PI) / 6), Math.sin((5 * Math.PI) / 6)],
    ]
    const corners = [
      [v.x, v.y],
      [v.x + w / v.z, v.y],
      [v.x, v.y + h / v.z],
      [v.x + w / v.z, v.y + h / v.z],
    ]
    const len = (w + h) / v.z
    const cx = v.x + w / v.z / 2
    const cy = v.y + h / v.z / 2
    g.beginPath()
    for (const [dx, dy] of dirs) {
      const nx = -dy
      const ny = dx
      const ds = corners.map(([x, y]) => x * nx + y * ny)
      const k0 = Math.floor(Math.min(...ds) / step)
      const k1 = Math.ceil(Math.max(...ds) / step)
      for (let k = k0; k <= k1; k++) {
        const px = nx * k * step
        const py = ny * k * step
        const t = (cx - px) * dx + (cy - py) * dy
        g.moveTo((px + dx * (t - len) - v.x) * v.z, (py + dy * (t - len) - v.y) * v.z)
        g.lineTo((px + dx * (t + len) - v.x) * v.z, (py + dy * (t + len) - v.y) * v.z)
      }
    }
    g.stroke()
    return
  }
  for (const m of [false, true]) {
    g.strokeStyle = m ? major : minor
    g.beginPath()
    if (bg.grid === 'squares')
      for (let i = i0; i <= i1; i++) {
        if (isMajor(i) !== m) continue
        g.moveTo(sx(i), 0)
        g.lineTo(sx(i), h)
      }
    for (let j = j0; j <= j1; j++) {
      if (isMajor(j) !== m) continue
      g.moveTo(0, sy(j))
      g.lineTo(w, sy(j))
    }
    g.stroke()
  }
}

function drawItems(g: CanvasRenderingContext2D, items: BoardItem[], v: View, w: number, h: number, hideId?: string, paper?: string): void {
  const vx1 = v.x + w / v.z
  const vy1 = v.y + h / v.z
  const tooth = paper ? toothOf(g, paper) : undefined
  // the ink drawn since the last text / shape: laid down (with the tooth cut out) before the next one
  let lg: CanvasRenderingContext2D | undefined
  const flush = () => {
    if (!lg || !tooth) return
    lg.save()
    lg.globalCompositeOperation = 'destination-out'
    lg.globalAlpha = TOOTH
    lg.fillStyle = tooth
    lg.fillRect(v.x, v.y, w / v.z, h / v.z)
    lg.restore()
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.drawImage(lg.canvas, 0, 0)
    g.restore()
    lg = undefined
  }
  for (const i of items) {
    if (i.id === hideId) continue
    const bx = itemBox(i)
    if (bx.x1 < v.x || bx.x0 > vx1 || bx.y1 < v.y || bx.y0 > vy1) continue
    if (i.type !== 'ink') flush()
    if (i.type === 'text') {
      g.save()
      g.globalAlpha = 1
      g.fillStyle = i.color
      g.font = `${i.size}px ${FONT}`
      g.textBaseline = 'top'
      g.translate(i.x, i.y)
      if (i.rot) g.rotate((i.rot * Math.PI) / 180)
      i.text.split('\n').forEach((l, n) => g.fillText(l, 0, n * i.size * LINE + i.size * 0.1))
      g.restore()
      continue
    }
    if (i.type === 'shape') {
      drawShape(g, i)
      continue
    }
    let t = g
    if (tooth && !i.marker) {
      lg ??= layerFor(g)
      t = lg
    }
    t.globalAlpha = i.opacity
    if (i.gradient) {
      if (i.nib !== undefined) drawNibGradient(t, inkPoints(i), i, i.nib, i.gradient, true)
      else drawGradientStroke(t, inkPoints(i), i, i.gradient, true)
    } else {
      t.fillStyle = i.color
      t.fill(pathOf(i))
    }
    t.globalAlpha = 1
  }
  flush()
  g.globalAlpha = 1
}
const inkPoints = (i: InkItem): number[][] => {
  const pts: number[][] = []
  for (let k = 0; k < i.pts.length; k += 3) pts.push([i.pts[k], i.pts[k + 1], i.pts[k + 2]])
  return pts
}
function drawShape(g: CanvasRenderingContext2D, i: ShapeItem): void {
  g.save()
  if (isLineKind(i.kind)) g.translate(i.x, i.y)
  else {
    g.translate(i.x + i.w / 2, i.y + i.h / 2)
    if (i.rot) g.rotate((i.rot * Math.PI) / 180)
    g.translate(-i.w / 2, -i.h / 2)
  }
  const s = shapeD(i.kind, i.w, i.h, i.width)
  g.globalAlpha = 1
  g.lineWidth = i.width
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.strokeStyle = i.color
  if (i.dash) g.setLineDash([i.width * 4, i.width * 3])
  const body = new Path2D(s.d)
  if (i.fill && s.fillable) {
    g.fillStyle = i.fill
    g.fill(body)
  }
  g.stroke(body)
  if (s.extra) g.stroke(new Path2D(s.extra))
  g.setLineDash([])
  if (s.head) g.stroke(new Path2D(s.head))
  g.restore()
}

function paintBoard(g: CanvasRenderingContext2D, b: Board, items: BoardItem[], v: View, w: number, h: number, k: number, hideId?: string): void {
  g.setTransform(k, 0, 0, k, 0, 0)
  g.fillStyle = b.bg.color
  g.fillRect(0, 0, w, h)
  const paper = b.bg.texture === 'paper'
  if (paper) {
    // the paper's tone, in world units (it zooms with the board)
    g.setTransform(k * v.z, 0, 0, k * v.z, -v.x * v.z * k, -v.y * v.z * k)
    const tone = toneOf(g, b.bg.color)
    if (tone) {
      g.fillStyle = tone
      g.fillRect(v.x, v.y, w / v.z, h / v.z)
    }
    g.setTransform(k, 0, 0, k, 0, 0)
  }
  drawGrid(g, b.bg, v, w, h)
  g.setTransform(k * v.z, 0, 0, k * v.z, -v.x * v.z * k, -v.y * v.z * k)
  drawItems(g, items, v, w, h, hideId, paper ? b.bg.color : undefined)
}

function render(): void {
  raf = 0
  const c = cv.value
  const v = view.value
  if (!c || !v) return
  paintBoard(c.getContext('2d')!, board.value, shown(), v, W.value, H.value, devicePixelRatio, editing.value?.id)
  paintLive()
  paintMinimap()
}

// ---------- the minimap ----------
const MM_W = 200
const MM_H = 130
/** The minimap's world box and scale (to turn a click into a place). */
let mmMap: { x: number; y: number; k: number } | undefined
function paintMinimap(): void {
  const c = mm.value
  const v = view.value
  if (!c || !v || !tp.value.minimap) return
  const vb: Box = { x0: v.x, y0: v.y, x1: v.x + W.value / v.z, y1: v.y + H.value / v.z }
  const cb = boardBox(shown())
  const box = cb ? { x0: Math.min(cb.x0, vb.x0), y0: Math.min(cb.y0, vb.y0), x1: Math.max(cb.x1, vb.x1), y1: Math.max(cb.y1, vb.y1) } : vb
  const pad = 8
  const k = Math.min((MM_W - pad * 2) / Math.max(1, box.x1 - box.x0), (MM_H - pad * 2) / Math.max(1, box.y1 - box.y0))
  const ox = (MM_W - (box.x1 - box.x0) * k) / 2 - box.x0 * k
  const oy = (MM_H - (box.y1 - box.y0) * k) / 2 - box.y0 * k
  mmMap = { x: ox, y: oy, k }
  const d = devicePixelRatio
  const g = c.getContext('2d')!
  g.setTransform(d, 0, 0, d, 0, 0)
  g.fillStyle = board.value.bg.color
  g.fillRect(0, 0, MM_W, MM_H)
  g.setTransform(d * k, 0, 0, d * k, d * ox, d * oy)
  drawItems(g, shown(), { x: box.x0, y: box.y0, z: 1 }, box.x1 - box.x0, box.y1 - box.y0)
  g.setTransform(d, 0, 0, d, 0, 0)
  g.strokeStyle = acc()
  g.lineWidth = 1.5
  g.fillStyle = acc(.12)
  const rx = vb.x0 * k + ox
  const ry = vb.y0 * k + oy
  g.fillRect(rx, ry, (vb.x1 - vb.x0) * k, (vb.y1 - vb.y0) * k)
  g.strokeRect(rx, ry, (vb.x1 - vb.x0) * k, (vb.y1 - vb.y0) * k)
}
/** A press / drag on the minimap: the view's centre goes there. */
function mmGo(e: PointerEvent): void {
  if (!mmMap || !view.value) return
  if (e.type === 'pointerdown') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  else if (!(e.buttons & 1)) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const wx = (e.clientX - r.left - mmMap.x) / mmMap.k
  const wy = (e.clientY - r.top - mmMap.y) / mmMap.k
  const z = view.value.z
  view.value = { x: wx - W.value / 2 / z, y: wy - H.value / 2 / z, z }
}
watch(
  () => tp.value.minimap,
  async (on) => {
    if (!on) return
    await nextTick()
    const c = mm.value
    if (c) {
      c.width = MM_W * devicePixelRatio
      c.height = MM_H * devicePixelRatio
    }
    schedule()
  },
)

// ---------- the selection ----------
/** The selection's frame (world), from what is shown. */
function selBox(): Box | undefined {
  if (!sel.value.size) return undefined
  return boardBox(shown().filter((i) => sel.value.has(i.id)))
}
/** What is being done to the selection now (to draw its frame turned while turning). */
let selXf: Affine | undefined
let frameRect: Box | undefined
type Handle = 'tl' | 'tr' | 'bl' | 'br' | 'rot'
const ROT_OFF = 26
function handlesOf(b: Box): Array<{ h: Handle; x: number; y: number }> {
  const [x0, y0] = toScreen(b.x0, b.y0)
  const [x1, y1] = toScreen(b.x1, b.y1)
  return [
    { h: 'tl', x: x0, y: y0 },
    { h: 'tr', x: x1, y: y0 },
    { h: 'bl', x: x0, y: y1 },
    { h: 'br', x: x1, y: y1 },
    { h: 'rot', x: (x0 + x1) / 2, y: y0 - ROT_OFF },
  ]
}
function handleAt(sx: number, sy: number): Handle | undefined {
  const b = selBox()
  if (!b) return undefined
  return handlesOf(b).find((p) => Math.hypot(p.x - sx, p.y - sy) <= 8)?.h
}
const selCursor = ref('default')
function deleteSelected(): void {
  if (!sel.value.size) return
  const ids = sel.value
  sel.value = new Set()
  commit({ ...board.value, items: board.value.items.filter((i) => !ids.has(i.id)) })
}
/** Copied items (this app run). */
let clip: BoardItem[] = []
function copySelected(): void {
  clip = board.value.items.filter((i) => sel.value.has(i.id))
}
function pasteClip(dx = 24 / (view.value?.z ?? 1)): void {
  if (!clip.length) return
  const m = translate(dx, dx)
  const fresh = clip.map((i) => ({ ...transformItem(i, m), id: itemId() }))
  clip = fresh
  commit({ ...board.value, items: [...board.value.items, ...fresh] })
  sel.value = new Set(fresh.map((i) => i.id))
  if (tp.value.tool !== 'select') tp.value.tool = 'select'
}
function nudge(dx: number, dy: number): void {
  if (!sel.value.size) return
  const m = translate(dx, dy)
  commit({ ...board.value, items: board.value.items.map((i) => (sel.value.has(i.id) ? transformItem(i, m) : i)) })
}

// ---------- the live layer: the stroke being drawn, the tool's size circle, the selection ----------
let live: { pts: number[][]; style: ReturnType<typeof inkStyle>; pen: boolean } | undefined
/** Alt held while drawing: the line goes straight from this point. */
let altFrom: number | undefined
/** The shape being drawn (the shape tool). */
let drawing: ShapeItem | undefined
let hover: [number, number] | undefined
/** The size just changed by the wheel — shown for a moment. */
const sizeHint = ref('')
let hintTimer: ReturnType<typeof setTimeout> | undefined
function paintLive(): void {
  const c = lv.value
  const v = view.value
  if (!c || !v) return
  const g = c.getContext('2d')!
  const k = devicePixelRatio
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, c.width, c.height)
  if (live) {
    g.setTransform(k * v.z, 0, 0, k * v.z, -v.x * v.z * k, -v.y * v.z * k)
    g.globalAlpha = live.style.opacity
    if (live.style.nib !== undefined && live.style.gradient) drawNibGradient(g, live.pts, live.style, live.style.nib, live.style.gradient, false)
    else if (live.style.nib !== undefined) {
      g.fillStyle = live.style.color
      g.fill(nibPath(live.pts, live.style, live.style.nib, false))
    } else if (live.style.gradient) drawGradientStroke(g, live.pts, live.style, live.style.gradient, false)
    else {
      g.fillStyle = live.style.color
      g.fill(strokePath(live.pts, live.style, live.pen, false))
    }
    g.globalAlpha = 1
    // on textured paper the tooth shows in the live line too
    const tooth = board.value.bg.texture === 'paper' && !live.style.marker ? toothOf(g, board.value.bg.color) : undefined
    if (tooth) {
      // only over the stroke (not the whole view — every frame)
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const [x, y] of live.pts) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
      const pad = live.style.size * 1.5 + 2
      g.save()
      g.globalCompositeOperation = 'destination-out'
      g.globalAlpha = TOOTH
      g.fillStyle = tooth
      g.fillRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2)
      g.restore()
    }
  }
  if (drawing) {
    g.setTransform(k * v.z, 0, 0, k * v.z, -v.x * v.z * k, -v.y * v.z * k)
    drawShape(g, drawing)
  }
  g.setTransform(k, 0, 0, k, 0, 0)
  // the size circle at the pointer (pen / marker — the line's width on screen; eraser — its own size)
  const t = tp.value.tool
  if (hover && (t === 'eraser' || ((t === 'pen' || t === 'nib' || t === 'marker') && !live))) {
    const d = t === 'eraser' ? tp.value.eraserSize : Math.max(2, size.value * v.z)
    g.strokeStyle = dark.value ? 'rgba(255,255,255,.75)' : 'rgba(17,24,39,.6)'
    g.lineWidth = 1
    g.beginPath()
    g.arc(hover[0], hover[1], d / 2, 0, Math.PI * 2)
    g.stroke()
  }
  // the selection frame being dragged
  if (frameRect) {
    const [x0, y0] = toScreen(frameRect.x0, frameRect.y0)
    const [x1, y1] = toScreen(frameRect.x1, frameRect.y1)
    g.fillStyle = acc(.1)
    g.strokeStyle = acc()
    g.lineWidth = 1
    g.setLineDash([4, 3])
    g.fillRect(x0, y0, x1 - x0, y1 - y0)
    g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0)
    g.setLineDash([])
  }
  // the selection: each item lightly, the group with its handles
  const sb = selBox()
  if (sb && sel.value.size) {
    g.strokeStyle = acc(.45)
    g.lineWidth = 1
    g.setLineDash([3, 3])
    for (const i of shown()) {
      if (!sel.value.has(i.id) || sel.value.size === 1) continue
      const b = itemBox(i)
      const [x0, y0] = toScreen(b.x0, b.y0)
      const [x1, y1] = toScreen(b.x1, b.y1)
      g.strokeRect(x0, y0, x1 - x0, y1 - y0)
    }
    g.setLineDash([])
    g.strokeStyle = acc()
    g.lineWidth = 1.5
    if (selXf && drag?.kind === 'rotate') {
      // turning: the frame turns with it (the original frame through the turn)
      const b0 = drag.box
      const cs = [apply(selXf, b0.x0, b0.y0), apply(selXf, b0.x1, b0.y0), apply(selXf, b0.x1, b0.y1), apply(selXf, b0.x0, b0.y1)].map(([x, y]) => toScreen(x, y))
      g.beginPath()
      cs.forEach(([x, y], n) => (n ? g.lineTo(x, y) : g.moveTo(x, y)))
      g.closePath()
      g.stroke()
    } else {
      const [x0, y0] = toScreen(sb.x0, sb.y0)
      const [x1, y1] = toScreen(sb.x1, sb.y1)
      g.strokeRect(x0, y0, x1 - x0, y1 - y0)
      g.beginPath()
      g.moveTo((x0 + x1) / 2, y0)
      g.lineTo((x0 + x1) / 2, y0 - ROT_OFF + 6)
      g.stroke()
      for (const p of handlesOf(sb)) {
        g.fillStyle = '#fff'
        g.beginPath()
        if (p.h === 'rot') g.arc(p.x, p.y, 6, 0, Math.PI * 2)
        else g.rect(p.x - 5, p.y - 5, 10, 10)
        g.fill()
        g.stroke()
      }
    }
  }
}

// ---------- typed text ----------
const editing = ref<{ id?: string; x: number; y: number; text: string; size: number; color: string; rot?: number }>()
const textEl = ref<HTMLTextAreaElement>()
const editStyle = computed(() => {
  const e = editing.value
  const v = view.value
  if (!e || !v) return {}
  const m = measure(e.text || ' ', e.size)
  return {
    left: `${(e.x - v.x) * v.z}px`,
    top: `${(e.y - v.y) * v.z}px`,
    width: `${(m.w + e.size) * v.z}px`,
    height: `${m.h * v.z + 4}px`,
    fontSize: `${e.size * v.z}px`,
    lineHeight: String(LINE),
    color: e.color,
    fontFamily: FONT,
    transform: e.rot ? `rotate(${e.rot}deg)` : undefined,
    transformOrigin: '0 0',
  }
})
async function startText(x: number, y: number, item?: TextItem): Promise<void> {
  if (editing.value) finishText()
  editing.value = item ? { id: item.id, x: item.x, y: item.y, text: item.text, size: item.size, color: item.color, rot: item.rot } : { x, y, text: '', size: tp.value.textSize, color: tp.value.penColor }
  schedule()
  await nextTick()
  textEl.value?.focus()
  if (item) textEl.value?.select()
}
function finishText(): void {
  const e = editing.value
  editing.value = undefined
  if (!e) return
  const text = e.text.replace(/\s+$/, '')
  const items = board.value.items
  const was = e.id ? items.find((i) => i.id === e.id) : undefined
  if (!text) {
    // an emptied text goes
    if (was) commit({ ...board.value, items: items.filter((i) => i !== was) })
    else schedule()
    return
  }
  const m = measure(text, e.size)
  const item: TextItem = { id: e.id ?? itemId(), type: 'text', x: e.x, y: e.y, text, size: e.size, color: e.color, w: m.w, h: m.h, ...(e.rot ? { rot: e.rot } : {}) }
  if (was && was.type === 'text' && was.text === item.text && was.color === item.color && was.size === item.size) return void schedule()
  commit({ ...board.value, items: was ? items.map((i) => (i === was ? item : i)) : [...items, item] })
}
function onTextKey(e: KeyboardEvent): void {
  e.stopPropagation()
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
    e.preventDefault()
    finishText()
    wrap.value?.focus({ preventScroll: true })
  }
}
const textAt = (wx: number, wy: number) => [...board.value.items].reverse().find((i): i is TextItem => i.type === 'text' && hitsItem(i, wx, wy, 2 / (view.value?.z ?? 1)))

// ---------- the pointer ----------
type Drag =
  | { kind: 'ink' }
  | { kind: 'erase' }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'text'; item: TextItem; sx: number; sy: number; moved: boolean }
  | { kind: 'move'; wx: number; wy: number; moved: boolean }
  | { kind: 'scale'; ax: number; ay: number; d0: number }
  | { kind: 'rotate'; cx: number; cy: number; a0: number; box: Box }
  | { kind: 'frame'; wx: number; wy: number; add: boolean; base: Set<string> }
  | { kind: 'shape'; wx: number; wy: number; sx: number; sy: number }
let drag: Drag | undefined
const space = ref(false)
const panning = ref(false)
const local = (e: { clientX: number; clientY: number }) => {
  const r = wrap.value!.getBoundingClientRect()
  return [e.clientX - r.left, e.clientY - r.top] as const
}
function pressureOf(e: PointerEvent): number {
  const p = penNow()
  return p ? Math.max(0.02, p.pressure) : e.pointerType === 'pen' ? e.pressure : 0.5
}
/** The selection changed by what is being done to it: shown as a preview, committed on release. */
function previewSel(m: Affine): void {
  selXf = m
  preview = board.value.items.map((i) => (sel.value.has(i.id) ? transformItem(i, m) : i))
  schedule()
}
function onDown(e: PointerEvent): void {
  // no focus jump to the sheet by the browser (it would take the focus from a text just opened)
  e.preventDefault()
  if (editing.value) finishText()
  wrap.value?.focus({ preventScroll: true })
  canvasTarget.report()
  const v = view.value
  if (!v) return
  lv.value?.setPointerCapture(e.pointerId)
  const [sx, sy] = local(e)
  const [wx, wy] = toWorld(sx, sy)
  if (e.button === 1 || e.button === 2 || space.value || tp.value.tool === 'hand') {
    drag = { kind: 'pan', sx, sy, vx: v.x, vy: v.y }
    panning.value = true
    return
  }
  if (e.button !== 0) return
  if (tp.value.tool === 'select') {
    const h = handleAt(sx, sy)
    const b = selBox()
    if (h && b) {
      if (h === 'rot') {
        const cx = (b.x0 + b.x1) / 2
        const cy = (b.y0 + b.y1) / 2
        drag = { kind: 'rotate', cx, cy, a0: Math.atan2(wy - cy, wx - cx), box: b }
      } else {
        // the opposite corner stays
        const ax = h === 'tl' || h === 'bl' ? b.x1 : b.x0
        const ay = h === 'tl' || h === 'tr' ? b.y1 : b.y0
        drag = { kind: 'scale', ax, ay, d0: Math.max(1e-6, Math.hypot(wx - ax, wy - ay)) }
      }
      return
    }
    if (b && !e.shiftKey && wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1) {
      drag = { kind: 'move', wx, wy, moved: false }
      return
    }
    const hit = [...board.value.items].reverse().find((i) => hitsItem(i, wx, wy, 6 / v.z))
    if (hit) {
      const next = new Set(e.shiftKey ? sel.value : [])
      if (e.shiftKey && next.has(hit.id)) next.delete(hit.id)
      else next.add(hit.id)
      sel.value = next
      drag = e.shiftKey ? undefined : { kind: 'move', wx, wy, moved: false }
      schedule()
      return
    }
    drag = { kind: 'frame', wx, wy, add: e.shiftKey, base: e.shiftKey ? sel.value : new Set() }
    if (!e.shiftKey) sel.value = new Set()
    schedule()
    return
  }
  if (tp.value.tool === 'eraser') {
    drag = { kind: 'erase' }
    preview = board.value.items
    eraseAt(sx, sy)
    return
  }
  if (tp.value.tool === 'shape') {
    drag = { kind: 'shape', wx, wy, sx, sy }
    drawing = makeShape(wx, wy, wx, wy, false)
    paintLive()
    return
  }
  if (tp.value.tool === 'text') {
    const hit = textAt(wx, wy)
    if (hit) drag = { kind: 'text', item: hit, sx, sy, moved: false }
    // a new text: its first line centred on the click
    else void startText(wx, wy - (tp.value.textSize * LINE) / 2)
    return
  }
  const style = inkStyle()
  const pen = style.marker ? true : !!penNow() || e.pointerType === 'pen'
  live = { pts: [[wx, wy, style.marker ? 0.5 : pressureOf(e)]], style, pen }
  altFrom = undefined
  drag = { kind: 'ink' }
  paintLive()
}
function onMove(e: PointerEvent): void {
  const [sx, sy] = local(e)
  hover = [sx, sy]
  if (!drag) {
    if (tp.value.tool === 'select') {
      const h = handleAt(sx, sy)
      const b = selBox()
      const [wx, wy] = toWorld(sx, sy)
      selCursor.value = h === 'rot' ? 'grab' : h === 'tl' || h === 'br' ? 'nwse-resize' : h ? 'nesw-resize' : b && wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1 ? 'move' : 'default'
    }
    return void paintLive()
  }
  const [wx, wy] = toWorld(sx, sy)
  switch (drag.kind) {
    case 'pan': {
      const v = view.value!
      view.value = { x: drag.vx - (sx - drag.sx) / v.z, y: drag.vy - (sy - drag.sy) / v.z, z: v.z }
      return
    }
    case 'text': {
      const d = drag
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 4) return
      d.moved = true
      const z = view.value!.z
      const moved: TextItem = { ...d.item, x: d.item.x + (sx - d.sx) / z, y: d.item.y + (sy - d.sy) / z }
      preview = board.value.items.map((i) => (i.id === d.item.id ? moved : i))
      return schedule()
    }
    case 'move':
      drag.moved = true
      return previewSel(translate(wx - drag.wx, wy - drag.wy))
    case 'scale':
      return previewSel(scaleAbout(Math.max(0.05, Math.hypot(wx - drag.ax, wy - drag.ay) / drag.d0), drag.ax, drag.ay))
    case 'rotate': {
      let deg = ((Math.atan2(wy - drag.cy, wx - drag.cx) - drag.a0) * 180) / Math.PI
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      return previewSel(rotateAbout(deg, drag.cx, drag.cy))
    }
    case 'shape':
      drawing = makeShape(drag.wx, drag.wy, wx, wy, e.shiftKey)
      return paintLive()
    case 'frame': {
      frameRect = { x0: Math.min(drag.wx, wx), y0: Math.min(drag.wy, wy), x1: Math.max(drag.wx, wx), y1: Math.max(drag.wy, wy) }
      const f = frameRect
      const next = new Set(drag.base)
      for (const i of board.value.items) if (inFrame(i, f)) next.add(i.id)
      sel.value = next
      return schedule()
    }
  }
  const evs = typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length ? e.getCoalescedEvents() : [e]
  if (drag.kind === 'erase') {
    for (const ev of evs) {
      const [x, y] = local(ev)
      eraseAt(x, y)
    }
    return
  }
  if (live) {
    if (e.altKey) {
      // Alt held: a straight line from where Alt was pressed to the pointer (the brush's own width / pressure)
      altFrom ??= live.pts.length - 1
      const a = live.pts[altFrom]
      const [x, y] = local(e)
      const [px, py] = toWorld(x, y)
      const p = live.style.marker ? 0.5 : pressureOf(e)
      live.pts.length = altFrom + 1
      const n = Math.max(1, Math.ceil(Math.hypot(px - a[0], py - a[1]) / (2 / (view.value?.z ?? 1))))
      for (let k = 1; k <= n; k++) live.pts.push([a[0] + ((px - a[0]) * k) / n, a[1] + ((py - a[1]) * k) / n, a[2] + ((p - a[2]) * k) / n])
    } else {
      altFrom = undefined
      for (const ev of evs) {
        const [x, y] = local(ev)
        const [px, py] = toWorld(x, y)
        live.pts.push([px, py, live.style.marker ? 0.5 : pressureOf(ev)])
      }
    }
    scheduleLive()
  }
}
/** A shape from one corner (one end) to the other; Shift — a square / a circle, a line at 45° steps. */
function makeShape(x0: number, y0: number, x1: number, y1: number, square: boolean): ShapeItem {
  const kind = tp.value.shapeKind
  let dx = x1 - x0
  let dy = y1 - y0
  if (square) {
    if (isLineKind(kind)) {
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
      const len = Math.hypot(dx, dy)
      dx = Math.cos(a) * len
      dy = Math.sin(a) * len
    } else {
      const m = Math.max(Math.abs(dx), Math.abs(dy))
      dx = Math.sign(dx || 1) * m
      dy = Math.sign(dy || 1) * m
    }
  }
  const base = { id: itemId(), type: 'shape' as const, kind, color: tp.value.penColor, width: tp.value.shapeWidth, ...(tp.value.shapeDash ? { dash: true } : {}) }
  if (isLineKind(kind)) return { ...base, x: x0, y: y0, w: dx, h: dy }
  return { ...base, x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), w: Math.abs(dx), h: Math.abs(dy), ...(tp.value.shapeFill ? { fill: tp.value.penColor + '30' } : {}) }
}
/** The eraser at a screen point: cuts the lines it touches (or takes them whole), takes texts / shapes it touches. */
function eraseAt(sx: number, sy: number): void {
  if (!preview) return
  const [wx, wy] = toWorld(sx, sy)
  // with "by pressure" the eraser grows with the pen's pressure
  const pen = tp.value.eraserPressure ? penNow() : undefined
  const r = (tp.value.eraserSize / 2 / view.value!.z) * (pen ? 0.35 + pen.pressure * 1.1 : 1)
  let changed = false
  const out: BoardItem[] = []
  for (const i of preview) {
    if (i.type !== 'ink' || tp.value.eraseWhole) {
      if (hitsItem(i, wx, wy, r, false)) changed = true
      else out.push(i)
      continue
    }
    const parts = eraseInk(i, wx, wy, r)
    if (parts.length !== 1 || parts[0] !== i) changed = true
    out.push(...parts)
  }
  if (changed) {
    preview = out
    schedule()
  } else paintLive()
}
function onUp(): void {
  const d = drag
  drag = undefined
  panning.value = false
  frameRect = undefined
  selXf = undefined
  if (d?.kind === 'shape' && drawing) {
    let sh = drawing
    drawing = undefined
    // a click without a drag: a shape of the usual size there
    if (Math.abs(sh.w) < 3 / (view.value?.z ?? 1) && Math.abs(sh.h) < 3 / (view.value?.z ?? 1)) {
      const line = isLineKind(sh.kind)
      sh = line ? { ...sh, w: 160, h: 0 } : { ...sh, x: sh.x - 70, y: sh.y - 45, w: 140, h: 90 }
    }
    commit({ ...board.value, items: [...board.value.items, sh] })
    return
  }
  if (d?.kind === 'ink' && live) {
    const s = live.style
    const item: InkItem = {
      id: itemId(),
      type: 'ink',
      marker: s.marker || undefined,
      pts: live.pts.flat(),
      color: s.color,
      size: s.size,
      opacity: s.opacity,
      streamline: s.streamline,
      smoothing: s.smoothing,
      thinning: s.thinning,
      pen: live.pen,
      ...(s.gradient ? { gradient: s.gradient } : {}),
      ...(s.nib !== undefined ? { nib: s.nib } : {}),
    }
    live = undefined
    commit({ ...board.value, items: [...board.value.items, item] })
    return
  }
  const next = preview
  preview = undefined
  if (d?.kind === 'text' && !d.moved) return void startText(d.item.x, d.item.y, d.item)
  if (next && next !== board.value.items) commit({ ...board.value, items: next })
  else schedule()
}
function onLeave(): void {
  hover = undefined
  paintLive()
}
function onWheel(e: WheelEvent): void {
  e.preventDefault()
  const v = view.value
  if (!v || drag) return
  if (e.ctrlKey || e.metaKey) {
    const [sx, sy] = local(e)
    zoomAt(Math.exp(-e.deltaY * 0.0015), sx, sy)
    return
  }
  // the wheel alone sizes the tool (the circle at the pointer shows it); Shift / Alt (or the hand, the selection) — moves
  if (!e.shiftKey && !e.altKey && sized.value) {
    setSize(size.value * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
    if (editing.value && tp.value.tool === 'text') editing.value.size = size.value
    sizeHint.value = tp.value.tool === 'eraser' ? `Ластик ${Math.round(size.value)}` : tp.value.tool === 'text' ? `Текст ${Math.round(size.value)}` : `Толщина ${size.value}`
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => (sizeHint.value = ''), 900)
    paintLive()
    return
  }
  const dx = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX
  const dy = e.shiftKey ? 0 : e.deltaY
  view.value = { x: v.x + dx / v.z, y: v.y + dy / v.z, z: v.z }
}
const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"], .cm-editor')
/**
 * Ctrl+Z / Ctrl+Y (also from the tablet's keys) work while this is the active board, wherever the focus is —
 * except while typing somewhere. By the physical key: in the Russian layout Ctrl+Z gives "я".
 */
function onWinKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target)) return
  if (!canvasTarget.isActive() || !wrap.value?.isConnected) return
  if (e.code === 'KeyZ') e.shiftKey ? redo() : undo()
  else if (e.code === 'KeyY') redo()
  else return
  e.preventDefault()
  e.stopPropagation()
}
onMounted(() => window.addEventListener('keydown', onWinKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onWinKey, true))
function onKey(e: KeyboardEvent): void {
  // Alt draws straight lines here — Windows must not take it for its window menu
  if (e.key === 'Alt') e.preventDefault()
  if (typing(e.target)) return
  if (e.ctrlKey || e.metaKey) {
    const c = e.code
    if (c === 'Digit0' || c === 'Numpad0') fit()
    else if (c === 'Equal' || c === 'NumpadAdd') zoomAt(1.2)
    else if (c === 'Minus' || c === 'NumpadSubtract') zoomAt(1 / 1.2)
    else if (c === 'KeyA') {
      tp.value.tool = 'select'
      sel.value = new Set(board.value.items.map((i) => i.id))
      schedule()
    } else if (c === 'KeyC' && sel.value.size) copySelected()
    else if (c === 'KeyX' && sel.value.size) {
      copySelected()
      deleteSelected()
    } else if (c === 'KeyV') pasteClip()
    else if (c === 'KeyD' && sel.value.size) {
      copySelected()
      pasteClip()
    } else return
    e.preventDefault()
    e.stopPropagation()
    return
  }
  if (e.key === ' ') {
    space.value = true
    e.preventDefault()
    return
  }
  if (sel.value.size) {
    const step = (e.shiftKey ? 10 : 1) / (view.value?.z ?? 1)
    if (e.key === 'Delete' || e.key === 'Backspace') return void (e.preventDefault(), deleteSelected())
    if (e.key === 'Escape') {
      sel.value = new Set()
      return schedule()
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (arrows[e.key]) {
      e.preventDefault()
      return nudge(...arrows[e.key])
    }
  }
  const byCode: Record<string, Tool> = { KeyV: 'select', KeyP: 'pen', KeyB: 'nib', KeyM: 'marker', KeyE: 'eraser', KeyT: 'text', KeyS: 'shape', KeyH: 'hand' }
  if (byCode[e.code]) tp.value.tool = byCode[e.code]
  else if (e.key === '+' || e.key === '=') zoomAt(1.2)
  else if (e.key === '-') zoomAt(1 / 1.2)
  else if (e.code === 'BracketLeft') setSize(size.value / 1.2)
  else if (e.code === 'BracketRight') setSize(size.value * 1.2)
}
function onKeyUp(e: KeyboardEvent): void {
  if (e.key === 'Alt') e.preventDefault()
  if (e.key === ' ') space.value = false
}

// ---------- size ----------
let ro: ResizeObserver | undefined
function resize(): void {
  const el = wrap.value
  if (!el) return
  const r = el.getBoundingClientRect()
  W.value = Math.max(1, r.width)
  H.value = Math.max(1, r.height)
  for (const c of [cv.value, lv.value]) {
    if (!c) continue
    c.width = Math.round(W.value * devicePixelRatio)
    c.height = Math.round(H.value * devicePixelRatio)
  }
  if (mm.value) {
    mm.value.width = MM_W * devicePixelRatio
    mm.value.height = MM_H * devicePixelRatio
  }
  if (!view.value) {
    view.value = readView()
    if (!view.value) fit()
  }
  render()
}
onMounted(() => {
  ro = new ResizeObserver(resize)
  if (wrap.value) ro.observe(wrap.value)
  window.addEventListener('resize', resize)
  resize()
})
onBeforeUnmount(() => {
  if (editing.value) finishText()
  ro?.disconnect()
  window.removeEventListener('resize', resize)
  if (raf) cancelAnimationFrame(raf)
})
watch(
  () => tp.value.tool,
  (t) => {
    if (t !== 'text' && editing.value) finishText()
    if (t !== 'select' && sel.value.size) sel.value = new Set()
    schedule()
  },
)

// ---------- the shape menu, the tool's options ----------
const shapeBtn = ref<HTMLElement>()
const shapesOpen = ref(false)
const shapesStyle = ref<Record<string, string>>({})
useAnchor(shapesOpen, shapeBtn, () => shapeBtn.value && (shapesStyle.value = placeFloat(shapeBtn.value, 236, true, 40).style))
function pickShapes(): void {
  if (tp.value.tool !== 'shape') tp.value.tool = 'shape'
  shapesOpen.value = !shapesOpen.value
}
function chooseShape(k: ShapeKind): void {
  tp.value.shapeKind = k
  tp.value.tool = 'shape'
  shapesOpen.value = false
}
/** A shape's icon: its outline in a 20×20 box (lines — a diagonal). */
const iconD = (k: ShapeKind) => (isLineKind(k) ? { ...shapeD(k, 20, 20, 1.5), d: shapeD(k, 20, 20, 1.5).d } : shapeD(k, k === 'actor' ? 14 : 20, k === 'ellipse' || k === 'actor' ? 20 : 15, 1.5))
const optBtn = ref<HTMLElement>()
const optOpen = ref(false)
const optStyle = ref<Record<string, string>>({})
useAnchor(optOpen, optBtn, () => optBtn.value && (optStyle.value = placeFloat(optBtn.value, 250, true, 40).style))
const hasOptions = computed(() => ['pen', 'nib', 'marker', 'eraser', 'shape'].includes(tp.value.tool))
function onMenusDown(e: PointerEvent): void {
  const t = e.target as Node
  if (shapesOpen.value && !shapeBtn.value?.contains(t) && !(document.querySelector('.bd-shapes')?.contains(t) ?? false)) shapesOpen.value = false
  if (optOpen.value && !optBtn.value?.contains(t) && !(document.querySelector('.bd-opt')?.contains(t) ?? false)) optOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', onMenusDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onMenusDown, true))

// ---------- the background panel ----------
const bgOpen = ref(false)
const bgBtn = ref<HTMLElement>()
const bgStyle = ref<Record<string, string>>({})
useAnchor(bgOpen, bgBtn, () => bgBtn.value && (bgStyle.value = placeFloat(bgBtn.value, 280, false, 40).style))
function onDocDown(e: PointerEvent): void {
  const t = e.target as Node
  if (bgOpen.value && !bgBtn.value?.contains(t) && !(document.querySelector('.bd-bg')?.contains(t) ?? false)) bgOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', onDocDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocDown, true))
function setBg(p: Partial<BoardBg>): void {
  commit({ ...board.value, bg: { ...board.value.bg, ...p } })
}
const GRIDS: Array<{ id: GridKind; label: string }> = [
  { id: 'none', label: 'Нет' },
  { id: 'dots', label: 'Точки' },
  { id: 'lines', label: 'Линейка' },
  { id: 'squares', label: 'Клетка' },
  { id: 'iso', label: 'Изо' },
]

// ---------- export ----------
async function exportPng(): Promise<void> {
  const box = boardBox(board.value.items)
  if (!box) {
    emit('info', 'Доска пуста — нечего сохранять')
    return
  }
  const pad = 32
  const w = Math.ceil(box.x1 - box.x0 + pad * 2)
  const h = Math.ceil(box.y1 - box.y0 + pad * 2)
  const scale = Math.min(2, 8000 / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  paintBoard(c.getContext('2d')!, board.value, board.value.items, { x: box.x0 - pad, y: box.y0 - pad, z: 1 }, w, h, scale)
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
  if (!blob) return
  const name = (props.path.split('/').pop() ?? 'Доска').replace(/\.qboard$/i, '') + '.png'
  const where = await window.qa.imageSave(new Uint8Array(await blob.arrayBuffer()), name, 'png')
  if (where) emit('info', 'Сохранено в PNG')
}

const cursor = computed(() => {
  if (panning.value) return 'grabbing'
  if (space.value || tp.value.tool === 'hand') return 'grab'
  if (tp.value.tool === 'select') return selCursor.value
  if (tp.value.tool === 'text') return 'text'
  if (tp.value.tool === 'shape') return 'crosshair'
  return 'none'
})
</script>

<template>
  <div class="bd">
    <div class="bar">
      <span class="tools">
        <button :class="{ on: tp.tool === 'select' }" title="Выделение (V): рамка или клик; тянуть — перенести, углы — масштаб, кружок — поворот, Delete — удалить" @click="tp.tool = 'select'"><Icon name="pointer" :size="15" /></button>
        <button :class="{ on: tp.tool === 'pen' }" title="Перо (P)" @click="tp.tool = 'pen'"><Icon name="pencil" :size="15" /></button>
        <button :class="{ on: tp.tool === 'nib' }" title="Перо для туши (B): ширина — от направления штриха и наклона пера; Alt — прямая" @click="tp.tool = 'nib'"><Icon name="penTool" :size="15" /></button>
        <button :class="{ on: tp.tool === 'marker' }" title="Маркер (M)" @click="tp.tool = 'marker'"><Icon name="highlighter" :size="15" /></button>
        <button :class="{ on: tp.tool === 'eraser' }" title="Ластик (E): стирает то, чего касается" @click="tp.tool = 'eraser'"><Icon name="eraser" :size="15" /></button>
        <button :class="{ on: tp.tool === 'text' }" title="Текст (T): клик — новый, клик по тексту — править, тянуть — двигать" @click="tp.tool = 'text'"><span class="tt">T</span></button>
        <button ref="shapeBtn" class="shb" :class="{ on: tp.tool === 'shape' }" :title="`Фигуры (S): ${SHAPES.find((s) => s.kind === tp.shapeKind)?.label}. Тянуть — размер, Shift — ровно`" @click="pickShapes">
          <svg viewBox="-3 -3 26 26" width="15" height="15"><path :d="iconD(tp.shapeKind).d" /><path v-if="iconD(tp.shapeKind).extra" :d="iconD(tp.shapeKind).extra" /><path v-if="iconD(tp.shapeKind).head" :d="iconD(tp.shapeKind).head" /></svg>
          <Icon name="chevronDown" :size="10" />
        </button>
        <button :class="{ on: tp.tool === 'hand' }" title="Рука (H, или пробел, или средняя / правая кнопка)" @click="tp.tool = 'hand'"><Icon name="hand" :size="15" /></button>
      </span>
      <span class="sep"></span>
      <span v-if="usesColor" class="cols">
        <button v-for="c in palette" :key="c" class="col" :class="{ on: color === c }" :style="{ background: c }" @click="setColor(c)"></button>
        <label class="col pick" :class="{ on: !palette.includes(color) }" title="Свой цвет" :style="!palette.includes(color) ? { background: color } : undefined">
          <input type="color" :value="color" @input="setColor(($event.target as HTMLInputElement).value)" />
        </label>
      </span>
      <span v-if="sized" class="sizes" title="Размер — колесом мыши над доской">
        <button v-for="s in sized.presets" :key="s" :class="{ on: size === s }" @click="setSize(s)">
          <i :class="{ ring: tp.tool === 'eraser', tx: tp.tool === 'text' }" :style="tp.tool === 'text' ? { fontSize: `${Math.min(17, 8 + s / 4)}px` } : { width: `${Math.min(16, 3 + s * (tp.tool === 'eraser' ? 0.3 : 0.6))}px`, height: `${Math.min(16, 3 + s * (tp.tool === 'eraser' ? 0.3 : 0.6))}px` }">{{ tp.tool === 'text' ? 'A' : '' }}</i>
        </button>
        <em class="sv">{{ Math.round(size * 10) / 10 }}</em>
      </span>
      <button v-if="hasOptions" ref="optBtn" class="tbtn" :class="{ on: optOpen }" title="Параметры инструмента" @click="optOpen = !optOpen"><Icon name="settings" :size="14" /></button>
      <template v-if="tp.tool === 'select' && sel.size">
        <span class="selinfo">Выбрано: {{ sel.size }}</span>
        <button class="tbtn" title="Копия (Ctrl+D)" @click="(copySelected(), pasteClip())"><Icon name="copy" :size="15" /></button>
        <button class="tbtn danger" title="Удалить выделенное (Delete)" @click="deleteSelected"><Icon name="trash" :size="15" /></button>
      </template>
      <span class="sep"></span>
      <button ref="bgBtn" class="tbtn" :class="{ on: bgOpen }" title="Фон и сетка" @click="bgOpen = !bgOpen"><Icon name="grid" :size="15" /><span class="lbl">Фон</span></button>
      <button class="tbtn" :class="{ on: tp.minimap }" title="Миникарта" @click="tp.minimap = !tp.minimap"><Icon name="map" :size="15" /></button>
      <span class="grow"></span>
      <button class="tbtn" :disabled="!canUndo" title="Отменить (Ctrl+Z)" @click="undo"><Icon name="undo" :size="15" /></button>
      <button class="tbtn" :disabled="!canRedo" title="Повторить (Ctrl+Y)" @click="redo"><Icon name="redo" :size="15" /></button>
      <button class="tbtn" :disabled="!board.items.length" title="Очистить всю доску" @click="clearAll"><Icon name="eraser" :size="15" /><span class="lbl">Всё</span></button>
      <ZoomChip :model-value="zoomPct" :min="10" :max="800" title="Масштаб доски · колесо — изменить, клик — 100% · Ctrl+0 — вписать всё" @update:model-value="(v) => zoomAt(v / zoomPct)" />
      <button class="tbtn" title="Сохранить картинкой (PNG)" @click="exportPng"><Icon name="download" :size="15" /><span class="lbl">PNG</span></button>
    </div>

    <div ref="wrap" class="sheet" tabindex="0" :style="{ cursor }" @wheel="onWheel" @keydown="onKey" @keyup="onKeyUp" @contextmenu.prevent>
      <canvas ref="cv"></canvas>
      <canvas ref="lv" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @pointerleave="onLeave"></canvas>
      <textarea
        v-if="editing"
        ref="textEl"
        v-model="editing.text"
        class="tedit"
        :style="editStyle"
        spellcheck="false"
        wrap="off"
        placeholder="Текст"
        @keydown="onTextKey"
        @blur="finishText"
        @pointerdown.stop
      ></textarea>
      <span v-if="sizeHint" class="hint">{{ sizeHint }}</span>
      <div v-if="tp.minimap" class="mini" title="Миникарта: клик или перетаскивание — перейти">
        <canvas ref="mm" :style="{ width: `${MM_W}px`, height: `${MM_H}px` }" @pointerdown.stop="mmGo" @pointermove="mmGo"></canvas>
        <button class="mx" title="Скрыть миникарту" @click="tp.minimap = false"><Icon name="x" :size="10" /></button>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="shapesOpen" class="bd-pop bd-shapes" :style="shapesStyle">
        <div v-for="g in [{ id: 'basic', label: 'Основные' }, { id: 'scheme', label: 'Схемы и архитектура' }]" :key="g.id" class="shg">
          <span class="bl">{{ g.label }}</span>
          <div class="shgrid">
            <button v-for="s in SHAPES.filter((x) => x.group === g.id)" :key="s.kind" :class="{ on: tp.shapeKind === s.kind && tp.tool === 'shape' }" :title="s.label" @click="chooseShape(s.kind)">
              <svg viewBox="-3 -3 26 26" width="22" height="22"><path :d="iconD(s.kind).d" /><path v-if="iconD(s.kind).extra" :d="iconD(s.kind).extra" /><path v-if="iconD(s.kind).head" :d="iconD(s.kind).head" /></svg>
            </button>
          </div>
        </div>
      </div>
      <div v-if="optOpen && hasOptions" class="bd-pop bd-opt" :style="optStyle">
        <template v-if="tp.tool === 'nib'">
          <label class="bgr">
            <span class="bl">Угол пера</span>
            <input v-model.number="tp.nibAngle" type="range" min="0" max="179" step="1" />
            <em>{{ tp.nibAngle }}°</em>
          </label>
          <p class="ohint">С наклоном пера планшета угол берётся из наклона. Alt — прямая линия.</p>
        </template>
        <template v-if="tp.tool === 'pen' || tp.tool === 'nib' || tp.tool === 'marker'">
          <label class="bgr">
            <span class="bl">Прозрачн.</span>
            <input v-if="tp.tool !== 'marker'" v-model.number="tp.penOpacity" type="range" min="0.05" max="1" step="0.05" />
            <input v-else v-model.number="tp.markerOpacity" type="range" min="0.05" max="1" step="0.05" />
            <em>{{ Math.round((tp.tool !== 'marker' ? tp.penOpacity : tp.markerOpacity) * 100) }}%</em>
          </label>
        </template>
        <template v-if="tp.tool === 'pen' || tp.tool === 'nib'">
          <label class="bgr chk2"><input v-model="tp.gradient" type="checkbox" />Градиент по нажиму</label>
          <div v-if="tp.gradient" class="bgr">
            <span class="bl">Цвета</span>
            <span class="grad" :style="{ background: `linear-gradient(90deg, ${tp.penColor}, ${tp.gradColor})` }"></span>
            <label class="col pick" title="Второй цвет — при сильном нажиме" :style="{ background: tp.gradColor }"><input v-model="tp.gradColor" type="color" /></label>
          </div>
          <p v-if="tp.gradient" class="ohint">Лёгкое нажатие — цвет пера, сильное — второй цвет</p>
        </template>
        <template v-if="tp.tool === 'eraser'">
          <label class="bgr chk2"><input v-model="tp.eraseWhole" type="checkbox" />Стирать линии целиком</label>
          <label class="bgr chk2"><input v-model="tp.eraserPressure" type="checkbox" />Размер от нажима пера</label>
        </template>
        <template v-if="tp.tool === 'shape'">
          <label class="bgr chk2"><input v-model="tp.shapeFill" type="checkbox" />Заливка</label>
          <label class="bgr chk2"><input v-model="tp.shapeDash" type="checkbox" />Пунктир</label>
        </template>
      </div>
      <div v-if="bgOpen" class="bd-bg" :style="bgStyle">
        <div class="bgr">
          <span class="bl">Бумага</span>
          <span class="papers">
            <button v-for="p in PAPERS" :key="p.id" class="paper" :class="{ on: board.bg.color === p.color }" :title="p.label" :style="{ background: p.color }" @click="setBg({ color: p.color })"></button>
            <label class="paper pick" title="Свой цвет"><input type="color" :value="board.bg.color" @change="setBg({ color: ($event.target as HTMLInputElement).value })" /></label>
          </span>
        </div>
        <label class="bgr chk2" title="Неровный тон и зерно; тушь ложится с просветами, сильный нажим продавливает бумагу"><input type="checkbox" :checked="board.bg.texture === 'paper'" @change="setBg({ texture: ($event.target as HTMLInputElement).checked ? 'paper' : undefined })" />Фактурная бумага</label>
        <div class="bgr">
          <span class="bl">Сетка</span>
          <span class="seg">
            <button v-for="g in GRIDS" :key="g.id" :class="{ on: board.bg.grid === g.id }" @click="setBg({ grid: g.id })">{{ g.label }}</button>
          </span>
        </div>
        <template v-if="board.bg.grid !== 'none'">
          <label class="bgr">
            <span class="bl">Шаг</span>
            <input type="range" min="8" max="80" step="2" :value="board.bg.step" @change="setBg({ step: Number(($event.target as HTMLInputElement).value) })" />
            <em>{{ board.bg.step }}</em>
          </label>
          <label class="bgr">
            <span class="bl">Яркость</span>
            <input type="range" min="5" max="100" step="5" :value="Math.round(board.bg.opacity * 100)" @change="setBg({ opacity: Number(($event.target as HTMLInputElement).value) / 100 })" />
            <em>{{ Math.round(board.bg.opacity * 100) }}%</em>
          </label>
          <div v-if="board.bg.grid !== 'iso'" class="bgr">
            <span class="bl">Крупная</span>
            <span class="seg">
              <button v-for="m in [0, 4, 5, 10]" :key="m" :class="{ on: board.bg.major === m }" @click="setBg({ major: m })">{{ m ? `каждая ${m}` : 'нет' }}</button>
            </span>
          </div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.bd {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  container-type: inline-size;
}
.grow {
  flex: 1;
}
.sep {
  flex: none;
  width: 1px;
  height: 20px;
  background: var(--border);
}
.tools,
.cols,
.sizes {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.tools button,
.tbtn,
.sizes button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  min-width: 28px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  flex: none;
}
.tools button:hover,
.tbtn:hover:not(:disabled),
.sizes button:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}
.tools button.on,
.tbtn.on,
.sizes button.on {
  background: rgb(var(--accent-rgb) / 0.22);
  color: var(--text-hi);
}
.tbtn.danger:hover {
  color: var(--down-fg);
}
.tbtn:disabled {
  opacity: 0.35;
}
.selinfo {
  flex: none;
  color: var(--accent-fg);
  font-size: 12px;
}
.tt {
  font-family: Georgia, serif;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
}
.cols {
  gap: 4px;
  padding: 0 2px;
}
.col {
  position: relative;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--r1);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25);
  flex: none;
}
.col.on {
  border-color: var(--accent-fg);
}
.col.pick,
.paper.pick {
  overflow: hidden;
  background: conic-gradient(var(--down), var(--warn), var(--warn), var(--up), #06b6d4, var(--info), var(--accent), #ec4899, var(--down));
  cursor: pointer;
}
.col.pick input,
.paper.pick input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.sizes i {
  display: block;
  border-radius: 50%;
  background: currentColor;
  font-style: normal;
}
.sizes i.ring {
  background: transparent;
  border: 1.5px solid currentColor;
}
.sizes i.tx {
  background: transparent;
  border-radius: 0;
  font-weight: 600;
  line-height: 1;
}
.sv {
  min-width: 26px;
  color: var(--muted);
  font-size: 11px;
  font-style: normal;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.chk {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  color: var(--text-2);
  font-size: 12px;
}
.chk input {
  accent-color: var(--accent);
}
.zoom {
  display: inline-flex;
  align-items: center;
  flex: none;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.zoom button {
  display: inline-flex;
  align-items: center;
  padding: 4px 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11.5px;
}
.zoom .zv {
  min-width: 44px;
  justify-content: center;
  color: var(--accent-fg);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.zoom button:hover {
  color: var(--text);
}
/* narrow: the words go, the icons stay — one line always */
@container (max-width: 760px) {
  .lbl,
  .sv,
  .selinfo {
    display: none;
  }
}
@container (max-width: 620px) {
  .cols .col:nth-child(n + 4) {
    display: none;
  }
  .zoom .zv {
    display: none;
  }
}
.sheet {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  outline: none;
  touch-action: none;
}
.sheet canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.tedit {
  position: absolute;
  z-index: 2;
  min-width: 30px;
  margin: 0;
  padding: 0;
  border: 0;
  outline: 1px dashed rgb(var(--accent-rgb) / 0.8);
  outline-offset: 3px;
  background: transparent;
  resize: none;
  overflow: hidden;
  white-space: pre;
}
.tedit::placeholder {
  color: rgb(var(--accent-rgb) / 0.55);
}
.hint {
  position: absolute;
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  padding: 3px 10px;
  border-radius: 4px;
  background: rgba(13, 17, 23, 0.82);
  color: var(--text);
  font-size: 12px;
  pointer-events: none;
}
.mini {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 3;
  border: 1px solid rgb(var(--accent-rgb) / 0.45);
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}
.mini canvas {
  position: static;
  display: block;
  cursor: pointer;
}
.mx {
  position: absolute;
  top: 3px;
  right: 3px;
  display: none;
  padding: 2px;
  border: 0;
  border-radius: var(--r2);
  background: rgba(0, 0, 0, 0.55);
  color: var(--text-hi);
}
.mini:hover .mx {
  display: inline-flex;
}
.shb svg,
.bd-shapes svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}
/* the shape menu / the options (teleported) */
.bd-pop {
  padding: 8px 10px 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--r3);
  background: var(--panel);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  color: var(--text);
  font-size: 12px;
}
.shg + .shg {
  margin-top: 6px;
}
.shgrid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 3px;
  margin-top: 4px;
}
.shgrid button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-2);
}
.shgrid button:hover {
  background: rgba(255, 255, 255, 0.1);
}
.shgrid button.on {
  background: rgb(var(--accent-rgb) / 0.25);
  color: var(--text-hi);
}
.chk2 {
  color: var(--text-2);
  cursor: pointer;
}
.chk2 input {
  accent-color: var(--accent);
}
.grad {
  flex: 1;
  height: 10px;
  border-radius: var(--r2);
}
.ohint {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 11px;
}
/* the background panel (teleported) */
.bd-bg {
  padding: 10px 12px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--r3);
  background: var(--panel);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  color: var(--text);
  font-size: 12px;
}
.bgr {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  white-space: nowrap;
}
.bl {
  flex: none;
  width: 58px;
  color: var(--muted);
}
.bgr input[type='range'] {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}
.bgr em {
  width: 34px;
  font-style: normal;
  text-align: right;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.papers {
  display: inline-flex;
  gap: 6px;
}
.paper {
  position: relative;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--r2);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
}
.paper.on {
  border-color: var(--accent);
}
.seg {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
}
.seg button {
  height: 24px;
  padding: 0 7px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 11.5px;
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.22);
  color: var(--text-hi);
}
</style>
