import { describe, expect, it } from 'vitest'
import { compileWatch, crumbs, presetAsks, scanBatch } from '../src/shared/terminal'

describe('terminal', () => {
  it('a path → its crumbs (the drive has its root)', () => {
    expect(crumbs('C:\\Users\\me\\develop')).toEqual([
      { name: 'C:', path: 'C:\\' },
      { name: 'Users', path: 'C:\\Users' },
      { name: 'me', path: 'C:\\Users\\me' },
      { name: 'develop', path: 'C:\\Users\\me\\develop' },
    ])
    expect(crumbs('C:\\')).toEqual([{ name: 'C:', path: 'C:\\' }])
    expect(crumbs('')).toEqual([])
  })
  it("a preset's questions: each once, with the default", () => {
    expect(presetAsks(`git commit -m "[{{ task }}] {{ ask('Текст') }}" && echo {{ ask("Текст") }} {{ ask('Ключ', 'ABC-') }}`)).toEqual([
      { label: 'Текст', def: '' },
      { label: 'Ключ', def: 'ABC-' },
    ])
    expect(presetAsks('git status')).toEqual([])
  })
})

describe('reactions', () => {
  const rule = (patterns: string, o: { ignoreCase?: boolean; word?: boolean } = {}) => ({ id: 'r', ...compileWatch({ patterns, ignoreCase: o.ignoreCase ?? true, word: o.word ?? false })! })
  it('words are escaped, /regex/ is taken as is, a bad one says why', () => {
    expect(compileWatch({ patterns: 'a.b\n\n /x+/ ', ignoreCase: false, word: false })).toEqual({ source: '(?:a\\.b)|(?:x+)', flags: 'gm' })
    expect(compileWatch({ patterns: '  ', ignoreCase: true, word: false })).toBeUndefined()
    expect(() => compileWatch({ patterns: '/(/', ignoreCase: true, word: false })).toThrow(/\/\(\//)
  })
  it('line by line: colours stripped, one count per line, the unfinished line waits', () => {
    const cache = {}
    const r1 = scanBatch('ok\r\n\x1b[31mERROR\x1b[0m: boom error\r\nnpm err', '', [rule('error')], cache)
    expect(r1.hits).toMatchObject([{ id: 'r', count: 1, line: 'ERROR: boom error', keys: [['error boom error', 1, 'ERROR: boom error']] }])
    expect(r1.carry).toBe('npm err')
    // the line finishes in the next batch
    const r2 = scanBatch('or!\r\n', r1.carry, [rule('error')], cache)
    expect(r2.hits).toMatchObject([{ id: 'r', count: 1, line: 'npm error!' }])
    expect(r2.carry).toBe('')
  })
  it('case and whole words', () => {
    const text = 'Errors: 0\nerror here\nterror\n'
    expect(scanBatch(text, '', [rule('error', { ignoreCase: false })], {}).hits[0].count).toBe(2)
    expect(scanBatch(text, '', [rule('error', { word: true })], {}).hits[0]).toMatchObject({ id: 'r', count: 1, line: 'error here' })
    expect(scanBatch('ошибка\nошибками\n', '', [rule('ошибка', { word: true })], {}).hits[0].count).toBe(1)
  })
  it('a flood without line ends: the carry stays bounded', () => {
    const r = scanBatch('x'.repeat(100_000), '', [rule('error')], {})
    expect(r.hits).toEqual([])
    expect(r.carry.length).toBe(4096)
  })
  it('many lines at once are fast', () => {
    const lines = Array.from({ length: 50_000 }, (_, i) => (i % 1000 === 0 ? `line ${i} ERROR` : `line ${i} fine`)).join('\r\n') + '\r\n'
    const t = performance.now()
    const r = scanBatch(lines, '', [rule('error'), rule('/fatal|panic/')], {})
    expect(performance.now() - t).toBeLessThan(500)
    expect(r.hits).toMatchObject([{ id: 'r', count: 50, line: 'line 49000 ERROR' }])
    // a spinner / a counter on a line does not make it another line
    expect(r.hits[0].keys).toEqual([['line error', 50, 'line 49000 ERROR']])
  })
})
