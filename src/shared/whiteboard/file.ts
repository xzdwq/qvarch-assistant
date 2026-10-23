import { DEFAULT_BG, DEFAULT_INK, GRID_KINDS, isLineKind, itemId, newBoard, SHAPES, type Board, type BoardBg, type BoardItem, type BoardItemType, type GridKind, type ImageItem, type InkItem, type ShapeItem, type TextItem } from './model'

/** The board's file: parsing (lenient — whatever is broken falls back or is dropped) and writing. */

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d)
/** A turn kept only when it turns something (0 / 360 — none). */
const turn = (rot: unknown) => (typeof rot === 'number' && Number.isFinite(rot) && rot % 360 !== 0 ? { rot: rot % 360 } : {})
const IMAGE_SRC = /^\.images\/[\w.-]+\.(?:png|jpe?g|gif|webp|bmp)$/i

/** Each item type's reader: a raw item → a valid one (undefined — dropped). */
const ITEM_READERS: { [K in BoardItemType]: (raw: Partial<Extract<BoardItem, { type: K }>>) => BoardItem | undefined } = {
  image: (im: Partial<ImageItem>) => {
    if (typeof im.src !== 'string' || !IMAGE_SRC.test(im.src)) return undefined
    return {
      id: str(im.id, itemId()),
      type: 'image',
      x: num(im.x, -1e7, 1e7, 0),
      y: num(im.y, -1e7, 1e7, 0),
      w: num(im.w, 1, 1e7, 100),
      h: num(im.h, 1, 1e7, 100),
      src: im.src,
      ...turn(im.rot),
    }
  },
  shape: (sh: Partial<ShapeItem>) => {
    if (!SHAPES.some((x) => x.kind === sh.kind)) return undefined
    const line = isLineKind(sh.kind!)
    return {
      id: str(sh.id, itemId()),
      type: 'shape',
      kind: sh.kind!,
      x: num(sh.x, -1e7, 1e7, 0),
      y: num(sh.y, -1e7, 1e7, 0),
      w: num(sh.w, line ? -1e7 : 1, 1e7, 10),
      h: num(sh.h, line ? -1e7 : 1, 1e7, 10),
      color: str(sh.color, DEFAULT_INK),
      width: num(sh.width, 0.2, 100, 2),
      ...(line ? {} : turn(sh.rot)),
      ...(typeof sh.fill === 'string' && sh.fill ? { fill: sh.fill } : {}),
      ...(sh.dash ? { dash: true } : {}),
    }
  },
  text: (t: Partial<TextItem>) => {
    if (typeof t.text !== 'string' || !t.text.trim()) return undefined
    return {
      id: str(t.id, itemId()),
      type: 'text',
      x: num(t.x, -1e7, 1e7, 0),
      y: num(t.y, -1e7, 1e7, 0),
      text: t.text,
      size: num(t.size, 4, 400, 20),
      color: str(t.color, DEFAULT_INK),
      w: num(t.w, 1, 1e6, 10),
      h: num(t.h, 1, 1e6, 10),
      ...turn(t.rot),
    }
  },
  ink: (i: Partial<InkItem>) => {
    if (!Array.isArray(i.pts) || i.pts.length < 3) return undefined
    const pts = i.pts.filter((n) => typeof n === 'number' && Number.isFinite(n))
    if (pts.length < 3) return undefined
    return {
      id: str(i.id, itemId()),
      type: 'ink',
      marker: !!i.marker,
      pts: pts.slice(0, pts.length - (pts.length % 3)),
      color: str(i.color, DEFAULT_INK),
      size: num(i.size, 0.2, 400, 4),
      opacity: num(i.opacity, 0.05, 1, 1),
      streamline: num(i.streamline, 0, 0.95, 0.5),
      smoothing: num(i.smoothing, 0, 1, 0.5),
      thinning: num(i.thinning, -0.9, 0.9, 0.5),
      pen: !!i.pen,
      ...(typeof i.gradient === 'string' && i.gradient ? { gradient: i.gradient } : {}),
      ...(typeof i.nib === 'number' && Number.isFinite(i.nib) ? { nib: ((i.nib % 180) + 180) % 180 } : {}),
    }
  },
}

/** One raw item → a valid one, by its type's reader (an unknown type — dropped). */
function readItem(raw: unknown): BoardItem | undefined {
  const type = (raw as { type?: unknown } | null | undefined)?.type
  if (typeof type !== 'string' || !Object.hasOwn(ITEM_READERS, type)) return undefined
  const read = ITEM_READERS[type as BoardItemType] as (r: unknown) => BoardItem | undefined
  return read(raw)
}

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
    grid: GRID_KINDS.includes(bg.grid as GridKind) ? (bg.grid as GridKind) : DEFAULT_BG.grid,
    step: num(bg.step, 6, 200, DEFAULT_BG.step),
    opacity: num(bg.opacity, 0, 1, DEFAULT_BG.opacity),
    major: Math.round(num(bg.major, 0, 20, DEFAULT_BG.major)),
    ...(bg.texture === 'paper' ? { texture: 'paper' as const } : {}),
  }
  for (const it of Array.isArray(r.items) ? r.items : []) {
    const item = readItem(it)
    if (item) b.items.push(item)
  }
  return b
}

/** A board → its file (points rounded: coordinates to 0.1, pressure to 0.01 — the file stays small). */
export function serializeBoard(b: Board): string {
  const items = b.items.map((i) => (i.type === 'ink' ? { ...i, pts: i.pts.map((n, k) => (k % 3 === 2 ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10)) } : i))
  return JSON.stringify({ v: 1, bg: b.bg, items })
}
