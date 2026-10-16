import { describe, expect, it } from 'vitest'
import { boardBox, fitView, hitsItem, isBoard, isDarkPaper, newBoard, parseBoard, serializeBoard, type InkItem } from '../src/shared/whiteboard'

const ink = (pts: number[], size = 4): InkItem => ({ id: 'a', type: 'ink', pts, color: '#000', size, opacity: 1, streamline: 0.5, smoothing: 0.5, thinning: 0.5, pen: false })

describe('whiteboard', () => {
  it('files', () => {
    expect(isBoard('a/Схема.qboard')).toBe(true)
    expect(isBoard('a/Схема.md')).toBe(false)
  })
  it('an empty or broken file is a new board; bad items are dropped', () => {
    expect(parseBoard('')).toEqual(newBoard())
    expect(parseBoard('{oops')).toEqual(newBoard())
    const b = parseBoard(JSON.stringify({ bg: { grid: 'hex', step: 1000 }, items: [{ type: 'ink', pts: [1, 2] }, { type: 'x' }, { type: 'ink', pts: [0, 0, 0.5, 10, 10, 0.5, 7] }] }))
    expect(b.bg.grid).toBe('dots')
    expect(b.bg.step).toBe(200)
    expect(b.items).toHaveLength(1)
    expect((b.items[0] as InkItem).pts).toEqual([0, 0, 0.5, 10, 10, 0.5])
  })
  it('round trip, points rounded', () => {
    const b = newBoard()
    b.items.push(ink([1.234, 5.678, 0.4567, 2, 3, 1]))
    const back = parseBoard(serializeBoard(b))
    expect((back.items[0] as InkItem).pts).toEqual([1.2, 5.7, 0.46, 2, 3, 1])
    expect(back.bg).toEqual(b.bg)
  })
  it('the eraser touches a line near its segment, not far away', () => {
    const i = ink([0, 0, 0.5, 100, 0, 0.5], 4)
    expect(hitsItem(i, 50, 5, 4)).toBe(true)
    expect(hitsItem(i, 50, 20, 4)).toBe(false)
    expect(hitsItem(i, 130, 0, 4)).toBe(false)
  })
  it('bounds and the fitting view', () => {
    const box = boardBox([ink([0, 0, 0.5, 100, 50, 0.5], 2)])!
    expect(box).toEqual({ x0: -2, y0: -2, x1: 102, y1: 52 })
    const v = fitView(box, 1000, 600, 40)
    // centred
    expect(v.x + 500 / v.z).toBeCloseTo(50, 6)
    expect(v.y + 300 / v.z).toBeCloseTo(25, 6)
    expect(fitView(undefined, 800, 600)).toEqual({ x: -400, y: -300, z: 1 })
  })
  it('dark paper', () => {
    expect(isDarkPaper('#0f1117')).toBe(true)
    expect(isDarkPaper('#ffffff')).toBe(false)
  })
})

import { eraseInk } from '../src/shared/whiteboard'

describe('the partial eraser', () => {
  const line = ink([0, 0, 0.5, 100, 0, 0.5], 2)
  it('cuts the middle out: two pieces, cut where the circle (plus half the width) starts and ends', () => {
    const parts = eraseInk(line, 50, 0, 9)
    expect(parts).toHaveLength(2)
    const [a, b] = parts
    expect(a.pts[0]).toBe(0)
    expect(a.pts[a.pts.length - 3]).toBeCloseTo(40, 6)
    expect(b.pts[0]).toBeCloseTo(60, 6)
    expect(b.pts[b.pts.length - 3]).toBe(100)
    expect(a.id).not.toBe(b.id)
  })
  it('the end: one piece; far away: untouched; all of it: nothing', () => {
    expect(eraseInk(line, 100, 0, 9)).toHaveLength(1)
    expect(eraseInk(line, 100, 0, 9)[0].pts.at(-3)).toBeCloseTo(90, 6)
    expect(eraseInk(line, 50, 40, 9)).toEqual([line])
    expect(eraseInk(line, 50, 0, 80)).toEqual([])
  })
  it('crumbs are dropped', () => {
    expect(eraseInk(line, 1.5, 0, 0.1)).toHaveLength(1)
  })
})

import { apply, inFrame, itemBox, rotateAbout, scaleAbout, transformItem, translate, type TextItem } from '../src/shared/whiteboard'

describe('the selection', () => {
  it('moves, scales (widths too), turns', () => {
    const l = ink([0, 0, 0.5, 10, 0, 0.5], 2)
    expect(transformItem(l, translate(5, 7)).pts).toEqual([5, 7, 0.5, 15, 7, 0.5])
    const big = transformItem(l, scaleAbout(2, 0, 0))
    expect(big.pts).toEqual([0, 0, 0.5, 20, 0, 0.5])
    expect(big.size).toBe(4)
    // 90° clockwise about the origin: x → y
    const [x, y] = apply(rotateAbout(90, 0, 0), 10, 0)
    expect(x).toBeCloseTo(0, 9)
    expect(y).toBeCloseTo(10, 9)
  })
  it('a text turns with it, and its box follows', () => {
    const t: TextItem = { id: 't', type: 'text', x: 0, y: 0, text: 'a', size: 10, color: '#000', w: 20, h: 10 }
    const r = transformItem(t, rotateAbout(90, 0, 0))
    expect(r.rot).toBe(90)
    const b = itemBox(r)
    expect(b.x0).toBeCloseTo(-10, 6)
    expect(b.x1).toBeCloseTo(0, 6)
    expect(b.y1).toBeCloseTo(20, 6)
    expect(transformItem(r, rotateAbout(-90, 0, 0)).rot).toBeUndefined()
  })
  it('the frame catches a line by any point', () => {
    const l = ink([0, 0, 0.5, 100, 0, 0.5], 2)
    expect(inFrame(l, { x0: 90, y0: -5, x1: 120, y1: 5 })).toBe(true)
    expect(inFrame(l, { x0: 40, y0: 10, x1: 60, y1: 20 })).toBe(false)
  })
})

import { shapeD, SHAPES, type ShapeItem } from '../src/shared/whiteboard'

describe('shapes', () => {
  const box: ShapeItem = { id: 's', type: 'shape', kind: 'rect', x: 0, y: 0, w: 100, h: 50, color: '#000', width: 2 }
  it('every kind has an outline', () => {
    for (const s of SHAPES) expect(shapeD(s.kind, 100, 60).d.length).toBeGreaterThan(5)
  })
  it('select hits inside; the eraser only near the outline of an unfilled one', () => {
    expect(hitsItem(box, 50, 25, 2)).toBe(true)
    expect(hitsItem(box, 50, 25, 2, false)).toBe(false)
    expect(hitsItem(box, 50, 1, 2, false)).toBe(true)
    expect(hitsItem({ ...box, fill: '#fff' }, 50, 25, 2, false)).toBe(true)
  })
  it('a line is hit along its segment', () => {
    const l: ShapeItem = { ...box, kind: 'arrow', x: 0, y: 0, w: 100, h: 0 }
    expect(hitsItem(l, 50, 2, 2)).toBe(true)
    expect(hitsItem(l, 50, 30, 2)).toBe(false)
  })
  it('turning a box turns it around its centre; a line turns its ends', () => {
    const r = transformItem(box, rotateAbout(90, 50, 25))
    expect(r.rot).toBe(90)
    expect(r.x).toBeCloseTo(0, 6)
    expect(r.y).toBeCloseTo(0, 6)
    const b = itemBox(r)
    expect(b.x1 - b.x0).toBeCloseTo(52, 6)
    const l = transformItem({ ...box, kind: 'line' as const, w: 100, h: 0 }, rotateAbout(90, 0, 0))
    expect(l.w).toBeCloseTo(0, 6)
    expect(l.h).toBeCloseTo(100, 6)
    expect(l.rot).toBeUndefined()
  })
  it('round trip', () => {
    const b = newBoard()
    b.items.push({ ...box, rot: 30, fill: '#ff000033', dash: true })
    expect(parseBoard(serializeBoard(b)).items[0]).toEqual(b.items[0])
  })
})
