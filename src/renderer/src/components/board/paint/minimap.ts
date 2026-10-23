import { boardBox, mapLayout, type Board, type BoardItem, type Box, type MapFit, type View } from '@shared/whiteboard'
import type { BoardPainter } from './boardPainter'
import { accentColor } from './paintLive'

/** The minimap's size (CSS px) and margin. */
export const MM_W = 200
export const MM_H = 130
const MM_PAD = 8

/** The minimap painted: the board's items, the view's rectangle over them. Returns its map (to turn a click into a place). */
export function paintMinimap(c: HTMLCanvasElement, painter: BoardPainter, board: Board, items: BoardItem[], v: View, w: number, h: number): MapFit {
  const vb: Box = { x0: v.x, y0: v.y, x1: v.x + w / v.z, y1: v.y + h / v.z }
  const { box, map } = mapLayout(vb, boardBox(items), MM_W, MM_H, MM_PAD)
  const d = devicePixelRatio
  const g = c.getContext('2d')!
  g.setTransform(d, 0, 0, d, 0, 0)
  g.fillStyle = board.bg.color
  g.fillRect(0, 0, MM_W, MM_H)
  g.setTransform(d * map.k, 0, 0, d * map.k, d * map.x, d * map.y)
  painter.drawItems(g, items, { x: box.x0, y: box.y0, z: 1 }, box.x1 - box.x0, box.y1 - box.y0)
  g.setTransform(d, 0, 0, d, 0, 0)
  g.strokeStyle = accentColor()
  g.lineWidth = 1.5
  g.fillStyle = accentColor(0.12)
  const rx = vb.x0 * map.k + map.x
  const ry = vb.y0 * map.k + map.y
  g.fillRect(rx, ry, (vb.x1 - vb.x0) * map.k, (vb.y1 - vb.y0) * map.k)
  g.strokeRect(rx, ry, (vb.x1 - vb.x0) * map.k, (vb.y1 - vb.y0) * map.k)
  return map
}
