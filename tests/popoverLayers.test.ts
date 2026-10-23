import { describe, expect, it } from 'vitest'
import { PopoverLayer, PopoverStack } from '../src/shared/popoverLayers'

/** A press target: the name of the panel it lands in. */
const inPanel = (name: string) => (t: string) => t === name

describe('popovers inside popovers', () => {
  it('a press in a child popover is inside its parent (and the parent of that)', () => {
    const root = new PopoverLayer(inPanel('a'))
    const child = new PopoverLayer(inPanel('b'), root)
    new PopoverLayer(inPanel('c'), child)
    expect(root.holds('a')).toBe(true)
    expect(root.holds('b')).toBe(true)
    expect(root.holds('c')).toBe(true)
    expect(child.holds('a')).toBe(false)
    expect(root.holds('elsewhere')).toBe(false)
  })
  it('siblings are not inside each other', () => {
    const root = new PopoverLayer(inPanel('a'))
    const one = new PopoverLayer(inPanel('b'), root)
    const two = new PopoverLayer(inPanel('c'), root)
    expect(one.holds('c')).toBe(false)
    expect(two.holds('b')).toBe(false)
  })
  it('a child gone (detached) no longer counts', () => {
    const root = new PopoverLayer(inPanel('a'))
    const child = new PopoverLayer(inPanel('b'), root)
    child.detach()
    expect(root.holds('b')).toBe(false)
  })
  it('a closed child (its panel not shown) holds nothing', () => {
    let shown = true
    const root = new PopoverLayer(inPanel('a'))
    new PopoverLayer((t: string) => shown && t === 'b', root)
    expect(root.holds('b')).toBe(true)
    shown = false
    expect(root.holds('b')).toBe(false)
  })
})

describe('the open popovers, in order', () => {
  it('the last one opened is on top; closed — the one before it', () => {
    const s = new PopoverStack<string>()
    s.push('a')
    s.push('b')
    expect(s.top()).toBe('b')
    s.remove('b')
    expect(s.top()).toBe('a')
    s.remove('a')
    expect(s.top()).toBeUndefined()
    expect(s.size).toBe(0)
  })
  it('one opened again goes to the top, kept once', () => {
    const s = new PopoverStack<string>()
    s.push('a')
    s.push('b')
    s.push('a')
    expect(s.top()).toBe('a')
    expect(s.size).toBe(2)
  })
  it('removing one that is not open changes nothing', () => {
    const s = new PopoverStack<string>()
    s.push('a')
    s.remove('x')
    expect(s.top()).toBe('a')
  })
})
