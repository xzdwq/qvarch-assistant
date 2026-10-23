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
})
