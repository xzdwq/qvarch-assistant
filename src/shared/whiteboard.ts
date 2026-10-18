/**
 * A board (Блокнот → «Доска»): an endless sheet for schemes, notes and process sketches, stored as a `.qboard`
 * file (JSON) next to the notes. Stage 1: ink (pen / marker), the background and its grid.
 * Coordinates are the board's own ("world") units — the view (pan / zoom) is not part of the file.
 */

export const BOARD_EXT = '.qboard'
export const isBoard = (path: string) => path.toLowerCase().endsWith(BOARD_EXT)

export type GridKind = 'none' | 'dots' | 'lines' | 'squares' | 'iso'

export interface BoardBg {
  /** The paper. */
  color: string
  grid: GridKind
  /** The grid step, world units. */
  step: number
  /** 0…1 — how visible the grid is. */
  opacity: number
  /** Every N-th line / dot is stronger (0 — none). */
  major: number
  /** Textured paper: an uneven tone and grain; ink takes its tooth (gaps, dents under a firm pen, a rare splash). */
  texture?: 'paper'
}

export interface InkItem {
  id: string
  type: 'ink'
  /** A marker: wide, see-through, no pressure. */
  marker?: boolean
  /** x, y, pressure — flat, world units. */
  pts: number[]
  color: string
  size: number
  opacity: number
  streamline: number
  smoothing: number
  thinning: number
  /** Drawn with a pen (real pressure) — else the pressure is simulated from the speed. */
  pen: boolean
  /** A gradient by the pressure: light — `color`, firm — this one. */
  gradient?: string
  /** A broad-nib ink pen: the nib's angle, degrees (0…180). */
  nib?: number
}

/** Typed text: its top-left corner, the font size (world units); w / h — measured by the renderer when typed. */
export interface TextItem {
  id: string
  type: 'text'
  x: number
  y: number
  text: string
  size: number
  color: string
  w: number
  h: number
  /** Turned around its top-left corner, degrees clockwise. */
  rot?: number
}

/** Shapes: the basic ones and those of schemes / software architecture (flowchart, UML, C4). */
export type ShapeKind =
  | 'rect'
  | 'round'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'arrow2'
  | 'terminator'
  | 'parallelogram'
  | 'hexagon'
  | 'doc'
  | 'note'
  | 'db'
  | 'queue'
  | 'server'
  | 'component'
  | 'cloud'
  | 'actor'

export const SHAPES: Array<{ kind: ShapeKind; label: string; group: 'basic' | 'scheme' }> = [
  { kind: 'rect', label: 'Прямоугольник', group: 'basic' },
  { kind: 'round', label: 'Скруглённый', group: 'basic' },
  { kind: 'ellipse', label: 'Круг / эллипс', group: 'basic' },
  { kind: 'diamond', label: 'Ромб — решение', group: 'basic' },
  { kind: 'line', label: 'Линия', group: 'basic' },
  { kind: 'arrow', label: 'Стрелка', group: 'basic' },
  { kind: 'arrow2', label: 'Двусторонняя стрелка', group: 'basic' },
  { kind: 'terminator', label: 'Начало / конец', group: 'scheme' },
  { kind: 'parallelogram', label: 'Ввод / вывод данных', group: 'scheme' },
  { kind: 'hexagon', label: 'Подготовка / сервис', group: 'scheme' },
  { kind: 'doc', label: 'Документ', group: 'scheme' },
  { kind: 'note', label: 'Заметка', group: 'scheme' },
  { kind: 'db', label: 'База данных', group: 'scheme' },
  { kind: 'queue', label: 'Очередь / шина', group: 'scheme' },
  { kind: 'server', label: 'Сервер', group: 'scheme' },
  { kind: 'component', label: 'Компонент (UML)', group: 'scheme' },
  { kind: 'cloud', label: 'Облако / внешняя система', group: 'scheme' },
  { kind: 'actor', label: 'Пользователь (актор)', group: 'scheme' },
]
export const isLineKind = (k: ShapeKind) => k === 'line' || k === 'arrow' || k === 'arrow2'

/**
 * A shape: a box x, y, w, h (turned `rot` around its centre) — or, for a line / an arrow, from (x, y) to
 * (x + w, y + h). Outline `color` / `width`, an optional fill, dashed or not.
 */
export interface ShapeItem {
  id: string
  type: 'shape'
  kind: ShapeKind
  x: number
  y: number
  w: number
  h: number
  rot?: number
  color: string
  width: number
  fill?: string
  dash?: boolean
}

/**
 * A picture (a file in vault/.images): its box x, y, w, h turned `rot` around its centre. Always under the ink,
 * text and shapes — one draws over it.
 */
export interface ImageItem {
  id: string
  type: 'image'
  x: number
  y: number
  w: number
  h: number
  rot?: number
  /** The vault's path: .images/<file>. */
  src: string
}

export type BoardItem = InkItem | TextItem | ShapeItem | ImageItem
/** A box turned around its centre (a shape, a picture). */
type Boxed = Pick<ShapeItem, 'x' | 'y' | 'w' | 'h' | 'rot'>

/** A new id (not crypto-strong — only to tell items apart). */
export const itemId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export interface Board {
  v: 1
  bg: BoardBg
  items: BoardItem[]
}

export const PAPERS = [
  { id: 'white', color: '#ffffff', label: 'Белая' },
  { id: 'warm', color: '#fbf8f1', label: 'Тёплая' },
  { id: 'mint', color: '#f1f8f4', label: 'Мятная' },
  { id: 'slate', color: '#1e2230', label: 'Графит' },
  { id: 'night', color: '#0f1117', label: 'Ночь' },
] as const

export const DEFAULT_BG: BoardBg = { color: '#ffffff', grid: 'dots', step: 24, opacity: 0.5, major: 5 }

export const newBoard = (): Board => ({ v: 1, bg: { ...DEFAULT_BG }, items: [] })

/** A dark paper → light ink and grid. */
export function isDarkPaper(color: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return false
  const n = parseInt(m[1], 16)
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
  return l < 110
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d)

/** A file's text → a board (an empty / broken file → a new board; unknown items are dropped). */
export function parseBoard(text: string): Board {
  let raw: unknown
  try {
    raw = text.trim() ? JSON.parse(text) : undefined
  } catch {
    raw = undefined
  }
  const b = newBoard()
  if (!raw || typeof raw !== 'object') return b
  const r = raw as { bg?: Partial<BoardBg>; items?: unknown[] }
  const bg = r.bg ?? {}
  b.bg = {
    color: str(bg.color, DEFAULT_BG.color),
    grid: (['none', 'dots', 'lines', 'squares', 'iso'] as const).includes(bg.grid as GridKind) ? (bg.grid as GridKind) : DEFAULT_BG.grid,
    step: num(bg.step, 6, 200, DEFAULT_BG.step),
    opacity: num(bg.opacity, 0, 1, DEFAULT_BG.opacity),
    major: Math.round(num(bg.major, 0, 20, DEFAULT_BG.major)),
    ...(bg.texture === 'paper' ? { texture: 'paper' as const } : {}),
  }
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const im = it as Partial<ImageItem>
    if (im?.type === 'image') {
      if (typeof im.src !== 'string' || !/^\.images\/[\w.-]+\.(?:png|jpe?g|gif|webp|bmp)$/i.test(im.src)) continue
      b.items.push({
        id: str(im.id, itemId()),
        type: 'image',
        x: num(im.x, -1e7, 1e7, 0),
        y: num(im.y, -1e7, 1e7, 0),
        w: num(im.w, 1, 1e7, 100),
        h: num(im.h, 1, 1e7, 100),
        src: im.src,
        ...(typeof im.rot === 'number' && Number.isFinite(im.rot) && im.rot % 360 !== 0 ? { rot: im.rot % 360 } : {}),
      })
      continue
    }
    const sh = it as Partial<ShapeItem>
    if (sh?.type === 'shape') {
      if (!SHAPES.some((x) => x.kind === sh.kind)) continue
      const line = isLineKind(sh.kind!)
      b.items.push({
        id: str(sh.id, itemId()),
        type: 'shape',
        kind: sh.kind!,
        x: num(sh.x, -1e7, 1e7, 0),
        y: num(sh.y, -1e7, 1e7, 0),
        w: num(sh.w, line ? -1e7 : 1, 1e7, 10),
        h: num(sh.h, line ? -1e7 : 1, 1e7, 10),
        color: str(sh.color, '#111827'),
        width: num(sh.width, 0.2, 100, 2),
        ...(typeof sh.rot === 'number' && Number.isFinite(sh.rot) && sh.rot % 360 !== 0 && !line ? { rot: sh.rot % 360 } : {}),
        ...(typeof sh.fill === 'string' && sh.fill ? { fill: sh.fill } : {}),
        ...(sh.dash ? { dash: true } : {}),
      })
      continue
    }
    const t = it as Partial<TextItem>
    if (t?.type === 'text') {
      if (typeof t.text !== 'string' || !t.text.trim()) continue
      b.items.push({
        id: str(t.id, itemId()),
        type: 'text',
        x: num(t.x, -1e7, 1e7, 0),
        y: num(t.y, -1e7, 1e7, 0),
        text: t.text,
        size: num(t.size, 4, 400, 20),
        color: str(t.color, '#111827'),
        w: num(t.w, 1, 1e6, 10),
        h: num(t.h, 1, 1e6, 10),
        ...(typeof t.rot === 'number' && Number.isFinite(t.rot) && t.rot % 360 !== 0 ? { rot: t.rot % 360 } : {}),
      })
      continue
    }
    const i = it as Partial<InkItem>
    if (i?.type !== 'ink' || !Array.isArray(i.pts) || i.pts.length < 3) continue
    const pts = i.pts.filter((n) => typeof n === 'number' && Number.isFinite(n))
    if (pts.length < 3) continue
    b.items.push({
      id: str(i.id, itemId()),
      type: 'ink',
      marker: !!i.marker,
      pts: pts.slice(0, pts.length - (pts.length % 3)),
      color: str(i.color, '#111827'),
      size: num(i.size, 0.2, 400, 4),
      opacity: num(i.opacity, 0.05, 1, 1),
      streamline: num(i.streamline, 0, 0.95, 0.5),
      smoothing: num(i.smoothing, 0, 1, 0.5),
      thinning: num(i.thinning, -0.9, 0.9, 0.5),
      pen: !!i.pen,
      ...(typeof i.gradient === 'string' && i.gradient ? { gradient: i.gradient } : {}),
      ...(typeof i.nib === 'number' && Number.isFinite(i.nib) ? { nib: ((i.nib % 180) + 180) % 180 } : {}),
    })
  }
  return b
}

/** A board → its file (points rounded: coordinates to 0.1, pressure to 0.01 — the file stays small). */
export function serializeBoard(b: Board): string {
  const items = b.items.map((i) => (i.type === 'ink' ? { ...i, pts: i.pts.map((n, k) => (k % 3 === 2 ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10)) } : i))
  return JSON.stringify({ v: 1, bg: b.bg, items })
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Where an item is (with its line width). */
export function itemBox(i: BoardItem): Box {
  if (i.type === 'image') {
    if (!i.rot) return { x0: i.x, y0: i.y, x1: i.x + i.w, y1: i.y + i.h }
    const cs = [shapeCorner(i, 0, 0), shapeCorner(i, i.w, 0), shapeCorner(i, 0, i.h), shapeCorner(i, i.w, i.h)]
    return { x0: Math.min(...cs.map((c) => c[0])), y0: Math.min(...cs.map((c) => c[1])), x1: Math.max(...cs.map((c) => c[0])), y1: Math.max(...cs.map((c) => c[1])) }
  }
  if (i.type === 'shape') {
    const pad = i.width / 2 + (isLineKind(i.kind) && i.kind !== 'line' ? Math.max(8, i.width * 4) : 0)
    if (isLineKind(i.kind))
      return { x0: Math.min(i.x, i.x + i.w) - pad, y0: Math.min(i.y, i.y + i.h) - pad, x1: Math.max(i.x, i.x + i.w) + pad, y1: Math.max(i.y, i.y + i.h) + pad }
    if (!i.rot) return { x0: i.x - pad, y0: i.y - pad, x1: i.x + i.w + pad, y1: i.y + i.h + pad }
    const cs = [shapeCorner(i, 0, 0), shapeCorner(i, i.w, 0), shapeCorner(i, 0, i.h), shapeCorner(i, i.w, i.h)]
    return { x0: Math.min(...cs.map((c) => c[0])) - pad, y0: Math.min(...cs.map((c) => c[1])) - pad, x1: Math.max(...cs.map((c) => c[0])) + pad, y1: Math.max(...cs.map((c) => c[1])) + pad }
  }
  if (i.type === 'text') {
    if (!i.rot) return { x0: i.x, y0: i.y, x1: i.x + i.w, y1: i.y + i.h }
    const cs = [textCorner(i, 0, 0), textCorner(i, i.w, 0), textCorner(i, 0, i.h), textCorner(i, i.w, i.h)]
    return { x0: Math.min(...cs.map((c) => c[0])), y0: Math.min(...cs.map((c) => c[1])), x1: Math.max(...cs.map((c) => c[0])), y1: Math.max(...cs.map((c) => c[1])) }
  }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let k = 0; k < i.pts.length; k += 3) {
    const x = i.pts[k]
    const y = i.pts[k + 1]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  const r = i.size
  return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r }
}

/** Everything drawn (undefined — an empty board). */
export function boardBox(items: BoardItem[]): Box | undefined {
  if (!items.length) return undefined
  return items.map(itemBox).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
}

const segDist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax
  const dy = by - ay
  const l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0
  const x = ax + t * dx - px
  const y = ay + t * dy - py
  return x * x + y * y
}

/** Does a circle (the eraser) at x, y with radius r touch the item's line? */
export function hitsItem(i: BoardItem, x: number, y: number, r: number, interior = true): boolean {
  const b = itemBox(i)
  if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false
  if (i.type === 'image') {
    const [lx, ly] = shapeLocal(i, x, y)
    const dx = Math.max(-lx, 0, lx - i.w)
    const dy = Math.max(-ly, 0, ly - i.h)
    return dx * dx + dy * dy <= r * r
  }
  if (i.type === 'shape') {
    const reach = r + i.width / 2
    if (isLineKind(i.kind)) return segDist2(x, y, i.x, i.y, i.x + i.w, i.y + i.h) <= reach * reach
    const [lx, ly] = shapeLocal(i, x, y)
    const dx = Math.max(-lx, 0, lx - i.w)
    const dy = Math.max(-ly, 0, ly - i.h)
    const outside = Math.hypot(dx, dy)
    if (outside > reach) return false
    if (interior || i.fill || outside > 0) return true
    // inside an unfilled shape: only near its outline
    return Math.min(lx, ly, i.w - lx, i.h - ly) <= reach
  }
  if (i.type === 'text') {
    // the circle against the text's own (unturned) box
    const [lx, ly] = textLocal(i, x, y)
    const dx = Math.max(-lx, 0, lx - i.w)
    const dy = Math.max(-ly, 0, ly - i.h)
    return dx * dx + dy * dy <= r * r
  }
  const reach = r + i.size / 2
  const r2 = reach * reach
  const p = i.pts
  if (p.length === 3) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= r2
  for (let k = 0; k + 5 < p.length; k += 3) if (segDist2(x, y, p[k], p[k + 1], p[k + 3], p[k + 4]) <= r2) return true
  return false
}

/** The view that shows the whole box in a w×h viewport (with a margin), zoom limited. */
export function fitView(box: Box | undefined, w: number, h: number, margin = 40): { x: number; y: number; z: number } {
  if (!box) return { x: -w / 2, y: -h / 2, z: 1 }
  const bw = Math.max(1, box.x1 - box.x0)
  const bh = Math.max(1, box.y1 - box.y0)
  const z = Math.min(4, Math.max(0.1, Math.min((w - margin * 2) / bw, (h - margin * 2) / bh)))
  return { x: (box.x0 + box.x1) / 2 - w / 2 / z, y: (box.y0 + box.y1) / 2 - h / 2 / z, z }
}

/**
 * The eraser "like in Paint": the part of a line the eraser circle (cx, cy, r) covers is cut out — what is left
 * becomes separate lines (each keeps the style). Every segment is cut exactly where it enters / leaves the circle
 * (the circle grows by half the line's width, so the cut goes through the whole line). Returns the pieces
 * ([] — all gone; [item] itself — untouched).
 */
export function eraseInk(item: InkItem, cx: number, cy: number, r: number): InkItem[] {
  const reach = r + item.size / 2
  const r2 = reach * reach
  const p = item.pts
  const n = p.length / 3
  const inside = (k: number) => (p[k * 3] - cx) ** 2 + (p[k * 3 + 1] - cy) ** 2 <= r2
  const b = itemBox(item)
  if (cx < b.x0 - r || cx > b.x1 + r || cy < b.y0 - r || cy > b.y1 + r) return [item]
  if (n === 1) return inside(0) ? [] : [item]
  const runs: number[][] = []
  let cur: number[] = []
  const lerp = (k: number, t: number) => {
    const a = k * 3
    const c = a + 3
    return [p[a] + (p[c] - p[a]) * t, p[a + 1] + (p[c + 1] - p[a + 1]) * t, p[a + 2] + (p[c + 2] - p[a + 2]) * t]
  }
  let touched = false
  if (!inside(0)) cur.push(p[0], p[1], p[2])
  else touched = true
  for (let k = 0; k < n - 1; k++) {
    // where the segment k → k+1 is inside the circle: t in [t0, t1] (the roots of |a + t·d − c|² = reach²)
    const ax = p[k * 3] - cx
    const ay = p[k * 3 + 1] - cy
    const dx = p[k * 3 + 3] - p[k * 3]
    const dy = p[k * 3 + 4] - p[k * 3 + 1]
    const A = dx * dx + dy * dy
    const B = 2 * (ax * dx + ay * dy)
    const C = ax * ax + ay * ay - r2
    const disc = B * B - 4 * A * C
    let t0 = 2
    let t1 = -1
    if (A > 1e-9 && disc > 0) {
      const sq = Math.sqrt(disc)
      t0 = (-B - sq) / (2 * A)
      t1 = (-B + sq) / (2 * A)
    } else if (C <= 0) {
      t0 = 0
      t1 = 1
    }
    const enters = t0 > 0 && t0 < 1
    const leaves = t1 > 0 && t1 < 1
    const covered = t0 <= 0 && t1 >= 1
    if (covered) {
      touched = true
      if (cur.length) runs.push(cur)
      cur = []
      continue
    }
    if (enters) {
      touched = true
      cur.push(...lerp(k, t0))
      runs.push(cur)
      cur = []
    }
    if (leaves) {
      touched = true
      cur = [...lerp(k, t1)]
    }
    if (!inside(k + 1)) cur.push(p[k * 3 + 3], p[k * 3 + 4], p[k * 3 + 5])
  }
  if (cur.length) runs.push(cur)
  if (!touched) return [item]
  // a crumb shorter than half the line's width is not worth keeping
  const long = (run: number[]) => {
    let len = 0
    for (let k = 3; k < run.length; k += 3) len += Math.hypot(run[k] - run[k - 3], run[k + 1] - run[k - 2])
    return len >= item.size / 2
  }
  return runs.filter((run) => run.length >= 6 && long(run)).map((pts) => ({ ...item, id: itemId(), pts }))
}

// ---------- turned text ----------
/** A point of a text's own box (u, v from its top-left) on the board. */
export function textCorner(t: TextItem, u: number, v: number): [number, number] {
  const a = ((t.rot ?? 0) * Math.PI) / 180
  return [t.x + u * Math.cos(a) - v * Math.sin(a), t.y + u * Math.sin(a) + v * Math.cos(a)]
}
/** A board point in a text's own box. */
export function textLocal(t: TextItem, x: number, y: number): [number, number] {
  const a = (-(t.rot ?? 0) * Math.PI) / 180
  const dx = x - t.x
  const dy = y - t.y
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)]
}

// ---------- the selection: move / scale / turn ----------
/** x' = a·x + c·y + e, y' = b·x + d·y + f */
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}
export const translate = (dx: number, dy: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy })
export const scaleAbout = (s: number, cx: number, cy: number): Affine => ({ a: s, b: 0, c: 0, d: s, e: cx - s * cx, f: cy - s * cy })
/** Turned by `deg` clockwise (the screen's y goes down) around cx, cy. */
export function rotateAbout(deg: number, cx: number, cy: number): Affine {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { a: cos, b: sin, c: -sin, d: cos, e: cx - cos * cx + sin * cy, f: cy - sin * cx - cos * cy }
}
export const apply = (m: Affine, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]

/** An item moved / scaled / turned (line widths and font sizes scale with it). */
export function transformItem<T extends BoardItem>(i: T, m: Affine): T {
  const s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))
  if (i.type === 'image') {
    const [cx, cy] = apply(m, i.x + i.w / 2, i.y + i.h / 2)
    const w = i.w * s
    const h = i.h * s
    const rot = Math.round((((i.rot ?? 0) + (Math.atan2(m.b, m.a) * 180) / Math.PI) % 360) * 100) / 100
    const out: ImageItem = { ...i, x: cx - w / 2, y: cy - h / 2, w, h }
    if (rot) out.rot = rot
    else delete out.rot
    return out as T
  }
  if (i.type === 'shape') {
    const sh = i as ShapeItem
    if (isLineKind(sh.kind)) {
      const [x0, y0] = apply(m, sh.x, sh.y)
      const [x1, y1] = apply(m, sh.x + sh.w, sh.y + sh.h)
      return { ...sh, x: x0, y: y0, w: x1 - x0, h: y1 - y0, width: sh.width * s } as T
    }
    // the centre moves, the size scales, the turn adds up
    const [cx, cy] = apply(m, sh.x + sh.w / 2, sh.y + sh.h / 2)
    const w = sh.w * s
    const h = sh.h * s
    const rot = Math.round((((sh.rot ?? 0) + (Math.atan2(m.b, m.a) * 180) / Math.PI) % 360) * 100) / 100
    const out: ShapeItem = { ...sh, x: cx - w / 2, y: cy - h / 2, w, h, width: sh.width * s }
    if (rot) out.rot = rot
    else delete out.rot
    return out as T
  }
  if (i.type === 'ink') {
    const pts = i.pts.slice()
    for (let k = 0; k < pts.length; k += 3) {
      const [x, y] = apply(m, pts[k], pts[k + 1])
      pts[k] = x
      pts[k + 1] = y
    }
    return { ...i, pts, size: i.size * s }
  }
  const [x, y] = apply(m, i.x, i.y)
  const turn = (Math.atan2(m.b, m.a) * 180) / Math.PI
  const rot = Math.round((((i.rot ?? 0) + turn) % 360) * 100) / 100
  const t: TextItem = { ...(i as TextItem), x, y, size: i.size * s, w: i.w * s, h: i.h * s }
  if (rot) t.rot = rot
  else delete t.rot
  return t as T
}

/** Is an item caught by a selection frame (any of its line inside / its box crossing it)? */
export function inFrame(i: BoardItem, f: Box): boolean {
  if (i.type === 'text' || i.type === 'shape' || i.type === 'image') {
    const b = itemBox(i)
    return b.x1 >= f.x0 && b.x0 <= f.x1 && b.y1 >= f.y0 && b.y0 <= f.y1
  }
  for (let k = 0; k < i.pts.length; k += 3) {
    const x = i.pts[k]
    const y = i.pts[k + 1]
    if (x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1) return true
  }
  return false
}

// ---------- shapes: geometry and outlines ----------
/** A point of a shape's own box (u, v from its top-left) on the board — it turns around its centre. */
export function shapeCorner(sh: Boxed, u: number, v: number): [number, number] {
  const a = ((sh.rot ?? 0) * Math.PI) / 180
  const dx = u - sh.w / 2
  const dy = v - sh.h / 2
  return [sh.x + sh.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), sh.y + sh.h / 2 + dx * Math.sin(a) + dy * Math.cos(a)]
}
/** A board point in a shape's own box. */
export function shapeLocal(sh: Boxed, x: number, y: number): [number, number] {
  const a = (-(sh.rot ?? 0) * Math.PI) / 180
  const dx = x - (sh.x + sh.w / 2)
  const dy = y - (sh.y + sh.h / 2)
  return [sh.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), sh.h / 2 + dx * Math.sin(a) + dy * Math.cos(a)]
}

const n = (v: number) => Math.round(v * 100) / 100
/**
 * A shape's outline as SVG path data in its own box (0,0)–(w,h); a line / an arrow — from (0,0) to (w,h).
 * The same data draws on the canvas (Path2D) and in the shape menu's icons.
 * `fillable` — the closed part (the fill); `extra` — inner strokes (a server's shelves, a note's fold…).
 */
export function shapeD(kind: ShapeKind, w: number, h: number, width = 2): { d: string; extra?: string; head?: string; fillable: boolean } {
  const mn = Math.min(Math.abs(w), Math.abs(h))
  switch (kind) {
    case 'rect':
      return { d: `M0 0H${n(w)}V${n(h)}H0Z`, fillable: true }
    case 'round':
    case 'terminator': {
      const r = n(kind === 'terminator' ? h / 2 : mn * 0.18)
      return { d: `M${r} 0H${n(w - r)}A${r} ${r} 0 0 1 ${n(w)} ${r}V${n(h - r)}A${r} ${r} 0 0 1 ${n(w - r)} ${n(h)}H${r}A${r} ${r} 0 0 1 0 ${n(h - r)}V${r}A${r} ${r} 0 0 1 ${r} 0Z`, fillable: true }
    }
    case 'ellipse': {
      const rx = n(Math.abs(w) / 2)
      const ry = n(Math.abs(h) / 2)
      const cx = n(w / 2)
      const cy = n(h / 2)
      const x0 = n(w / 2 - Math.abs(w) / 2)
      const x1 = n(w / 2 + Math.abs(w) / 2)
      const y0 = n(h / 2 - Math.abs(h) / 2)
      const y1 = n(h / 2 + Math.abs(h) / 2)
      return { d: `M${x0} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${y0}A${rx} ${ry} 0 0 1 ${x1} ${cy}A${rx} ${ry} 0 0 1 ${cx} ${y1}A${rx} ${ry} 0 0 1 ${x0} ${cy}Z`, fillable: true }
    }
    case 'diamond':
      return { d: `M${n(w / 2)} 0L${n(w)} ${n(h / 2)}L${n(w / 2)} ${n(h)}L0 ${n(h / 2)}Z`, fillable: true }
    case 'parallelogram': {
      const k = n(Math.min(w * 0.2, h * 0.6))
      return { d: `M${k} 0H${n(w)}L${n(w - k)} ${n(h)}H0Z`, fillable: true }
    }
    case 'hexagon': {
      const k = n(Math.min(w * 0.22, h * 0.5))
      return { d: `M${k} 0H${n(w - k)}L${n(w)} ${n(h / 2)}L${n(w - k)} ${n(h)}H${k}L0 ${n(h / 2)}Z`, fillable: true }
    }
    case 'doc': {
      const b = n(h * 0.86)
      return { d: `M0 0H${n(w)}V${b}C${n(w * 0.75)} ${n(h * 0.72)} ${n(w * 0.5)} ${n(h * 1.02)} ${n(w * 0.25)} ${n(h * 0.88)}C${n(w * 0.14)} ${n(h * 0.82)} ${n(w * 0.06)} ${n(h * 0.82)} 0 ${b}Z`, fillable: true }
    }
    case 'note': {
      const f = n(mn * 0.22)
      return { d: `M0 0H${n(w - f)}L${n(w)} ${f}V${n(h)}H0Z`, extra: `M${n(w - f)} 0V${f}H${n(w)}`, fillable: true }
    }
    case 'db': {
      const ry = n(Math.min(h * 0.14, w * 0.3))
      const rx = n(w / 2)
      return {
        d: `M0 ${ry}A${rx} ${ry} 0 0 1 ${n(w)} ${ry}V${n(h - ry)}A${rx} ${ry} 0 0 1 0 ${n(h - ry)}Z`,
        extra: `M0 ${ry}A${rx} ${ry} 0 0 0 ${n(w)} ${ry}`,
        fillable: true,
      }
    }
    case 'queue': {
      const rx = n(Math.min(w * 0.14, h * 0.3))
      const ry = n(h / 2)
      return {
        d: `M${rx} 0H${n(w - rx)}A${rx} ${ry} 0 0 1 ${n(w - rx)} ${n(h)}H${rx}A${rx} ${ry} 0 0 1 ${rx} 0Z`,
        extra: `M${n(w - rx)} 0A${rx} ${ry} 0 0 0 ${n(w - rx)} ${n(h)}`,
        fillable: true,
      }
    }
    case 'server': {
      const r = n(mn * 0.08)
      const dots = [1, 3, 5].map((k) => `M${n(w * 0.12)} ${n((h * k) / 6)}h${n(Math.max(1, w * 0.06))}`).join('')
      return {
        d: `M${r} 0H${n(w - r)}Q${n(w)} 0 ${n(w)} ${r}V${n(h - r)}Q${n(w)} ${n(h)} ${n(w - r)} ${n(h)}H${r}Q0 ${n(h)} 0 ${n(h - r)}V${r}Q0 0 ${r} 0Z`,
        extra: `M0 ${n(h / 3)}H${n(w)}M0 ${n((2 * h) / 3)}H${n(w)}${dots}`,
        fillable: true,
      }
    }
    case 'component': {
      const bw = n(Math.min(w * 0.18, 18 + width))
      const bh = n(Math.min(h * 0.16, 10 + width))
      const x0 = n(-bw / 2)
      return {
        d: `M0 0H${n(w)}V${n(h)}H0Z`,
        extra: `M${x0} ${n(h * 0.25)}h${bw}v${bh}h${n(-bw)}ZM${x0} ${n(h * 0.6)}h${bw}v${bh}h${n(-bw)}Z`,
        fillable: true,
      }
    }
    case 'cloud': {
      // five bumps around the box
      return {
        d: `M${n(w * 0.25)} ${n(h * 0.85)}C${n(w * 0.02)} ${n(h * 0.88)} ${n(-w * 0.02)} ${n(h * 0.5)} ${n(w * 0.2)} ${n(h * 0.45)}C${n(w * 0.15)} ${n(h * 0.12)} ${n(w * 0.45)} ${n(-h * 0.02)} ${n(w * 0.55)} ${n(h * 0.22)}C${n(w * 0.68)} ${n(h * 0.02)} ${n(w * 0.95)} ${n(h * 0.12)} ${n(w * 0.85)} ${n(h * 0.42)}C${n(w * 1.05)} ${n(h * 0.5)} ${n(w * 1.02)} ${n(h * 0.88)} ${n(w * 0.78)} ${n(h * 0.85)}Z`,
        fillable: true,
      }
    }
    case 'actor': {
      const r = n(Math.min(w * 0.22, h * 0.13))
      const cx = n(w / 2)
      const neck = n(r * 2)
      const hip = n(h * 0.62)
      return {
        d: `M${cx} 0A${r} ${r} 0 1 0 ${cx} ${neck}A${r} ${r} 0 1 0 ${cx} 0Z`,
        extra: `M${cx} ${neck}V${hip}M${n(w * 0.08)} ${n(h * 0.34)}H${n(w * 0.92)}M${cx} ${hip}L${n(w * 0.12)} ${n(h)}M${cx} ${hip}L${n(w * 0.88)} ${n(h)}`,
        fillable: true,
      }
    }
    case 'line':
    case 'arrow':
    case 'arrow2': {
      const d = `M0 0L${n(w)} ${n(h)}`
      if (kind === 'line') return { d, fillable: false }
      const len = Math.hypot(w, h) || 1
      const hl = Math.max(8, width * 4)
      const ux = w / len
      const uy = h / len
      const head = (tx: number, ty: number, dx: number, dy: number) =>
        `M${n(tx - dx * hl - dy * hl * 0.55)} ${n(ty - dy * hl + dx * hl * 0.55)}L${n(tx)} ${n(ty)}L${n(tx - dx * hl + dy * hl * 0.55)} ${n(ty - dy * hl - dx * hl * 0.55)}`
      return { d, head: head(w, h, ux, uy) + (kind === 'arrow2' ? head(0, 0, -ux, -uy) : ''), fillable: false }
    }
  }
}
