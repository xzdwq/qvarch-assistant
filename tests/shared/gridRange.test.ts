import { describe, expect, it } from 'vitest'
import { rangeBounds, rangeHas, rangeSize, tsvCell, tsvRows } from '../../src/shared/gridRange'

describe('the table core: ranges and copying', () => {
  it('a range drawn in any direction', () => {
    const x = { r0: 3, c0: 2, r1: 1, c1: 0 }
    expect(rangeBounds(x)).toEqual({ top: 1, bottom: 3, left: 0, right: 2 })
    expect(rangeHas(x, 2, 1)).toBe(true)
    expect(rangeHas(x, 0, 1)).toBe(false)
    expect(rangeHas(undefined, 0, 0)).toBe(false)
    expect(rangeSize(x)).toBe(9)
    expect(rangeSize(undefined)).toBe(0)
  })
  it('cells quoted as Excel quotes them', () => {
    expect(tsvCell('plain')).toBe('plain')
    expect(tsvCell('a"b')).toBe('"a""b"')
    expect(tsvCell('a\nb')).toBe('"a\nb"')
    expect(tsvRows([['a', 'b\tc'], ['', 'd']])).toBe('a\t"b\tc"\n\td')
  })
})
