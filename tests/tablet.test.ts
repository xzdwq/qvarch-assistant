import { describe, expect, it } from 'vitest'
import { activeArea, clampPrefs, DEFAULT_TABLET, mapToScreen, monitorsBounds, pressureCurve, rotate } from '../src/shared/tablet'

describe('tablet', () => {
  it('rotation keeps the corners where a turned tablet has them', () => {
    // turned clockwise: the raw top-left is now the top-right
    expect(rotate(0, 0, 90)).toEqual([1, 0])
    expect(rotate(0, 0, 180)).toEqual([1, 1])
    expect(rotate(0, 0, 270)).toEqual([0, 1])
    expect(rotate(0.25, 0.5, 0)).toEqual([0.25, 0.5])
  })
  it('the area is cropped to the screen proportions, centred', () => {
    // 1.6 tablet on a 16:9 screen → full width, a band of the height
    const [x0, y0, x1, y1] = activeArea(0, true, 1920, 1080)
    expect(x0).toBe(0)
    expect(x1).toBe(1)
    expect(y0).toBeCloseTo((1 - 1.6004 / 1.7778) / 2, 3)
    expect(y1).toBeCloseTo(1 - y0, 6)
    // a tall window → a band of the width
    const [a0, , a1] = activeArea(0, true, 800, 1000)
    expect(a1 - a0).toBeCloseTo(0.8 / 1.6004, 3)
    expect(activeArea(0, false, 800, 1000)).toEqual([0, 0, 1, 1])
  })
  it('maps into the target, the left monitor has negative coordinates', () => {
    const left = { x: -1920, y: 200, w: 1920, h: 1080 }
    const p = { rotation: 0 as const, keepAspect: false }
    expect(mapToScreen(0, 0, p, left)).toEqual([-1920, 200])
    expect(mapToScreen(1, 1, p, left)).toEqual([-1, 1279])
    // outside the cropped band → the edge, not past it
    const [, y] = mapToScreen(0.5, 0, { rotation: 0, keepAspect: true }, { x: 0, y: 0, w: 1920, h: 1080 })
    expect(y).toBe(0)
  })
  it('pressure: dead zone, saturation, curve', () => {
    const p = { pmin: 0.1, pmax: 0.6, curve: 0 }
    expect(pressureCurve(0.05, p)).toBe(0)
    expect(pressureCurve(0.35, p)).toBeCloseTo(0.5, 6)
    expect(pressureCurve(0.9, p)).toBe(1)
    expect(pressureCurve(0.35, { ...p, curve: 1 })).toBeLessThan(0.5)
    expect(pressureCurve(0.35, { ...p, curve: -1 })).toBeGreaterThan(0.5)
  })
  it('settings are sanitised', () => {
    expect(clampPrefs({})).toEqual(DEFAULT_TABLET)
    const c = clampPrefs({ rotation: 45 as never, click: 5, pmin: 0.4, pmax: 0.3, button1: 'x' as never, target: { kind: 'window' } })
    expect(c.rotation).toBe(0)
    expect(c.click).toBe(0.6)
    expect(c.pmax).toBeGreaterThan(c.pmin)
    expect(c.button1).toBe('right')
    expect(c.target).toEqual({ kind: 'window' })
  })
  it('the union of the monitors', () => {
    expect(monitorsBounds([{ name: 'a', x: -1920, y: 0, w: 1920, h: 1080, primary: false }, { name: 'b', x: 0, y: 0, w: 3840, h: 2160, primary: true }])).toEqual({ x: -1920, y: 0, w: 5760, h: 2160 })
  })
})

import { comboOf, comboToVk } from '../src/shared/tablet'

describe('express keys', () => {
  it('combinations → virtual keys, modifiers first', () => {
    expect(comboToVk('Ctrl+Z')).toEqual([0x11, 0x5a])
    expect(comboToVk('Space')).toEqual([0x20])
    expect(comboToVk('Alt')).toEqual([0x12])
    expect(comboToVk('Ctrl+=')).toEqual([0x11, 0xbb])
    expect(comboToVk('Ctrl+Shift+F5')).toEqual([0x11, 0x10, 0x74])
    expect(comboToVk('Ctrl+Q+W')).toBeUndefined()
    expect(comboToVk('Ctrl+Привет')).toBeUndefined()
  })
  it('a keydown → its name, by the physical key', () => {
    expect(comboOf({ code: 'KeyZ', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })).toBe('Ctrl+Z')
    expect(comboOf({ code: 'Equal', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })).toBe('Ctrl+=')
    expect(comboOf({ code: 'AltLeft', ctrlKey: false, shiftKey: false, altKey: true, metaKey: false })).toBe('Alt')
    expect(comboOf({ code: 'ArrowUp', ctrlKey: false, shiftKey: true, altKey: false, metaKey: false })).toBe('Shift+Up')
  })
  it('the defaults are valid combinations', () => {
    for (const k of clampPrefs({}).keys) expect(k === '' || comboToVk(k) !== undefined).toBe(true)
  })
})
