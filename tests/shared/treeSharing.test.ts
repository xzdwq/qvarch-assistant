import { describe, expect, it } from 'vitest'
import { shareBadges } from '../../src/shared/transport/treeSharing'
import type { VaultNode } from '../../src/shared/vault'
import { runChipsOf } from '../../src/notebook/domain/noteBlocks'

const file = (path: string, doc?: string): VaultNode => ({ path, name: path, dir: false, mtime: 0, ctime: 0, ...(doc ? { doc } : {}) })
const dir = (path: string, children: VaultNode[], space?: string): VaultNode => ({ path, name: path, dir: true, mtime: 0, ctime: 0, children, ...(space ? { space } : {}) })

const MEMBERS: Record<string, string[]> = { s1: ['me', 'ann', 'bob'], s2: ['me', 'ann'], s3: ['me', 'eve'], sf: ['me', 'kim', 'lee'] }
const DOC_SPACE: Record<string, string> = { d1: 's1', d2: 's2', d3: 's3', df: 'sf' }
const facts = {
  me: 'me',
  docOf: (n: VaultNode) => n.doc,
  spaceOfDoc: (d: string) => DOC_SPACE[d],
  membersOf: (s: string) => MEMBERS[s],
}

describe('tree sharing badges', () => {
  it('a folder with some shared notes: the people once each, shared in part', () => {
    const b = shareBadges([dir('A', [file('A/1', 'd1'), file('A/2', 'd2'), file('A/3'), dir('A/B', [file('A/B/4', 'd3')])])], facts)
    expect(b.get('A/1')).toEqual({ people: 2, whole: true })
    expect(b.get('A/3')).toBeUndefined()
    expect(b.get('A/B')).toEqual({ people: 1, whole: false })
    expect(b.get('A')).toEqual({ people: 3, whole: false })
  })

  it('a shared folder: whole, its subfolders too (with its people, though empty)', () => {
    const b = shareBadges([dir('F', [file('F/1', 'df'), dir('F/sub', [])], 'sf')], facts)
    expect(b.get('F')).toEqual({ people: 2, whole: true })
    expect(b.get('F/sub')).toEqual({ people: 2, whole: true })
    expect(b.get('F/1')).toEqual({ people: 2, whole: true })
  })

  it('members not known (offline): the badge stands without people; nothing shared — no badge', () => {
    const b = shareBadges([dir('A', [file('A/1', 'dx')]), dir('C', [file('C/1')])], facts)
    expect(b.get('A')).toEqual({ people: 0, whole: false })
    expect(b.has('C')).toBe(false)
  })
})

describe('run chips of a note', () => {
  it('only runnable components, each once, in order', () => {
    // (a plain ```sql is code to read, not a query: no chip)
    const text = ['# T', '```sql db=main name=a', 'select 1', '```', '```http', 'GET https://x.test', '```', '```js run', '1', '```', '```sql db=main name=b', 'select 2', '```', '```sql', 'select 3', '```', '```mermaid', 'graph TD', '```'].join('\n')
    expect(runChipsOf(text)).toEqual(['db', 'http', 'js/ts'])
  })
})
