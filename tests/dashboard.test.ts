import { describe, expect, it } from 'vitest'
import { addWidget, arrange, resizeWidget, type Widget } from '../src/shared/dashboard'

const W = (i: string, x: number, y: number, w: number, h: number): Widget => ({ i, type: 'notes', x, y, w, h })

describe('dashboard grid', () => {
  it('pushes covered widgets down and floats everything up', () => {
    const out = arrange([W('a', 0, 0, 30, 4), W('b', 30, 0, 30, 4), W('c', 0, 4, 60, 3)], 'c')
    // c moved to the top? no — it stays where put (y 4); nothing overlaps, all float to the top rows
    expect(out.map((w) => [w.i, w.x, w.y])).toEqual([['a', 0, 0], ['b', 30, 0], ['c', 0, 4]])
    const moved = arrange([W('a', 0, 0, 30, 4), W('b', 30, 0, 30, 4), { ...W('c', 0, 0, 60, 3) }], 'c')
    expect(moved.find((w) => w.i === 'c')!.y).toBe(0)
    expect(moved.find((w) => w.i === 'a')!.y).toBe(3)
    expect(moved.find((w) => w.i === 'b')!.y).toBe(3)
  })
  it('a new widget takes the first free spot', () => {
    const out = addWidget([W('a', 0, 0, 30, 4)], 'orb', 'n')
    expect(out.find((w) => w.i === 'n')).toMatchObject({ x: 30, y: 0 })
  })
  it('a widget growing sideways makes its neighbour narrower, then pushes it below', () => {
    const list = [W('a', 0, 0, 30, 4), W('b', 30, 0, 30, 4)]
    const grown = resizeWidget(list, 'a', 'r', 10, 0)
    expect(grown.find((w) => w.i === 'a')).toMatchObject({ x: 0, w: 40 })
    expect(grown.find((w) => w.i === 'b')).toMatchObject({ x: 40, y: 0, w: 20 })
    const wide = resizeWidget(list, 'a', 'r', 25, 0)
    expect(wide.find((w) => w.i === 'a')).toMatchObject({ w: 55 })
    expect(wide.find((w) => w.i === 'b')).toMatchObject({ y: 4 })
    const left = resizeWidget(list, 'b', 'l', -10, 0)
    expect(left.find((w) => w.i === 'b')).toMatchObject({ x: 20, w: 40 })
    expect(left.find((w) => w.i === 'a')).toMatchObject({ x: 0, w: 20 })
  })
  it('keeps widgets inside the grid', () => {
    const out = arrange([W('a', 50, 0, 30, 4)])
    expect(out[0].x + out[0].w).toBeLessThanOrEqual(60)
  })
})

import { dockFor, nextDock } from '../src/shared/island'
describe('island docking', () => {
  const one = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
  const right = { bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }
  const pill = (x: number, y: number, w = 400, h = 70) => ({ x, y, width: w, height: h })
  it('sticks to the nearest edge within reach', () => {
    expect(dockFor(pill(700, 10), one, [])).toBe('top')
    expect(dockFor(pill(700, 1040 - 70 - 5), one, [])).toBe('bottom')
    expect(dockFor(pill(-30, 400), one, [])).toBe('left')
    expect(dockFor(pill(700, 30), one, [])).toBeUndefined()
    expect(dockFor(pill(700, 400), one, [])).toBeUndefined()
  })
  it('never at an edge another monitor continues', () => {
    // the right edge of the left monitor runs into the right one: no docking there
    expect(dockFor(pill(1920 - 400 - 4, 400), one, [right])).toBeUndefined()
    expect(dockFor(pill(1920 - 400 - 4, 400), one, [])).toBe('right')
    // the left edge of the right monitor too
    expect(dockFor(pill(1920 + 4, 400), right, [one])).toBeUndefined()
  })
})

describe('island docking hysteresis', () => {
  const one = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
  const at = (y: number) => ({ x: 700, y, width: 260, height: 34 })
  it('a stuck pill stays until pulled further than the catch reach', () => {
    expect(nextDock(at(22), one, [], 'top')).toBe('top')
    expect(nextDock(at(22), one, [])).toBeUndefined()
    expect(nextDock(at(30), one, [], 'top')).toBeUndefined()
    expect(nextDock(at(15), one, [])).toBe('top')
  })
})
