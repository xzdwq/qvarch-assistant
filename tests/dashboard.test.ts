import { describe, expect, it } from 'vitest'
import { addWidget, arrange, resizeWidget, type Widget } from '../src/shared/dashboard'

const W = (i: string, x: number, y: number, w: number, h: number): Widget => ({ i, type: 'notes', x, y, w, h })

describe('dashboard grid', () => {
  it('pushes covered widgets down and floats everything up', () => {
    const out = arrange([W('a', 0, 0, 6, 4), W('b', 6, 0, 6, 4), W('c', 0, 4, 12, 3)], 'c')
    // c moved to the top? no — it stays where put (y 4); nothing overlaps, all float to the top rows
    expect(out.map((w) => [w.i, w.x, w.y])).toEqual([['a', 0, 0], ['b', 6, 0], ['c', 0, 4]])
    const moved = arrange([W('a', 0, 0, 6, 4), W('b', 6, 0, 6, 4), { ...W('c', 0, 0, 12, 3) }], 'c')
    expect(moved.find((w) => w.i === 'c')!.y).toBe(0)
    expect(moved.find((w) => w.i === 'a')!.y).toBe(3)
    expect(moved.find((w) => w.i === 'b')!.y).toBe(3)
  })
  it('a new widget takes the first free spot', () => {
    const out = addWidget([W('a', 0, 0, 6, 4)], 'orb', 'n')
    expect(out.find((w) => w.i === 'n')).toMatchObject({ x: 6, y: 0 })
  })
  it('a widget growing sideways makes its neighbour narrower, then pushes it below', () => {
    const list = [W('a', 0, 0, 6, 4), W('b', 6, 0, 6, 4)]
    const grown = resizeWidget(list, 'a', 'r', 2, 0)
    expect(grown.find((w) => w.i === 'a')).toMatchObject({ x: 0, w: 8 })
    expect(grown.find((w) => w.i === 'b')).toMatchObject({ x: 8, y: 0, w: 4 })
    const wide = resizeWidget(list, 'a', 'r', 5, 0)
    expect(wide.find((w) => w.i === 'a')).toMatchObject({ w: 11 })
    expect(wide.find((w) => w.i === 'b')).toMatchObject({ y: 4 })
    const left = resizeWidget(list, 'b', 'l', -2, 0)
    expect(left.find((w) => w.i === 'b')).toMatchObject({ x: 4, w: 8 })
    expect(left.find((w) => w.i === 'a')).toMatchObject({ x: 0, w: 4 })
  })
  it('keeps widgets inside the grid', () => {
    const out = arrange([W('a', 10, 0, 6, 4)])
    expect(out[0].x + out[0].w).toBeLessThanOrEqual(12)
  })
})
