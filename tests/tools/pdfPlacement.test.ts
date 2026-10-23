import { describe, expect, it } from 'vitest'
import { barPosition, clampCentre, newPlacement, pdfImageBox, resizeFromCorner, turnedBy } from '../../src/shared/pdfPlacement'

/** A signature on a PDF page: placing, resizing from a corner, turning, the toolbar, where pdf-lib draws it. */

const corner = (s: { x: number; y: number; w: number; h: number; rot: number }, u: number, v: number) => {
  const a = (s.rot * Math.PI) / 180
  const dx = u * s.w / 2
  const dy = v * s.h / 2
  return [s.x + s.w / 2 + dx * Math.cos(a) - dy * Math.sin(a), s.y + s.h / 2 + dx * Math.sin(a) + dy * Math.cos(a)]
}

describe('placing a signature', () => {
  const page = { w: 600, h: 800, view: [0, 0, 600, 800] }
  it('the centre stays on the page', () => {
    expect(clampCentre(-100, 40, 600)).toBe(-20)
    expect(clampCentre(590, 40, 600)).toBe(580)
    expect(clampCentre(100, 40, 600)).toBe(100)
  })
  it('a new one: 170 pt wide, proportional, centred ¾ down — or where it was dropped, inside the page', () => {
    expect(newPlacement(page, { w: 340, h: 100 })).toEqual({ x: 215, y: 575, w: 170, h: 50 })
    expect(newPlacement(page, { w: 340, h: 100 }, 0, 0)).toEqual({ x: 0, y: 0, w: 170, h: 50 })
    expect(newPlacement({ w: 200, h: 100, view: [] }, { w: 2, h: 1 }).w).toBe(80)
  })
  it('resizing from a corner keeps the opposite one, the proportions too', () => {
    const s = { x: 100, y: 100, w: 100, h: 50, rot: 0 }
    const r = resizeFromCorner(s, 1, 1, 50, 0)
    expect(r).toEqual({ x: 100, y: 100, w: 150, h: 75 })
    const turned = { ...s, rot: 30 }
    const t = resizeFromCorner(turned, 1, 1, 40, 10)
    const before = corner(turned, -1, -1)
    const after = corner({ ...t, rot: 30 }, -1, -1)
    expect(after[0]).toBeCloseTo(before[0], 9)
    expect(after[1]).toBeCloseTo(before[1], 9)
    expect(resizeFromCorner(s, 1, 1, -500, -500).w).toBe(20)
  })
  it('turning: in −180…180, near straight — straight, Shift — 15° steps', () => {
    expect(turnedBy(0, Math.PI / 2, false)).toBe(90)
    expect(turnedBy(170, (30 * Math.PI) / 180, false)).toBe(-160)
    expect(turnedBy(0, (2 * Math.PI) / 180, false)).toBe(0)
    expect(turnedBy(0, (22 * Math.PI) / 180, true)).toBe(15)
  })
  it('the toolbar sits above the turned drawing, centred', () => {
    expect(barPosition({ x: 10, y: 100, w: 40, h: 20, rot: 0 }, 2)).toEqual({ left: '60px', top: '154px' })
    expect(barPosition({ x: 10, y: 100, w: 40, h: 20, rot: 90 }, 1).top).toBe(`${100 + 10 - 20 - 46}px`)
  })
  it('pdf-lib: from the crop box bottom-left, the centre kept when turned', () => {
    const view = [10, 20, 610, 820]
    const flat = pdfImageBox({ x: 50, y: 100, w: 80, h: 40, rot: 0 }, view)
    expect(flat).toEqual({ x: 60, y: 820 - 100 - 40, width: 80, height: 40, rotateDeg: -0 })
    const t = pdfImageBox({ x: 50, y: 100, w: 80, h: 40, rot: 90 }, view)
    // pdf-lib turns around (x, y) counter-clockwise by rotateDeg: the centre lands where the flat one's is
    const a = (t.rotateDeg * Math.PI) / 180
    const cx = t.x + (t.width / 2) * Math.cos(a) - (t.height / 2) * Math.sin(a)
    const cy = t.y + (t.width / 2) * Math.sin(a) + (t.height / 2) * Math.cos(a)
    expect(cx).toBeCloseTo(10 + 50 + 40, 9)
    expect(cy).toBeCloseTo(820 - 100 - 20, 9)
  })
})
