import { describe, expect, it } from 'vitest'
import { guardDeletions, planFolder } from '../../src/shared/transport/sharedFolder'
import { cleanDocPath, freeDocPath, mediaRefs } from '../../src/shared/transport/space'

const doc = (id: string, path: string, deleted = false) => ({ id, title: path, path, ...(deleted ? { deleted } : {}) })

describe('a shared folder: a mass deletion held back', () => {
  const server = [doc('a', 'A.md'), doc('b', 'B.md'), doc('c', 'C.md'), doc('d', 'D.md')]
  const known = { a: 'A.md', b: 'B.md', c: 'C.md', d: 'D.md' }
  it('the folder read as empty (not loaded yet) — nothing is deleted for everyone, the documents come back here', () => {
    const r = guardDeletions(planFolder(server, [], known), server)
    expect(r.held).toBe(4)
    expect(r.steps.map((s) => s.do)).toEqual(['fetch', 'fetch', 'fetch', 'fetch'])
    expect(r.steps[0]).toEqual({ do: 'fetch', doc: 'a', path: 'A.md' })
  })
  it('one or two notes deleted by hand — deleted for everyone as before', () => {
    const local = [{ path: 'A.md', doc: 'a' }, { path: 'B.md', doc: 'b' }]
    const r = guardDeletions(planFolder(server, local, known), server)
    expect(r.held).toBe(0)
    expect(r.steps.filter((s) => s.do === 'deleteServer').map((s) => s.doc)).toEqual(['c', 'd'])
  })
  it('a small folder: fewer than the least mass — kept as asked', () => {
    const two = [doc('a', 'A.md'), doc('b', 'B.md')]
    expect(guardDeletions(planFolder(two, [], { a: 'A.md', b: 'B.md' }), two).held).toBe(0)
  })
})

describe('a shared folder brought into step', () => {
  it('in step — kept; new on the server — made here; new here — added', () => {
    expect(planFolder([doc('a', 'A.md'), doc('b', 'B.md')], [{ path: 'A.md', doc: 'a' }, { path: 'Новая.md', doc: '' }], { a: 'A.md' })).toEqual([
      { do: 'add', path: 'Новая.md', stale: '' },
      { do: 'keep', doc: 'a', path: 'A.md' },
      { do: 'fetch', doc: 'b', path: 'B.md' },
    ])
  })
  it('moved here — told; moved there — followed; moved at both — the server wins', () => {
    const known = { a: 'A.md', b: 'B.md', c: 'C.md' }
    const server = [doc('a', 'A.md'), doc('b', 'Архив/B.md'), doc('c', 'Там/C.md')]
    const local = [
      { path: 'Папка/A.md', doc: 'a' },
      { path: 'B.md', doc: 'b' },
      { path: 'Здесь/C.md', doc: 'c' },
    ]
    expect(planFolder(server, local, known)).toEqual([
      { do: 'moveServer', doc: 'a', path: 'Папка/A.md' },
      { do: 'moveLocal', doc: 'b', from: 'B.md', to: 'Архив/B.md' },
      { do: 'moveLocal', doc: 'c', from: 'Здесь/C.md', to: 'Там/C.md' },
    ])
  })
  it('deleted here — deleted for everyone; deleted there — deleted here; a letter case alone is the same path', () => {
    expect(planFolder([doc('a', 'A.md'), doc('b', 'B.md', true), doc('c', 'c.md')], [{ path: 'B.md', doc: 'b' }, { path: 'C.md', doc: 'c' }], { a: 'A.md', b: 'B.md', c: 'c.md' })).toEqual([
      { do: 'deleteServer', doc: 'a' },
      { do: 'deleteLocal', doc: 'b', path: 'B.md' },
      { do: 'keep', doc: 'c', path: 'c.md' },
    ])
  })
  it('a copy of a shared note, a note of another space — new documents', () => {
    const steps = planFolder([doc('a', 'A.md')], [{ path: 'A.md', doc: 'a' }, { path: 'A копия.md', doc: 'a' }, { path: 'Чужая.md', doc: 'x' }], { a: 'A.md' })
    expect(steps.filter((s) => s.do === 'add')).toEqual([
      { do: 'add', path: 'A копия.md', stale: 'a' },
      { do: 'add', path: 'Чужая.md', stale: 'x' },
    ])
  })
})

describe('paths and media of a space', () => {
  it('a document\'s path: inside, ending in .md; a taken one — « (2)»', () => {
    expect(cleanDocPath('Идеи\\ План.md ')).toBe('Идеи/План.md')
    expect(cleanDocPath('../вне.md')).toBeNull()
    expect(cleanDocPath('/a.md')).toBeNull()
    expect(cleanDocPath('a.txt')).toBeNull()
    const taken = new Set(['a.md', 'a (2).md'])
    expect(freeDocPath('a.md', (p) => taken.has(p))).toBe('a (3).md')
    expect(freeDocPath('b.md', (p) => taken.has(p))).toBe('b.md')
  })
  it('the media a text embeds, each once; other embeds — not', () => {
    const t = '![[.images/2026-10-24-ab12cd34.png]]\nтекст ![[.audio/2026-10-24-ab12cd34.webm]]\n![[.images/2026-10-24-ab12cd34.png]]\n![[Другая заметка]]\n![[../x.png]]'
    expect(mediaRefs(t)).toEqual(['.images/2026-10-24-ab12cd34.png', '.audio/2026-10-24-ab12cd34.webm'])
  })
})
