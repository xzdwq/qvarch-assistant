import { describe, expect, it } from 'vitest'
import { DOCK_H, dockHeight, dockShown, termPlaceOf, type TermDockState } from '../../src/shared/terminalDock'

const s = (open: boolean, asked: TermDockState['asked'], sectionShown: boolean): TermDockState => ({ open, asked, sectionShown })

describe('terminal dock', () => {
  it('the panel open — the terminal there', () => {
    expect(dockShown(s(true, 'dock', false))).toBe(true)
    expect(termPlaceOf(s(true, 'dock', false))).toBe('dock')
  })
  it('its section opened after the panel — there; the panel makes way', () => {
    expect(dockShown(s(true, 'section', true))).toBe(false)
    expect(termPlaceOf(s(true, 'section', true))).toBe('section')
  })
  it('the panel asked while its section is on screen — the panel', () => {
    expect(termPlaceOf(s(true, 'dock', true))).toBe('dock')
  })
  it('the section left: a pinned (still open) panel comes back', () => {
    expect(dockShown(s(true, 'section', false))).toBe(true)
  })
  it('nowhere on screen — kept in the hidden panel', () => {
    expect(dockShown(s(false, 'dock', false))).toBe(false)
    expect(termPlaceOf(s(false, 'dock', false))).toBe('dock')
    expect(termPlaceOf(s(false, 'section', true))).toBe('section')
  })
  it('its height within the window', () => {
    expect(dockHeight(300, 1000)).toBe(300)
    expect(dockHeight(900, 800)).toBe(800 - DOCK_H.keep)
    expect(dockHeight(50, 1000)).toBe(DOCK_H.min)
    expect(dockHeight(400, 200)).toBe(DOCK_H.min)
    expect(dockHeight(Number.NaN, 1000)).toBe(DOCK_H.start)
  })
})
