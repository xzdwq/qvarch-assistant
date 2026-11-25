import { describe, expect, it } from 'vitest'
import { findNode, sortNodes, treeRows } from '../../src/shared/vaultTree'
import type { VaultNode } from '../../src/shared/vault'

const n = (path: string, o: Partial<VaultNode> = {}): VaultNode => ({ path, name: path.split('/').pop()!.replace(/\.(md|qboard)$/, ''), dir: false, mtime: 0, ctime: 0, ...o })
const tree: VaultNode[] = [
  n('b.md', { mtime: 2 }),
  n('a.md', { mtime: 1, pair: 'z.qboard' }),
  n('z.qboard', { board: true, pair: 'a.md' }),
  n('f', { dir: true, children: [n('f/c.md'), n('f/sub', { dir: true, children: [n('f/sub/d.md')] })] }),
]

describe('the vault tree', () => {
  it('finds a node anywhere', () => {
    expect(findNode(tree, 'f/sub/d.md')?.name).toBe('d')
    expect(findNode(tree, 'nope')).toBeUndefined()
  })
  it('sorts folders first, then by the order chosen', () => {
    expect(sortNodes(tree, 'name').map((x) => x.path)).toEqual(['f', 'a.md', 'b.md', 'z.qboard'])
    expect(sortNodes(tree, 'mtime').map((x) => x.path)).toEqual(['f', 'b.md', 'a.md', 'z.qboard'])
  })
  it('rows: open folders unfolded, a linked board right under its note', () => {
    const rows = treeRows(tree, ['f'], 'name')
    expect(rows.map((r) => [r.node.path, r.depth, r.grp ?? ''])).toEqual([
      ['f', 0, ''],
      ['f/sub', 1, ''],
      ['f/c.md', 1, ''],
      ['a.md', 0, 'top'],
      ['z.qboard', 0, 'bot'],
      ['b.md', 0, ''],
    ])
  })
  it("each row's lines to its folders: the last of a folder ends its line, a folder with more after it carries its line on", () => {
    const rows = treeRows(tree, ['f', 'f/sub'], 'name')
    expect(rows.map((r) => [r.node.path, r.last, r.rails])).toEqual([
      ['f', false, []],
      ['f/sub', false, [true]],
      ['f/sub/d.md', true, [true, true]],
      ['f/c.md', true, [true]],
      // a pair is one thing of its folder: both rows share its place
      ['a.md', false, []],
      ['z.qboard', false, []],
      ['b.md', true, []],
    ])
  })
  it('a folder counts what is right in it: its folders and documents, not what they hold; empty — 0', () => {
    const rows = treeRows([...tree, n('e', { dir: true, children: [] }), n('m', { dir: true, children: [n('m/t', { dir: true, children: [] })] })], ['f'], 'name')
    const items = (p: string) => rows.find((r) => r.node.path === p)?.items
    expect(items('f')).toBe(2)
    expect(items('f/sub')).toBe(1)
    expect(items('m')).toBe(1)
    expect(items('e')).toBe(0)
    expect(items('a.md')).toBeUndefined()
  })
})
