import { describe, expect, it } from 'vitest'
import { itemBox, parseBoard, rotateAbout, serializeBoard, transformItem, type ImageItem, type ShapeItem, type TextItem } from '../../src/shared/whiteboard'

/** The board's file readers (one per item type) and the transforms' turn bookkeeping. */

describe('board file readers', () => {
  const read = (items: unknown[]) => parseBoard(JSON.stringify({ items })).items
  it('unknown, broken and null items are dropped', () => {
    expect(read([null, 1, 'x', { type: 'toString' }, { type: 'hasOwnProperty' }, { type: 'text', text: '  ' }])).toEqual([])
  })
  it('a picture: only from the vault images, its turn normalised', () => {
    expect(read([{ type: 'image', src: '../secret.png' }])).toEqual([])
    const [im] = read([{ type: 'image', id: 'p', src: '.images/a.png', x: 1, y: 2, w: 3, h: 4, rot: 370 }]) as ImageItem[]
    expect(im).toEqual({ id: 'p', type: 'image', x: 1, y: 2, w: 3, h: 4, src: '.images/a.png', rot: 10 })
    const [straight] = read([{ type: 'image', src: '.images/a.png', rot: 720 }]) as ImageItem[]
    expect(straight.rot).toBeUndefined()
  })
  it('a shape: a known kind; a line is never turned; fill and dash kept', () => {
    expect(read([{ type: 'shape', kind: 'star' }])).toEqual([])
    const [line] = read([{ type: 'shape', kind: 'arrow', w: -50, h: 20, rot: 30 }]) as ShapeItem[]
    expect([line.w, line.h, line.rot]).toEqual([-50, 20, undefined])
    const [box] = read([{ type: 'shape', kind: 'db', w: -5, rot: 30, fill: '#fff', dash: 1 }]) as ShapeItem[]
    expect([box.w, box.rot, box.fill, box.dash]).toEqual([1, 30, '#fff', true])
  })
  it('a text keeps its words and turn; round trip', () => {
    const [t] = read([{ type: 'text', id: 't', text: 'Привет', x: 5, y: 6, size: 20, color: '#000', w: 50, h: 25, rot: -90 }]) as TextItem[]
    expect(t.rot).toBe(-90)
    expect(parseBoard(serializeBoard({ v: 1, bg: parseBoard('').bg, items: [t] })).items).toEqual([t])
  })
})

describe('board transforms: the turn adds up', () => {
  it('a shape turned twice by 45° — 90°; back to straight — no turn', () => {
    const sh: ShapeItem = { id: 's', type: 'shape', kind: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', width: 2 }
    const once = transformItem(sh, rotateAbout(45, 5, 5))
    const twice = transformItem(once, rotateAbout(45, 5, 5))
    expect(twice.rot).toBe(90)
    expect(transformItem(twice, rotateAbout(-90, 5, 5)).rot).toBeUndefined()
    // the centre stays where it turns around
    const b = itemBox(twice)
    expect((b.x0 + b.x1) / 2).toBeCloseTo(5, 9)
  })
})
