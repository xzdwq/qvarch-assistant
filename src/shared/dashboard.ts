/**
 * The dashboard: widgets on a grid of COLS columns and rows of a fixed height. A widget moved or resized
 * pushes the ones it covers down; then everything floats up into free space — so widgets line up in rows,
 * columns and stacks by themselves.
 */
export const COLS = 60
/** Layouts saved on the old 12-column grid are scaled by this. */
export const OLD_COLS_SCALE = 5

export type WidgetType = 'stats' | 'timeline' | 'entries' | 'notes' | 'calendar' | 'week' | 'tasks' | 'orb' | 'notebook' | 'create' | 'sheet'
export interface Widget {
  i: string
  type: WidgetType
  x: number
  y: number
  w: number
  h: number
}

export const WIDGETS: Array<{ type: WidgetType; label: string; icon: string; w: number; h: number; minW: number; minH: number }> = [
  { type: 'stats', label: 'Итоги дня', icon: 'clock', w: 60, h: 2, minW: 15, minH: 2 },
  { type: 'timeline', label: 'Таймлайн', icon: 'timeline', w: 60, h: 7, minW: 20, minH: 5 },
  { type: 'entries', label: 'Записи дня', icon: 'list', w: 30, h: 7, minW: 15, minH: 3 },
  { type: 'notes', label: 'Заметки дня', icon: 'note', w: 30, h: 7, minW: 15, minH: 3 },
  { type: 'calendar', label: 'Календарь месяца', icon: 'calendar', w: 30, h: 9, minW: 20, minH: 6 },
  { type: 'week', label: 'Календарь задач', icon: 'checkSquare', w: 60, h: 10, minW: 30, minH: 7 },
  { type: 'tasks', label: 'Задачи Jira', icon: 'jira', w: 30, h: 9, minW: 20, minH: 4 },
  { type: 'orb', label: 'Состояние', icon: 'sparkles', w: 15, h: 4, minW: 10, minH: 3 },
  { type: 'notebook', label: 'Блокнот', icon: 'notebook', w: 30, h: 9, minW: 20, minH: 5 },
  { type: 'create', label: 'Новое событие', icon: 'plus', w: 20, h: 7, minW: 15, minH: 6 },
  { type: 'sheet', label: 'Заполнение', icon: 'table', w: 30, h: 7, minW: 20, minH: 4 },
]
export const widgetInfo = (t: WidgetType) => WIDGETS.find((w) => w.type === t)!

export const DEFAULT_DASHBOARD: Widget[] = [
  { i: 'stats', type: 'stats', x: 0, y: 0, w: 60, h: 2 },
  { i: 'timeline', type: 'timeline', x: 0, y: 2, w: 60, h: 7 },
  { i: 'create', type: 'create', x: 0, y: 9, w: 20, h: 7 },
  { i: 'entries', type: 'entries', x: 20, y: 9, w: 20, h: 7 },
  { i: 'notes', type: 'notes', x: 40, y: 9, w: 20, h: 7 },
  { i: 'notebook', type: 'notebook', x: 0, y: 16, w: 40, h: 9 },
  { i: 'orb', type: 'orb', x: 40, y: 16, w: 20, h: 4 },
]

const overlap = (a: Widget, b: Widget) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Keeps a widget inside the grid and above its minimum size. */
export function clampWidget(w: Widget): Widget {
  const info = widgetInfo(w.type)
  const width = Math.max(info?.minW ?? 1, Math.min(COLS, Math.round(w.w)))
  const height = Math.max(info?.minH ?? 1, Math.round(w.h))
  return { ...w, w: width, h: height, x: Math.max(0, Math.min(COLS - width, Math.round(w.x))), y: Math.max(0, Math.round(w.y)) }
}

/**
 * After `movedId` was put somewhere: the widgets it covers go down below it, then everything floats up
 * (the moved one first keeps its place against the ones it pushed).
 */
export function arrange(list: Widget[], movedId?: string): Widget[] {
  const items = list.map(clampWidget)
  const moved = items.find((w) => w.i === movedId)
  const rest = items.filter((w) => w !== moved).sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: Widget[] = moved ? [moved] : []
  for (const w of rest) {
    while (placed.some((p) => overlap(p, w))) w.y++
    placed.push(w)
  }
  // gravity: up into the free space, top to bottom
  const done: Widget[] = []
  for (const w of [...placed].sort((a, b) => a.y - b.y || a.x - b.x)) {
    while (w.y > 0 && !done.some((p) => overlap(p, { ...w, y: w.y - 1 }))) w.y--
    done.push(w)
  }
  return done.sort((a, b) => a.y - b.y || a.x - b.x)
}

/** Which sides of a widget are pulled: "l", "r", "t", "b" or a corner ("tl", "br"…). */
export type Edges = string

/**
 * A widget pulled by its sides by (dx, dy) cells. Growing sideways into a neighbour in the same row makes
 * the neighbour narrower (down to its minimum — then it goes below); growing up takes height from the one above
 * the same way; growing down pushes the ones below.
 */
export function resizeWidget(list: Widget[], id: string, edges: Edges, dx: number, dy: number): Widget[] {
  const orig = list.find((w) => w.i === id)
  if (!orig) return list
  const info = widgetInfo(orig.type)
  let { x, y, w, h } = orig
  if (edges.includes('r')) w = Math.max(info.minW, Math.min(COLS - x, orig.w + dx))
  if (edges.includes('l')) {
    x = Math.max(0, Math.min(orig.x + orig.w - info.minW, orig.x + dx))
    w = orig.x + orig.w - x
  }
  if (edges.includes('b')) h = Math.max(info.minH, orig.h + dy)
  if (edges.includes('t')) {
    y = Math.max(0, Math.min(orig.y + orig.h - info.minH, orig.y + dy))
    h = orig.y + orig.h - y
  }
  const next: Widget = { ...orig, x, y, w, h }
  const others = list
    .filter((o) => o.i !== id)
    .map((o) => {
      if (!overlap(o, next)) return o
      const min = widgetInfo(o.type)
      const sameRow = o.y < orig.y + orig.h && orig.y < o.y + o.h
      const sameCol = o.x < orig.x + orig.w && orig.x < o.x + o.w
      if (sameRow && edges.includes('r') && o.x >= orig.x + orig.w) {
        const nx = next.x + next.w
        if (o.x + o.w - nx >= min.minW) return { ...o, x: nx, w: o.x + o.w - nx }
      }
      if (sameRow && edges.includes('l') && o.x + o.w <= orig.x && next.x - o.x >= min.minW) return { ...o, w: next.x - o.x }
      if (sameCol && edges.includes('t') && o.y + o.h <= orig.y && next.y - o.y >= min.minH) return { ...o, h: next.y - o.y }
      return o
    })
  return arrange([...others, next], id)
}

/** Where a new widget goes: the first free spot from the top, as wide as it likes. */
export function addWidget(list: Widget[], type: WidgetType, id: string): Widget[] {
  const info = widgetInfo(type)
  const w = Math.min(COLS, info.w)
  for (let y = 0; ; y++)
    for (let x = 0; x + w <= COLS; x++) {
      const cand: Widget = { i: id, type, x, y, w, h: info.h }
      if (!list.some((p) => overlap(p, cand))) return arrange([...list, cand], id)
    }
}
