import { describe, expect, it } from 'vitest'
import {
  centredOn,
  clickedShape,
  draftShape,
  handleAt,
  handlesOf,
  inBox,
  mapLayout,
  mapToWorld,
  parseView,
  ROT_OFF,
  scaleAnchor,
  selectionCursor,
  snapColor,
  snapStroke,
  straightPieces,
  toScreen,
  toWorld,
  zoomAround,
  ZOOM_MAX,
  ZOOM_MIN,
  type Box,
  type ShapeItem,
  type ShapeStyle,
  type View,
} from '../../src/shared/whiteboard'

/** The board's editing rules: the view, the selection's handles, drafting shapes, snapping a held stroke. */

describe('board view', () => {
  const v: View = { x: 100, y: 50, z: 2 }
  it('screen and world are inverse', () => {
    const [wx, wy] = toWorld(v, 30, 40)
    expect([wx, wy]).toEqual([115, 70])
    expect(toScreen(v, wx, wy)).toEqual([30, 40])
  })
  it('zooming keeps the point under the pointer, within the limits', () => {
    const z = zoomAround(v, 1.5, 80, 60)
    expect(toWorld(z, 80, 60)).toEqual(toWorld(v, 80, 60))
    expect(z.z).toBe(3)
    expect(zoomAround(v, 100, 0, 0).z).toBe(ZOOM_MAX)
    expect(zoomAround(v, 0.0001, 0, 0).z).toBe(ZOOM_MIN)
  })
  it('centred on a point', () => {
    const c = centredOn(500, 300, 2, 400, 200)
    expect(toWorld(c, 200, 100)).toEqual([500, 300])
  })
  it('a saved view: only a whole one', () => {
    expect(parseView('{"x":1,"y":2,"z":0.5}')).toEqual({ x: 1, y: 2, z: 0.5 })
    expect(parseView('{"x":1,"y":2}')).toBeUndefined()
    expect(parseView('nope')).toBeUndefined()
    expect(parseView(null)).toBeUndefined()
  })
  it('the map fits the drawing and the view together, centred', () => {
    const view: Box = { x0: 0, y0: 0, x1: 100, y1: 50 }
    const content: Box = { x0: -100, y0: 0, x1: 0, y1: 50 }
    const { box, map } = mapLayout(view, content, 200, 130, 8)
    expect(box).toEqual({ x0: -100, y0: 0, x1: 100, y1: 50 })
    expect(map.k).toBeCloseTo(184 / 200, 9)
    // the box's middle lands in the map's middle
    const [mx, my] = mapToWorld(map, 100, 65)
    expect(mx).toBeCloseTo(0, 9)
    expect(my).toBeCloseTo(25, 9)
    expect(mapLayout(view, undefined, 200, 130, 8).box).toEqual(view)
  })
})

describe('selection handles', () => {
  const b: Box = { x0: 10, y0: 20, x1: 110, y1: 70 }
  const id = (x: number, y: number) => [x, y] as const
  it('four corners and the turning knob above the middle', () => {
    const hs = handlesOf(b, id)
    expect(hs.map((h) => h.h)).toEqual(['tl', 'tr', 'bl', 'br', 'rot'])
    expect(hs[4]).toEqual({ h: 'rot', x: 60, y: 20 - ROT_OFF })
  })
  it('a handle is caught within 8 px', () => {
    expect(handleAt(b, id, 115, 75)).toBe('br')
    expect(handleAt(b, id, 120, 80)).toBeUndefined()
    expect(handleAt(b, id, 60, 20 - ROT_OFF + 3)).toBe('rot')
  })
  it('scaling keeps the opposite corner', () => {
    expect(scaleAnchor('tl', b)).toEqual([110, 70])
    expect(scaleAnchor('br', b)).toEqual([10, 20])
    expect(scaleAnchor('tr', b)).toEqual([10, 70])
    expect(scaleAnchor('bl', b)).toEqual([110, 20])
  })
  it('cursors', () => {
    expect(selectionCursor('rot', false)).toBe('grab')
    expect(selectionCursor('tl', true)).toBe('nwse-resize')
    expect(selectionCursor('tr', true)).toBe('nesw-resize')
    expect(selectionCursor(undefined, true)).toBe('move')
    expect(selectionCursor(undefined, false)).toBe('default')
    expect(inBox(b, 10, 70)).toBe(true)
    expect(inBox(b, 9, 70)).toBe(false)
  })
})

describe('drafting shapes', () => {
  const st: ShapeStyle = { kind: 'rect', color: '#112233', width: 2, fill: false, dash: false }
  it('a box from any corner to any corner', () => {
    const s = draftShape(100, 100, 40, 70, false, st)
    expect([s.x, s.y, s.w, s.h]).toEqual([40, 70, 60, 30])
    expect(s.fill).toBeUndefined()
    expect(s.dash).toBeUndefined()
  })
  it('Shift: a square; filled — the colour see-through; dashed', () => {
    const s = draftShape(0, 0, 30, -10, true, { ...st, fill: true, dash: true })
    expect([s.x, s.y, s.w, s.h]).toEqual([0, -30, 30, 30])
    expect(s.fill).toBe('#11223330')
    expect(s.dash).toBe(true)
  })
  it('a line keeps its direction; Shift — in 45° steps', () => {
    const l = draftShape(10, 10, 0, 30, false, { ...st, kind: 'arrow' })
    expect([l.x, l.y, l.w, l.h]).toEqual([10, 10, -10, 20])
    const d = draftShape(0, 0, 100, 10, true, { ...st, kind: 'line' })
    expect(d.h).toBeCloseTo(0, 9)
    expect(d.w).toBeCloseTo(Math.hypot(100, 10), 9)
  })
  it('a click without a drag: the usual size around it', () => {
    const z = 2
    const box = clickedShape(draftShape(50, 50, 50.5, 50.5, false, st), z)
    expect([box.x, box.y, box.w, box.h]).toEqual([-20, 5, 140, 90])
    const line = clickedShape(draftShape(50, 50, 50, 50, false, { ...st, kind: 'line' }), z)
    expect([line.x, line.y, line.w, line.h]).toEqual([50, 50, 160, 0])
    const dragged = draftShape(0, 0, 20, 20, false, st)
    expect(clickedShape(dragged, z)).toBe(dragged)
  })
})

describe('snapping a held stroke', () => {
  const pts = [
    [0, 0, 0.2],
    [10, 0, 0.6],
  ]
  it('the colour: plain; through a gradient at the mean pressure; the opacity as alpha', () => {
    expect(snapColor({ color: '#ff0000', opacity: 1 }, pts)).toBe('#ff0000')
    expect(snapColor({ color: '#000000', gradient: '#ffffff', opacity: 1 }, pts)).toBe('#666666')
    expect(snapColor({ color: '#00ff00', opacity: 0.5 }, pts)).toBe('#00ff0080')
  })
  it('straight pieces: evenly apart, one pressure, the last corner kept', () => {
    const out = straightPieces([[0, 0], [10, 0], [10, 5]], 0.4, 2.5)
    expect(out[0]).toEqual([0, 0, 0.4])
    expect(out.at(-1)).toEqual([10, 5, 0.4])
    expect(out).toHaveLength(4 + 2 + 1)
    expect(out.every((p) => p[2] === 0.4)).toBe(true)
  })
  const style = { color: '#000000', opacity: 1, size: 4 }
  it('a shape: its box, its name; equal sides — a circle / a square', () => {
    const r = snapStroke({ type: 'shape', kind: 'ellipse', cx: 50, cy: 40, w: 20, h: 20, rot: 0 }, pts, style, 1)
    expect('shape' in r && [r.shape.x, r.shape.y, r.shape.w, r.shape.width]).toEqual([40, 30, 20, 2.8])
    expect(r.hint).toBe('Круг')
    expect(snapStroke({ type: 'shape', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rot: 12.34 }, pts, style, 1).hint).toBe('Прямоугольник')
    const turned = snapStroke({ type: 'shape', kind: 'diamond', cx: 0, cy: 0, w: 20, h: 10, rot: 12.34 }, pts, style, 1)
    expect('shape' in turned && (turned.shape as ShapeItem).rot).toBe(12.3)
  })
  it('a line; a polygon / a polyline — straight pieces', () => {
    const l = snapStroke({ type: 'line', x0: 1, y0: 2, x1: 11, y1: 2 }, pts, style, 1)
    expect('shape' in l && [l.shape.kind, l.shape.w, l.shape.h]).toEqual(['line', 10, 0])
    const tri = snapStroke({ type: 'poly', pts: [[0, 0], [10, 0], [0, 10]], closed: true }, pts, style, 1)
    expect(tri.hint).toBe('Треугольник')
    expect('pts' in tri && tri.pts.at(-1)).toEqual([0, 0, 0.4])
    expect(snapStroke({ type: 'poly', pts: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true }, pts, style, 1).hint).toBe('Многоугольник · 4')
    expect(snapStroke({ type: 'poly', pts: [[0, 0], [10, 0], [10, 10]], closed: false }, pts, style, 1).hint).toBe('Ломаная')
  })
})
