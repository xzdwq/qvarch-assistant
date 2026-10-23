import { describe, expect, it } from 'vitest'
import { eventMentions, searchNotes } from '../../src/main/vault/vaultSearch'
import type { VaultNode } from '../../src/shared/vault'

const node = (path: string, o: Partial<VaultNode> = {}): VaultNode => ({ path, name: path.split('/').pop()!.replace(/\.(md|qboard)$/, ''), dir: false, mtime: 0, ctime: 0, ...o })
const tree: VaultNode[] = [
  node('dir', { dir: true, children: [node('dir/Plan.md'), node('dir/Plan.qboard', { board: true })] }),
  node('Notes.md'),
  node('Broken.md'),
]
const texts: Record<string, string> = {
  'dir/Plan.md': 'first line\nthe plan is here\nplan again plan',
  'Notes.md': 'nothing\nsee qvarch://event/2026-10-01/ev-1 and qvarch://event/2026-10-02/ev-2',
  'dir/Plan.qboard': '{"plan": 1}',
}
const read = (p: string) => {
  if (!(p in texts)) throw new Error('unreadable')
  return texts[p]
}

describe('vault search', () => {
  it('finds by name and by text; the name first, then how often', () => {
    const hits = searchNotes(tree, read, 'PLAN')
    expect(hits.map((h) => [h.path, h.inName, h.count])).toEqual([
      ['dir/Plan.md', true, 3],
      ['dir/Plan.qboard', true, 0],
    ])
    expect(hits[0].lines.map((l) => [l.line, l.col, l.at])).toEqual([
      [1, 4, 4],
      [2, 0, 0],
    ])
  })
  it('a long line: a window around the match', () => {
    const long = `${'x'.repeat(100)}needle${'y'.repeat(200)}`
    const [hit] = searchNotes([node('L.md')], () => long, 'needle')
    const l = hit.lines[0]
    expect(l.text.startsWith('…')).toBe(true)
    expect(l.text.slice(l.at, l.at + l.len)).toBe('needle')
  })
  it('an empty query finds nothing; unreadable notes are skipped', () => {
    expect(searchNotes(tree, read, '  ')).toEqual([])
    expect(searchNotes(tree, read, 'broken')).toEqual([])
  })
})

describe('event mentions', () => {
  it('maps each event to the notes that mention it (boards skipped)', () => {
    expect(eventMentions(tree, read)).toEqual({ 'ev-1': ['Notes.md'], 'ev-2': ['Notes.md'] })
  })
})
