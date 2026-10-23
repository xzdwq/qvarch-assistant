import { describe, expect, it } from 'vitest'
import {
  BlameTally,
  CONFLICT_HUNK_PREVIEW_LINES,
  isBetterDivergence,
  linesEqualIgnoringWhitespace,
  locateLines,
  parseConflictBlocks,
  toConflictHunk,
} from '../../src/main/release/git/conflictText'

const file = ['top', 'before', '<<<<<<< HEAD', 'ours 1', 'ours 2', '=======', 'theirs', '>>>>>>> abc', 'after', ''].join('\r\n')

describe('parseConflictBlocks', () => {
  it('reads both sides and the line after the block', () => {
    expect(parseConflictBlocks(file)).toMatchObject([{ oursLines: ['ours 1', 'ours 2'], theirsLines: ['theirs'], contextAfter: 'after' }])
  })
  it('takes the line above the opening marker as the context before', () => {
    expect(parseConflictBlocks(file)[0].contextBefore).toBe('before')
  })
  it('has no context before a block that opens the file', () => {
    expect(parseConflictBlocks('<<<<<<< a\nx\n=======\ny\n>>>>>>> b\n')[0].contextBefore).toBeNull()
  })
  it('ignores an unterminated block', () => {
    expect(parseConflictBlocks('<<<<<<< a\nx\n=======\ny\n')).toEqual([])
  })
  it('ignores a separator or a closing marker outside a block', () => {
    expect(parseConflictBlocks('=======\n>>>>>>> b\n<<<<<<< a\nx\n>>>>>>> b\n')).toEqual([])
  })
  it('a new opening marker restarts an unfinished block', () => {
    expect(parseConflictBlocks('<<<<<<< a\nlost\n<<<<<<< a\nx\n=======\ny\n>>>>>>> b')).toMatchObject([
      { oursLines: ['x'], theirsLines: ['y'], contextBefore: 'lost', contextAfter: null },
    ])
  })
})

describe('locateLines', () => {
  const clean = ['a', 'x', 'b', 'c', 'x', 'd']
  it('finds the block by content (1-based)', () => {
    expect(locateLines(clean, ['b', 'c'], null, null)).toEqual({ start: 3, end: 4, isContentMatch: true })
  })
  it('narrows several matches by the outside context', () => {
    expect(locateLines(clean, ['x'], 'c', 'd')).toEqual({ start: 5, end: 5, isContentMatch: true })
  })
  it('falls back to the context line when the side is empty', () => {
    expect(locateLines(clean, [], 'b', null)).toEqual({ start: 3, end: 3, isContentMatch: false })
  })
  it('is null when nothing matches or there is nothing to look for', () => {
    expect(locateLines(clean, ['zzz'], null, null)).toBeNull()
    expect(locateLines(clean, [], null, null)).toBeNull()
  })
})

describe('hunks', () => {
  it('equal apart from whitespace and blank lines', () => {
    expect(linesEqualIgnoringWhitespace(['  a  b', '', 'c'], ['a b', 'c '])).toBe(true)
    expect(linesEqualIgnoringWhitespace(['a'], ['b'])).toBe(false)
  })
  it('cuts the preview and shows a start only on a content match', () => {
    const long = Array.from({ length: CONFLICT_HUNK_PREVIEW_LINES + 5 }, (_, i) => `l${i}`)
    const hunk = toConflictHunk({ oursLines: long, theirsLines: [], contextBefore: null, contextAfter: null }, { start: 7, end: 9, isContentMatch: true }, { start: 3, end: 3, isContentMatch: false })
    expect(hunk.oursText).toHaveLength(CONFLICT_HUNK_PREVIEW_LINES)
    expect(hunk.oursStartLine).toBe(7)
    expect(hunk.theirsStartLine).toBeNull()
    expect(hunk.sameContent).toBe(false)
  })
})

describe('BlameTally', () => {
  const sha = (c: string) => c.repeat(40)
  const porcelain = (lines: Array<[string, string?]>) =>
    lines.map(([s, meta]) => `${sha(s)} 1 1 1\n${meta ? `${meta}\n` : ''}\tcode`).join('\n')
  it('picks the commit owning most lines, metadata from its first mention', () => {
    const tally = new BlameTally()
    tally.add(porcelain([['a', 'author Ann\nauthor-time 100\nsummary first'], ['b', 'author Bob\nauthor-time 200\nsummary second'], ['a']]))
    expect(tally.primary()).toMatchObject({ sha: sha('a'), authorName: 'Ann', subject: 'first', authorDate: new Date(100000).toISOString() })
  })
  it('on a tie takes the newer one; empty — null', () => {
    const tally = new BlameTally()
    expect(tally.primary()).toBeNull()
    tally.add(porcelain([['a', 'author Ann\nauthor-time 100\nsummary a'], ['b', 'author Bob\nauthor-time 200\nsummary b']]))
    expect(tally.primary()?.sha).toBe(sha('b'))
  })
  it('keeps the first author, skips other fields and code lines that look like fields', () => {
    const tally = new BlameTally()
    tally.add(porcelain([['a', 'author Ann\nauthor-mail <ann@x>\nauthor-time 100\nsummary first']]))
    tally.add(`${sha('a')} 1 1 1\nauthor Other\nsummary later\n\tauthor Code`)
    expect(tally.primary()).toMatchObject({ authorName: 'Ann', subject: 'first' })
  })
})

describe('isBetterDivergence', () => {
  it('a closer content match wins, then the newer date', () => {
    expect(isBetterDivergence('different', '1', null)).toBe(true)
    expect(isBetterDivergence('identical', '1', { match: 'different', date: '9' })).toBe(true)
    expect(isBetterDivergence('near-identical', '1', { match: 'identical', date: '0' })).toBe(false)
    expect(isBetterDivergence('identical', '2', { match: 'identical', date: '1' })).toBe(true)
  })
})
