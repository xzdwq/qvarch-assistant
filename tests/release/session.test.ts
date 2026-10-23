import { describe, expect, it } from 'vitest'
import { BranchRules, branchMatchesNeedles, dropDuplicateRemoteBranches, laterDate, parseFilterNeedles } from '../../src/main/release/session/branchRules'
import {
  collectMergeEvents,
  emptyPlanFor,
  emptyReleaseBranchNote,
  lastCommitPrNumber,
  matchReleaseCommitsToBranches,
  orphanPlanItem,
  planWarnings,
  uncoveredCommits,
} from '../../src/main/release/session/planShapes'
import type { BranchRef, PlanItem, ReleaseConfig } from '../../src/main/release/core/types'
import type { FirstParentCommit, MergeEventDetails } from '../../src/main/release/git/gitRecords'

const branch = (ref: string, over: Partial<BranchRef> = {}): BranchRef => ({
  ref,
  name: ref.replace(/^origin\//, ''),
  isRemote: ref.startsWith('origin/'),
  lastCommitSha: 'sha',
  lastCommitDate: '2024-01-01',
  lastCommitAuthor: 'A',
  lastCommitSubject: 's',
  mainStatus: 'none',
  prNumber: null,
  taskUrl: null,
  prUrl: null,
  commitUrl: null,
  ...over,
})
const config = {
  mainBranch: 'main',
  devBranch: 'dev',
  remoteName: 'origin',
  releaseBranchPattern: 'release/release-{date}',
  nonTaskBranchPrefixes: ['qa', 'revert-pr-', 'chore/'],
} as ReleaseConfig
const commit = (sha: string, subject: string, authorDate = '1'): FirstParentCommit => ({ sha, parents: [], subject, authorDate, authorName: 'A' })
const noLinks = () => ({ taskUrl: null, prUrl: null, commitUrl: null })

describe('branch filter', () => {
  it('splits by spaces, quotes keep a phrase', () => {
    expect(parseFilterNeedles('ABC-1  "Added Check" x"')).toEqual(['abc-1', 'added check', 'x"'])
    expect(parseFilterNeedles('   ')).toEqual([])
  })
  it('matches the name or the ref', () => {
    expect(branchMatchesNeedles(branch('origin/feature/abc-1'), ['origin/f'])).toBe(true)
    expect(branchMatchesNeedles(branch('feature/abc-1'), ['xyz'])).toBe(false)
  })
  it('drops a remote twin only when it points at the same commit', () => {
    const list = [branch('feature/a', { lastCommitSha: '1' }), branch('origin/feature/a', { lastCommitSha: '1' }), branch('feature/b', { lastCommitSha: '1' }), branch('origin/feature/b', { lastCommitSha: '2' })]
    expect(dropDuplicateRemoteBranches(list).map((b) => b.ref)).toEqual(['feature/a', 'feature/b', 'origin/feature/b'])
  })
  it('laterDate', () => {
    expect(laterDate('2024-01-02', '2024-01-03')).toBe('2024-01-03')
    expect(laterDate('2024-01-02', '2024-01-01')).toBe('2024-01-02')
    expect(laterDate('2024-01-02', null)).toBe('2024-01-02')
  })
})

describe('BranchRules', () => {
  const rules = new BranchRules(config)
  it('classifies names', () => {
    expect(rules.isRelease('release/release-2024-01-01')).toBe(true)
    expect(rules.isService('revert-pr-12')).toBe(true)
    expect(rules.isIgnorableCandidate('dev')).toBe(true)
    expect(rules.isIgnorableCandidate('feature/x')).toBe(false)
  })
  it('extra base refs: exact service names that exist, the remote first', () => {
    expect(rules.extraBaseRefs([branch('origin/qa'), branch('qa')])).toEqual([{ ref: 'origin/qa', name: 'qa' }])
    expect(rules.extraBaseRefs([branch('qa')])).toEqual([{ ref: 'qa', name: 'qa' }])
    expect(rules.extraBaseRefs([branch('chore/x')])).toEqual([])
  })
  it('the N-th newest release date and the release tips', () => {
    const list = [
      branch('release/release-1', { lastCommitDate: '2024-01-01', lastCommitSha: 'r1' }),
      branch('release/release-3', { lastCommitDate: '2024-03-01', lastCommitSha: 'r3' }),
      branch('release/release-2', { lastCommitDate: '2024-02-01', lastCommitSha: 'r2' }),
      branch('feature/x', { lastCommitDate: '2025-01-01' }),
    ]
    expect(rules.releaseLookbackDate(list, 2)).toBe('2024-02-01')
    expect(rules.releaseLookbackDate(list, 4)).toBeNull()
    expect([...rules.releaseTipShas(list)].sort()).toEqual(['r1', 'r2', 'r3'])
  })
})

describe('plan shapes', () => {
  const event = (sha: string, authorDate: string, prNumber: number | null): MergeEventDetails => ({ sha, parents: [], subject: 'm', authorDate, authorName: 'A', prNumber })
  it('collectMergeEvents: each item gets the PR of its own earliest merge, events deduplicated and sorted', () => {
    const items = [{ sha: 'a1', branch: 'A', subject: 's' }, { sha: 'a2', branch: 'A', subject: 's' }, { sha: 'b1', branch: 'B', subject: 's' }] as PlanItem[]
    const byParent = new Map([
      ['a1', [event('m2', '2', 2), event('m1', '1', 1)]],
      ['a2', [event('m2', '2', 2)]],
    ])
    const result = collectMergeEvents(items, byParent, noLinks)
    expect(items.map((i) => i.prNumber)).toEqual([1, 2, null])
    expect(result.A.map((e) => e.sha)).toEqual(['m1', 'm2'])
    expect(result.B).toBeUndefined()
  })
  it('lastCommitPrNumber', () => {
    expect(lastCommitPrNumber(branch('x', { lastCommitSha: 't' }), new Map([['t', [event('m2', '2', 2), event('m1', '1', 1)]]]))).toBe(1)
    expect(lastCommitPrNumber(branch('x'), new Map())).toBeNull()
  })
  it('release commits are matched to live branches by task key; the rest are orphans', () => {
    const commits = [commit('c1', '[ABC-1] one'), commit('c2', 'ABC-1 more'), commit('c3', 'ABC-2 gone'), commit('c4', 'no key')]
    const { matchedRefs, coveredKeys } = matchReleaseCommitsToBranches(commits, [branch('feature/ABC-1')])
    expect(matchedRefs).toEqual(['feature/ABC-1'])
    expect(uncoveredCommits(commits, coveredKeys).map((c) => c.sha)).toEqual(['c3', 'c4'])
  })
  it('an orphan item is applied, on its task key (or the release branch)', () => {
    const item = orphanPlanItem(commit('c3', 'ABC-2 gone'), 'release/r', true, noLinks)
    expect(item).toMatchObject({ branch: 'ABC-2', applied: true, included: true, alreadyInMain: true, dryRunStatus: 'empty' })
    expect(orphanPlanItem(commit('c4', 'no key'), 'release/r', false, noLinks).branch).toBe('release/r')
  })
  it('empty plan, warnings, note', () => {
    expect(emptyPlanFor('release/r')).toMatchObject({ releaseBranch: 'release/r', mainBranch: '', items: [] })
    expect(planWarnings([], [], null)).toEqual([])
    expect(planWarnings([{ branch: 'x', reason: 'boom' }], ['y'], 'dry')).toHaveLength(3)
    expect(emptyReleaseBranchNote('r', 'main', true)).toContain('уже полностью выпущена в main')
  })
})
