import { describe, expect, it } from 'vitest'
import { expectedHex, fmtSize, hashHex, hexToB64, normHash, showDigest } from '../../src/shared/codecText'

/** The codec tool's pure helpers: sizes, hashes as hex / Base64, the expected hash read. */

describe('codec helpers', () => {
  it('sizes', () => {
    expect(fmtSize(1023)).toBe('1023 Б')
    expect(fmtSize(1536)).toBe('1.5 КБ')
    expect(fmtSize(3 * 1048576)).toBe('3.00 МБ')
  })
  it('hex ↔ Base64', () => {
    expect(hexToB64('48656c6c6f')).toBe('SGVsbG8=')
    expect(hashHex('48656C6C6F')).toBe('48656c6c6f')
    expect(hashHex('SGVsbG8=')).toBe('48656c6c6f')
  })
  it('the expected hash: spaces dropped; nothing — empty; not a hash — ?', () => {
    expect(normHash(' ab cd\n12 ')).toBe('abcd12')
    expect(expectedHex('  ')).toBe('')
    expect(expectedHex('AB CD')).toBe('abcd')
    expect(expectedHex('SGVsbG8=')).toBe('48656c6c6f')
    expect(expectedHex('%%%')).toBe('?')
  })
  it('a digest as shown', () => {
    expect(showDigest('abcd', false, false)).toBe('abcd')
    expect(showDigest('abcd', false, true)).toBe('ABCD')
    expect(showDigest('48656c6c6f', true, true)).toBe('SGVsbG8=')
  })
})
