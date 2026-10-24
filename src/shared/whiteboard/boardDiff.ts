import type { Board, BoardBg, BoardItem } from './model'

/**
 * What changed between two states of a board, item by item: added or changed items (each with the item it follows,
 * for its place), removed ones, the background. Applied to another state of the board (someone else drew meanwhile)
 * it changes only these items — undo, a gesture finished, a shared board's edit never take others' strokes away.
 */
export interface BoardDiff {
  put: Array<{ item: BoardItem; after: string | null }>
  del: string[]
  bg?: BoardBg
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The difference from `a` to `b`. */
export function diffItems(a: readonly BoardItem[], b: readonly BoardItem[]): Omit<BoardDiff, 'bg'> {
  const was = new Map(a.map((i) => [i.id, i]))
  const now = new Set(b.map((i) => i.id))
  const put: BoardDiff['put'] = []
  b.forEach((item, k) => {
    const old = was.get(item.id)
    if (old === item || (old && same(old, item))) return
    put.push({ item, after: k ? b[k - 1].id : null })
  })
  return { put, del: a.filter((i) => !now.has(i.id)).map((i) => i.id) }
}
export function diffBoards(a: Board, b: Board): BoardDiff {
  return { ...diffItems(a.items, b.items), ...(same(a.bg, b.bg) ? {} : { bg: b.bg }) }
}
export const isEmptyDiff = (d: BoardDiff) => !d.put.length && !d.del.length && !d.bg

/** The items with a difference applied: a changed one in its place, a new one after the item it followed (gone — on top). */
export function applyItems(items: readonly BoardItem[], d: Omit<BoardDiff, 'bg'>): BoardItem[] {
  const gone = new Set(d.del)
  const out = items.filter((i) => !gone.has(i.id))
  for (const { item, after } of d.put) {
    const at = out.findIndex((i) => i.id === item.id)
    if (at >= 0) {
      out[at] = item
      continue
    }
    const prev = after === null ? -1 : out.findIndex((i) => i.id === after)
    if (after !== null && prev < 0) out.push(item)
    else out.splice(prev + 1, 0, item)
  }
  return out
}
export function applyBoardDiff(board: Board, d: BoardDiff): Board {
  return { ...board, items: applyItems(board.items, d), ...(d.bg ? { bg: d.bg } : {}) }
}
