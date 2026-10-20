import { describe, expect, it } from 'vitest'
import { assetsOf, boardsOf, parseBundle, rebind } from '../src/shared/docBundle'

const NOTE = [
  '# Схема',
  '![[.images/2026-10-01-abcd1234.png]]',
  '![[.audio/2026-10-01-ffff0000.webm]]',
  '```board',
  'path: Работа/Схема релиза.qboard',
  '```',
  '',
  '```js run name=x',
  '// path: not/a/board.qboard',
  '```',
  '```board',
  'path: Доска.qboard',
  '```',
].join('\n')

describe('docBundle', () => {
  it('finds the files and the boards of a note', () => {
    expect(assetsOf(NOTE)).toEqual(['.images/2026-10-01-abcd1234.png', '.audio/2026-10-01-ffff0000.webm'])
    expect(boardsOf(NOTE)).toEqual(['Работа/Схема релиза.qboard', 'Доска.qboard'])
  })
  it('rebinds board paths and renamed files only', () => {
    const out = rebind(NOTE, new Map([['Работа/Схема релиза.qboard', 'Импорт/Схема релиза 2.qboard']]), new Map([['.images/2026-10-01-abcd1234.png', '.images/2026-10-19-00000000.png']]))
    expect(out).toContain('path: Импорт/Схема релиза 2.qboard')
    expect(out).toContain('path: Доска.qboard')
    expect(out).toContain('// path: not/a/board.qboard')
    expect(out).toContain('![[.images/2026-10-19-00000000.png]]')
  })
  it('rejects what is not a bundle', () => {
    expect(() => parseBundle('nope')).toThrow(/JSON/)
    expect(() => parseBundle('{"format":"x"}')).toThrow(/qvdoc/)
    expect(() => parseBundle('{"format":"qvarch-doc","version":2,"docs":[]}')).toThrow(/Версия/)
    const b = parseBundle(JSON.stringify({ format: 'qvarch-doc', version: 1, main: 'a.md', docs: [{ key: 'a.md', kind: 'note', text: 'x' }], pairs: [['a.md', 1]] }))
    expect(b.pairs).toEqual([])
    expect(b.files).toEqual({})
  })
})
