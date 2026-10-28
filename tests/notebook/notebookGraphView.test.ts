import { describe, expect, it } from 'vitest'
import { around, notebookGraph, visibleGraph, type EdgeRow } from '../../src/notebook/domain/graph/notebookGraph'
import { headTags, TAG_TYPED, tagSpans } from '../../src/notebook/domain/graph/tags'
import { keepNotes } from '../../src/shared/vaultTree'
import type { VaultNode } from '../../src/shared/vault'

const row = (path: string, kind: EdgeRow['kind'], name: string, type: EdgeRow['type'] = 'reads'): EdgeRow => ({ path, kind, name, label: name, type })

describe('the notebook as a graph to draw', () => {
  const files = ['a.md', 'b.md', 'Папка/c.md', 'd.md']
  const rows = [
    row('a.md', 'table', 'orders'),
    row('b.md', 'table', 'orders', 'writes'),
    row('Папка/c.md', 'table', 'lonely'),
    row('d.md', 'tag', 'один', 'tagged'),
    row('a.md', 'note', 'c', 'links'),
    row('d.md', 'note', 'ещё нет', 'links'),
  ]
  const g = notebookGraph(files, rows, (r) => (r.name === 'c' ? 'Папка/c.md' : undefined))
  const ids = (x: { nodes: Array<{ id: string }> }) => x.nodes.map((n) => n.id).sort()
  it('a table two notes share — a node, one note’s — not; a tag — even one note’s', () => {
    expect(ids(g)).toContain('table:orders')
    expect(ids(g)).not.toContain('table:lonely')
    expect(ids(g)).toContain('tag:один')
  })
  it('a link goes from the note having it; a note not made yet — a node of its own', () => {
    expect(g.links).toContainEqual({ from: 'n:a.md', to: 'n:Папка/c.md', type: 'links' })
    expect(g.links).toContainEqual({ from: 'n:d.md', to: 'g:ещё нет', type: 'links' })
  })
  it('a folder holds its notes', () => {
    expect(g.links).toContainEqual({ from: 'f:Папка', to: 'n:Папка/c.md', type: 'has' })
  })
  it('the kinds switched off — gone with their links; degrees of what is shown', () => {
    const v = visibleGraph(g, (k) => k !== 'folder')
    expect(ids(v)).not.toContain('f:Папка')
    expect(v.nodes.find((n) => n.id === 'n:Папка/c.md')?.degree).toBe(1)
  })
  it('around a note: within its depth only', () => {
    const v = visibleGraph(g, (k) => k !== 'folder')
    expect(ids(around(v, 'n:Папка/c.md', 1))).toEqual(['n:a.md', 'n:Папка/c.md'])
    expect(ids(around(v, 'n:Папка/c.md', 2))).toEqual(['n:a.md', 'n:Папка/c.md', 'table:orders'])
  })
})

describe('the tree filtered by a tag', () => {
  const tree = [
    { path: 'A', name: 'A', dir: true, children: [{ path: 'A/x.md', name: 'x', dir: false, pair: 'A/x.qboard' }, { path: 'A/x.qboard', name: 'x', dir: false, board: true, pair: 'A/x.md' }, { path: 'A/y.md', name: 'y', dir: false }] },
    { path: 'B', name: 'B', dir: true, children: [{ path: 'B/z.md', name: 'z', dir: false }] },
  ] as VaultNode[]
  it('the notes kept with their boards; folders with nothing — gone; the kept folders listed', () => {
    const { tree: t, dirs } = keepNotes(tree, new Set(['A/x.md']))
    expect(t.map((n) => n.path)).toEqual(['A'])
    expect(t[0].children?.map((n) => n.path)).toEqual(['A/x.md', 'A/x.qboard'])
    expect(dirs).toEqual(['A'])
  })
})

describe('tags as shown', () => {
  it('a tag being typed: after a space, at a line’s start; not after a word; not a bare #', () => {
    expect(TAG_TYPED.exec('текст #рел')?.[1]).toBe('рел')
    expect(TAG_TYPED.exec('#a/b')?.[1]).toBe('a/b')
    expect(TAG_TYPED.exec('C#')).toBeNull()
    expect(TAG_TYPED.exec('# ')).toBeNull()
    expect(TAG_TYPED.exec('word#x')).toBeNull()
  })
  it('the first line’s tags (the tree shows them); the rest of the note — not', () => {
    expect(headTags('Итоги #релиз #q3\n#другой')).toEqual(['релиз', 'q3'])
    expect(headTags('без тегов\n#ниже')).toEqual([])
  })
  it('a line’s tags, each where it stands (the editor’s chips); not in code or a link', () => {
    expect(tagSpans('a #один и `#код` [[X#y]] #два/три.')).toEqual([
      { at: 2, len: 5, name: 'один' },
      { at: 25, len: 8, name: 'два/три' },
    ])
  })
})
