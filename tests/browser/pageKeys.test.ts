import { describe, expect, it, vi } from 'vitest'
import { pageKeyAction, type PageKey, type PageKeyActions } from '../../src/main/browser/pageKeys'

/** A key as a page sends it (no modifiers unless given). */
const key = (k: string, mods: Partial<Omit<PageKey, 'key' | 'k'>> = {}): PageKey => ({ key: k, k: k.toLowerCase(), ctrl: false, shift: false, alt: false, ...mods })
/** The actions a key took (each recorded with its argument). */
function run(i: PageKey) {
  const calls: Array<[string, unknown?]> = []
  const a: PageKeyActions = {
    nav: (x) => calls.push(['nav', x]),
    zoomBy: (x) => calls.push(['zoomBy', x]),
    zoomReset: () => calls.push(['zoomReset']),
    send: (x) => calls.push(['send', x]),
    save: () => calls.push(['save']),
    viewSource: () => calls.push(['viewSource']),
    print: () => calls.push(['print']),
  }
  const act = pageKeyAction(i)
  act?.(a)
  return { taken: !!act, calls }
}

describe("a page's keys that are the browser's", () => {
  it('reload: F5 / Ctrl+R; without the cache: Ctrl+F5 / Ctrl+Shift+R', () => {
    expect(run(key('F5')).calls).toEqual([['nav', 'reload']])
    expect(run(key('r', { ctrl: true })).calls).toEqual([['nav', 'reload']])
    expect(run(key('F5', { ctrl: true })).calls).toEqual([['nav', 'hard']])
    expect(run(key('R', { ctrl: true, shift: true })).calls).toEqual([['nav', 'hard']])
  })
  it('the tools: F12 and Ctrl+Shift+I; back / forward by Alt+arrows', () => {
    expect(run(key('F12')).calls).toEqual([['nav', 'devtools']])
    expect(run(key('I', { ctrl: true, shift: true })).calls).toEqual([['nav', 'devtools']])
    expect(run(key('ArrowLeft', { alt: true })).calls).toEqual([['nav', 'back']])
    expect(run(key('ArrowRight', { alt: true })).calls).toEqual([['nav', 'fwd']])
  })
  it('the zoom by ten, back to 100%', () => {
    expect(run(key('=', { ctrl: true })).calls).toEqual([['zoomBy', 10]])
    expect(run(key('+', { ctrl: true })).calls).toEqual([['zoomBy', 10]])
    expect(run(key('-', { ctrl: true })).calls).toEqual([['zoomBy', -10]])
    expect(run(key('0', { ctrl: true })).calls).toEqual([['zoomReset']])
  })
  it("the section's keys go to the window", () => {
    expect(run(key('t', { ctrl: true })).calls).toEqual([['send', 'newTab']])
    expect(run(key('w', { ctrl: true })).calls).toEqual([['send', 'closeTab']])
    expect(run(key('l', { ctrl: true })).calls).toEqual([['send', 'focusUrl']])
    expect(run(key('d', { ctrl: true })).calls).toEqual([['send', 'bookmark']])
    expect(run(key('M', { ctrl: true, shift: true })).calls).toEqual([['send', 'device']])
    expect(run(key('h', { ctrl: true })).calls).toEqual([['send', 'history']])
  })
  it("save, the source, print; any other key is the page's own", () => {
    expect(run(key('s', { ctrl: true })).calls).toEqual([['save']])
    expect(run(key('u', { ctrl: true })).calls).toEqual([['viewSource']])
    expect(run(key('p', { ctrl: true })).calls).toEqual([['print']])
    for (const i of [key('a'), key('i', { ctrl: true }), key('ArrowLeft'), key('F4'), key('x', { alt: true })]) expect(run(i).taken).toBe(false)
  })
  it('one action per key (the first rule that matches)', () => {
    const spy = vi.fn()
    pageKeyAction(key('F5', { ctrl: true }))?.({ nav: spy, zoomBy: spy, zoomReset: spy, send: spy, save: spy, viewSource: spy, print: spy })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
