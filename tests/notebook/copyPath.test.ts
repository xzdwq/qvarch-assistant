import { describe, expect, it } from 'vitest'
import { copyPath, extOf } from '../../src/notebook/domain/notePaths'

describe('a copy of a document beside it', () => {
  it('«Копия - X»; taken — «Копия Копия - X», and so on; the case does not count', () => {
    expect(copyPath('dir/План.md', ['dir/План.md'])).toBe('dir/Копия - План.md')
    expect(copyPath('dir/План.md', ['dir/План.md', 'dir/копия - план.md'])).toBe('dir/Копия Копия - План.md')
    expect(copyPath('dir/План.md', ['dir/План.md', 'dir/Копия - План.md', 'dir/Копия Копия - План.md'])).toBe('dir/Копия Копия Копия - План.md')
  })
  it('a copy of a copy — one «Копия» more, not «Копия - Копия - X»; at the root; a board keeps its extension', () => {
    expect(copyPath('Копия - План.md', ['План.md', 'Копия - План.md'])).toBe('Копия Копия - План.md')
    expect(copyPath('Схема.qboard', ['Схема.qboard'])).toBe('Копия - Схема.qboard')
    expect(extOf('a/b.c/Схема.qboard')).toBe('.qboard')
    expect(extOf('a/b.c/без расширения')).toBe('')
  })
})
