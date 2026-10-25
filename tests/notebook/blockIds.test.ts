import { describe, expect, it } from 'vitest'
import { blockIdFixes } from '../../src/notebook/domain/blockIds'
import { blockRunKey, fencedBlocksOf } from '../../src/notebook/domain/noteBlocks'

/** Ids handed out in turn (the test knows which one comes next). */
const ids = (...list: string[]) => () => list.shift()!
const was = () => true
const isNew = () => false

describe('a runnable block\'s own id', () => {
  it('a block that was there without one gets one — its results go with it', () => {
    const text = 'Текст\n```sql db=main\nselect 1\n```\n'
    const fixes = blockIdFixes(text, ids('aaaa1111'), was)
    // (its first line — the second of the text, counted from 1)
    expect(fixes).toEqual([{ line0: 2, infoLine: '```sql db=main id=aaaa1111', key: '_aaaa1111', was: '_sql2' }])
    expect(text.split('\n')[fixes[0].line0 - 1]).toBe('```sql db=main')
  })
  it('a new block — starting empty, even one named as another was (its results are kept by its id, not by its name)', () => {
    const text = '```sql db=main name=rows\n\n```\n'
    expect(blockIdFixes(text, ids('bbbb2222'), isNew)).toEqual([{ line0: 1, infoLine: '```sql db=main name=rows id=bbbb2222', key: '_bbbb2222' }])
    expect(blockRunKey('rows', 'sql', 1, 'bbbb2222')).toBe('_bbbb2222')
    expect(blockRunKey('rows', 'sql', 1)).toBe('rows')
  })
  it('a library, a block of no run, one with its own id — left as they are', () => {
    const text = '```ts lib\nexport const x = 1\n```\n```json\n{}\n```\n```sql db=main id=cccc3333\nselect 2\n```\n'
    expect(blockIdFixes(text, ids('dddd4444'), was)).toEqual([])
  })
  it('a copy (the same id) — a new one for it, starting empty (no results taken over)', () => {
    const text = '```http id=dddd4444\nGET https://app.example.com\n```\n\n```http id=dddd4444\nGET https://app.example.com\n```\n'
    expect(blockIdFixes(text, ids('eeee5555'), was)).toEqual([{ line0: 5, infoLine: '```http id=eeee5555', key: '_eeee5555' }])
  })
  it('the id read back, a wrong one ignored', () => {
    const [b] = fencedBlocksOf('```sql db=main name=rows id=ffff6666\nselect 1\n```')
    expect([b.info.id, b.info.name, b.key]).toEqual(['ffff6666', 'rows', '_ffff6666'])
    expect(fencedBlocksOf('```sql db=main id=НЕ-ТАК\nselect 1\n```')[0].info.id).toBeUndefined()
  })
})
