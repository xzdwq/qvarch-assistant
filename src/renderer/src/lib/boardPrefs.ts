import { DEFAULT_BG, newBoard, parseBoard, type Board, type BoardBg } from '@shared/whiteboard'

/** The background of the board used last — a new board starts with it (the tools are shared anyway). */
const KEY = 'qa.board.lastBg'
export function rememberBg(bg: BoardBg): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(bg))
  } catch {
    // not remembered — fine
  }
}
export function freshBoard(): Board {
  const b = newBoard()
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as BoardBg | null
    // through the parser: an old / broken value falls back to the defaults
    if (saved) b.bg = parseBoard(JSON.stringify({ bg: { ...DEFAULT_BG, ...saved }, items: [] })).bg
  } catch {
    // the defaults
  }
  return b
}
