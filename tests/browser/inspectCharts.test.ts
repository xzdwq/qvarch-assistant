import { describe, expect, it } from 'vitest'
import { linePath, nearestIndex, niceMax, stackPaths } from '../../src/shared/browser/inspect/chartPaths'

describe('the inspector small charts', () => {
  it('rounds the axis top up to 1 / 2 / 5 × 10ⁿ', () => {
    expect(niceMax(37)).toBe(50)
    expect(niceMax(120)).toBe(200)
    expect(niceMax(0.3)).toBe(1)
    expect(niceMax(1000)).toBe(1000)
  })
  it('a line over the width, clamped to the axis', () => {
    expect(linePath([0, 50, 200], 100, 10, 100)).toBe('M0,10L50,5L100,0')
  })
  it('stacks series: each area from the sum below it', () => {
    const [a, b] = stackPaths([[10, 20], [10, 10]], 100, 100, 100)
    expect(a).toBe('M0,90L100,80L100,100L0,100Z')
    expect(b).toBe('M0,80L100,70L100,80L0,90Z')
  })
  it('the sample under the pointer', () => {
    expect(nearestIndex(49, 100, 3)).toBe(1)
    expect(nearestIndex(-5, 100, 3)).toBe(0)
    expect(nearestIndex(500, 100, 3)).toBe(2)
  })
})
