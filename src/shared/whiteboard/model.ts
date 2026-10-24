/**
 * A board (Блокнот → «Доска»): an endless sheet for schemes, notes and process sketches, stored as a `.qboard`
 * file (JSON) next to the notes. Its items: ink (pen / marker / nib), typed text, shapes and pictures, over the
 * background and its grid. Coordinates are the board's own ("world") units — the view (pan / zoom) is not part
 * of the file.
 */

export const BOARD_EXT = '.qboard'
export const isBoard = (path: string) => path.toLowerCase().endsWith(BOARD_EXT)

export const GRID_KINDS = ['none', 'dots', 'lines', 'squares', 'iso'] as const
export type GridKind = (typeof GRID_KINDS)[number]

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

/** Shapes: the basic ones and those of schemes / software architecture (flowchart, UML, C4) — in the menu's order. */
export const SHAPES = [
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
] as const satisfies ReadonlyArray<{ kind: string; label: string; group: 'basic' | 'scheme' }>
export type ShapeKind = (typeof SHAPES)[number]['kind']

/** Lines / arrows: drawn from one end to the other, never turned or filled. */
const LINE_KINDS: ReadonlySet<ShapeKind> = new Set<ShapeKind>(['line', 'arrow', 'arrow2'])
export const isLineKind = (k: ShapeKind) => LINE_KINDS.has(k)

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
export type BoardItemType = BoardItem['type']
/** A box turned around its centre (a shape, a picture). */
export type Boxed = Pick<ShapeItem, 'x' | 'y' | 'w' | 'h' | 'rot'>

/** A new id (not crypto-strong — only to tell items apart). */
export const itemId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export interface Board {
  v: 1
  bg: BoardBg
  items: BoardItem[]
  /** A shared board's document on the server (the same for every participant; kept through every edit). */
  shared?: string
}

/** An axis-aligned box in world units. */
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** The papers offered (their colours — the renderer's CSS, `--board-paper-<id>`). */
export const PAPERS = [
  { id: 'white', label: 'Белая' },
  { id: 'warm', label: 'Тёплая' },
  { id: 'mint', label: 'Мятная' },
  { id: 'slate', label: 'Графит' },
  { id: 'night', label: 'Ночь' },
] as const

/** The ink an item read from a file without its colour gets (the file format's default). */
export const DEFAULT_INK = '#111827'
/** A new board's background (and the file format's default for what is missing). */
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
