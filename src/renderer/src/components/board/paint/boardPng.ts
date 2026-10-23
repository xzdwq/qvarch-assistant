import { boardBox, type Board } from '@shared/whiteboard'
import type { BoardPainter } from './boardPainter'
import type { PictureCache } from './pictureCache'

/** The margin around the drawing in a PNG (world units). */
const PNG_PAD = 32
/** The PNG's longest side at most (px); up to 2 px per world unit. */
const PNG_MAX_PX = 8000

/**
 * The whole board as a PNG (its pictures loaded first): undefined — the board is empty; null — the canvas gave
 * no image.
 */
export async function renderBoardPng(board: Board, painter: BoardPainter, pictures: PictureCache): Promise<Blob | null | undefined> {
  await Promise.all(board.items.flatMap((i) => (i.type === 'image' ? [pictures.get(i.src).ready] : [])))
  const box = boardBox(board.items)
  if (!box) return undefined
  const w = Math.ceil(box.x1 - box.x0 + PNG_PAD * 2)
  const h = Math.ceil(box.y1 - box.y0 + PNG_PAD * 2)
  const scale = Math.min(2, PNG_MAX_PX / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  painter.paintBoard(c.getContext('2d')!, board, board.items, { x: box.x0 - PNG_PAD, y: box.y0 - PNG_PAD, z: 1 }, w, h, scale)
  return new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
}
