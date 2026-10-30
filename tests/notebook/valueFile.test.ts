import { describe, expect, it } from 'vitest'
import { prettyValue, valueFile } from '../../src/notebook/domain/values'

describe('a value as a file', () => {
  it('kept whole, however big (the screen cuts it, the file does not)', () => {
    const big = { rows: Array.from({ length: 30_000 }, (_, i) => ({ i, name: `строка ${i}` })) }
    expect(prettyValue(big)).toContain('обрезано')
    const f = valueFile(big)
    expect(f.ext).toBe('json')
    expect(JSON.parse(f.text)).toEqual(big)
  })
  it('an object, a number — JSON; a text — as it is; a text of JSON — JSON only when asked to read it', () => {
    expect(valueFile({ a: 1 })).toEqual({ text: '{\n  "a": 1\n}', ext: 'json' })
    expect(valueFile(42)).toEqual({ text: '42', ext: 'json' })
    expect(valueFile('просто текст')).toEqual({ text: 'просто текст', ext: 'txt' })
    expect(valueFile('{"a":1}')).toEqual({ text: '{"a":1}', ext: 'txt' })
    expect(valueFile('{"a":1}', true)).toEqual({ text: '{\n  "a": 1\n}', ext: 'json' })
    expect(valueFile('{не json', true)).toEqual({ text: '{не json', ext: 'txt' })
    expect(valueFile(undefined)).toEqual({ text: 'undefined', ext: 'txt' })
  })
})
