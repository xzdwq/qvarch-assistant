import { describe, expect, it } from 'vitest'
import {
  extractPrNumber,
  findPreviousReleaseMerge,
  mainSubjectDateKey,
  parseBranchRefs,
  parseCandidateLog,
  parseMergeEventsByParent,
  parseNewestFirstLog,
  parseNumstat,
  parsePatchIdLines,
  parseSubjectDateIndex,
  type FirstParentCommit,
} from '../../src/main/release/git/gitRecords'

const F = '\x1f'
const R = '\x1e'
const commitRec = (sha: string, parents: string, subject: string, date = '2024-01-01T00:00:00Z', author = 'A') =>
  [sha, parents, subject, date, author].join(F) + R + '\n'
const commit = (sha: string, parents: string[] = ['p']): FirstParentCommit => ({ sha, parents, subject: sha, authorDate: '', authorName: '' })

describe('extractPrNumber', () => {
  it('reads the known hosting formats', () => {
    expect(extractPrNumber('Merged in feature/x (pull request #42)')).toBe(42)
    expect(extractPrNumber('Объединено в feature/x (pull-запрос #7)')).toBe(7)
    expect(extractPrNumber('Merge pull request #13 from user/branch')).toBe(13)
    expect(extractPrNumber('Merge branch into dev !99')).toBe(99)
  })
  it('is null for anything else', () => {
    expect(extractPrNumber("Merge branch 'dev' into feature/x")).toBeNull()
  })
})

describe('parseNewestFirstLog', () => {
  const raw = commitRec('c3', 'c2', 'third') + commitRec('c2', 'c1 m1', 'second') + commitRec('c1', '', 'first')
  it('returns the commits oldest-first with their parents', () => {
    const { commits, truncated } = parseNewestFirstLog(raw)
    expect(commits.map((c) => c.sha)).toEqual(['c1', 'c2', 'c3'])
    expect(commits[1].parents).toEqual(['c1', 'm1'])
    expect(commits[0].parents).toEqual([])
    expect(truncated).toBe(false)
  })
  it('keeps the newest `cap` commits and flags the rest', () => {
    const { commits, truncated } = parseNewestFirstLog(raw, 2)
    expect(commits.map((c) => c.sha)).toEqual(['c2', 'c3'])
    expect(truncated).toBe(true)
  })
  it('is not truncated at exactly `cap`', () => {
    expect(parseNewestFirstLog(raw, 3).truncated).toBe(false)
  })
})

describe('parsers of single formats', () => {
  it('candidate log', () => {
    const raw = ['s1', 'subj', 'd1', 'A', 'refs/heads/feature/x'].join(F) + R + '\n'
    expect(parseCandidateLog(raw)).toEqual([{ sha: 's1', subject: 'subj', authorDate: 'd1', authorName: 'A', sourceRef: 'refs/heads/feature/x' }])
  })
  it('patch-id lines', () => {
    expect(parsePatchIdLines('p1 s1\n\np2 s2\nbad\n')).toEqual([
      ['p1', 's1'],
      ['p2', 's2'],
    ])
  })
  it('subject + date index keeps the first (newest) sha per key', () => {
    const raw = ['s2', 'fix', 'd'].join(F) + '\n' + ['s1', 'fix', 'd'].join(F) + '\n' + ['s0', '', 'd'].join(F) + '\n'
    const index = parseSubjectDateIndex(raw)
    expect(index.get(mainSubjectDateKey('fix', 'd'))).toBe('s2')
    expect(index.size).toBe(1)
  })
  it('numstat sums text files and lists binary ones', () => {
    expect(parseNumstat('3\t1\ta.ts\n-\t-\timg.png\n0\t2\tdir/b c.ts\n')).toEqual({ files: ['a.ts', 'img.png', 'dir/b c.ts'], insertions: 3, deletions: 3 })
  })
  it('merge events are indexed by every parent', () => {
    const raw = ['m1', 'p1 t1', 'Merged in x (pull request #5)', 'd', 'A'].join(F) + '\n'
    const map = parseMergeEventsByParent(raw)
    expect(map.get('p1')?.[0].prNumber).toBe(5)
    expect(map.get('t1')?.[0].sha).toBe('m1')
  })
  it('branch refs: remote names lose the remote, <remote>/HEAD is dropped', () => {
    const line = (short: string, full: string) => [short, full, 'sha', 'date', 'A', 'subj'].join('\t')
    const branches = parseBranchRefs([line('origin/HEAD', 'refs/remotes/origin/HEAD'), line('origin/feature/x', 'refs/remotes/origin/feature/x'), line('dev', 'refs/heads/dev')].join('\n'))
    expect(branches.map((b) => [b.ref, b.name, b.isRemote])).toEqual([
      ['origin/feature/x', 'feature/x', true],
      ['dev', 'dev', false],
    ])
    expect(branches[0].mainStatus).toBe('none')
  })
})

describe('findPreviousReleaseMerge', () => {
  it('finds the merge nearest to the tip whose second parent is another release tip', () => {
    const chain = [commit('old', ['x', 'rel-old']), commit('a'), commit('near', ['y', 'rel-prev']), commit('admin', ['z', 'other']), commit('tip')]
    expect(findPreviousReleaseMerge(chain, 'tip', new Set(['rel-old', 'rel-prev']))?.sha).toBe('near')
  })
  it('ignores merges of unrelated branches', () => {
    expect(findPreviousReleaseMerge([commit('m', ['a', 'b']), commit('tip')], 'tip', new Set(['c']))).toBeUndefined()
  })
})
