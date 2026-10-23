import { describe, expect, it } from 'vitest'
import { line, pathOf, plural, short, stepError } from '../../src/main/runner/qa/qaText'
import type { Exchange } from '../../src/main/runner/traffic'

describe('the words of the qa checks', () => {
  it('plural forms of Russian', () => {
    const f = (n: number) => plural(n, 'поле', 'поля', 'полей')
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(f)).toEqual(['поле', 'поля', 'поля', 'полей', 'полей', 'полей', 'полей', 'поле', 'поля', 'полей', 'поле', 'полей'])
  })
  it("a request's path: its ids as :id; not an address — as it is", () => {
    expect(pathOf('https://x.test/api/items/3f2a9c1e-1b2c-4d5e-8f90-a1b2c3d4e5f6/files?x=1')).toBe('/api/items/:id/files')
    expect(pathOf('not a url')).toBe('not a url')
  })
  it("a step's timeout says what it waited for", () => {
    const e = new Error('locator.click: Timeout 6000ms exceeded.\nCall log:\n  - waiting for getByRole(\'button\', { name: \'Save\' })')
    expect(stepError(e, 6)).toBe("не найден или недоступен за 6 с: getByRole('button', { name: 'Save' })")
    expect(stepError(new Error('\u001b[31mboom\u001b[39m\nstack'), 6)).toBe('boom')
    expect(stepError('plain', 6)).toBe('plain')
  })
  it('short texts, a request in one line', () => {
    expect(short('abcdef', 3)).toBe('abc…')
    expect(short('abc', 3)).toBe('abc')
    const x = (status?: number) => ({ method: 'POST', url: 'https://x.test/api/save', status }) as Exchange
    expect(line(x(201))).toBe('POST /api/save → 201')
    expect(line(x(0))).toBe('POST /api/save → не дошёл')
    expect(line(x())).toBe('POST /api/save → …')
  })
})
