import { describe, expect, it } from 'vitest'
import { collectOwnCommits, type ChainBoundary } from '../../src/main/release/core/branchOwnCommits'
import { mainStatusOf } from '../../src/shared/release'
import { newestPerBranch, refToBranchName, sourceRefToShortRef, toCandidateCauses } from '../../src/main/release/core/candidates'
import { mapWithConcurrency } from '../../src/main/release/core/concurrency'
import { earliestDate, latestDate } from '../../src/main/release/core/isoDates'
import { computeOverlaps } from '../../src/main/release/core/planItems'
import type { FirstParentCommit } from '../../src/main/release/git/gitRecords'
import type { PlanItem } from '../../src/main/release/core/types'

const commit = (sha: string, parents: string[] = ['p']): FirstParentCommit => ({ sha, parents, subject: sha, authorDate: '', authorName: '' })

describe('collectOwnCommits', () => {
  const chain = [commit('dev1'), commit('own1'), commit('sync', ['own1', 'dev2']), commit('own2')]
  const atDev = (c: FirstParentCommit): ChainBoundary | undefined => (c.sha.startsWith('dev') ? { kind: 'dev' } : undefined)
  it('walks from the tip to the boundary, skipping merges, oldest-first', () => {
    const { own, boundary } = collectOwnCommits(chain, atDev)
    expect(own.map((c) => c.sha)).toEqual(['own1', 'own2'])
    expect(boundary?.commit.sha).toBe('dev1')
  })
  it('reports no boundary when the chain ends first', () => {
    const { own, boundary } = collectOwnCommits(chain.slice(1), atDev)
    expect(own.map((c) => c.sha)).toEqual(['own1', 'own2'])
    expect(boundary).toBeNull()
  })
  it('tells which base it stopped at', () => {
    const { boundary } = collectOwnCommits(chain, (c) => (c.sha === 'own1' ? { kind: 'extra', name: 'qa' } : undefined))
    expect(boundary?.at).toEqual({ kind: 'extra', name: 'qa' })
  })
})

describe('mainStatusOf', () => {
  it('none / partial / full', () => {
    expect(mainStatusOf(0, 3)).toBe('none')
    expect(mainStatusOf(1, 3)).toBe('partial')
    expect(mainStatusOf(3, 3)).toBe('full')
  })
})

describe('computeOverlaps', () => {
  const item = (sha: string, branch: string, files: string[]) => ({ sha, branch, files, overlapsWith: [] as string[] }) as unknown as PlanItem
  it('links items of other branches touching the same files', () => {
    const items = [item('a1', 'A', ['x.ts']), item('a2', 'A', ['x.ts']), item('b1', 'B', ['x.ts', 'y.ts']), item('c1', 'C', ['z.ts'])]
    computeOverlaps(items)
    expect(items.map((i) => i.overlapsWith)).toEqual([['b1'], ['b1'], ['a1', 'a2'], []])
  })
})

describe('candidates', () => {
  it('ref names', () => {
    expect(refToBranchName('refs/heads/feature/x', 'origin')).toBe('feature/x')
    expect(refToBranchName('refs/remotes/origin/feature/x', 'origin')).toBe('feature/x')
    expect(refToBranchName('refs/remotes/up/feature/x', 'origin')).toBe('up/feature/x')
    expect(sourceRefToShortRef('refs/remotes/origin/feature/x')).toBe('origin/feature/x')
    expect(sourceRefToShortRef('HEAD')).toBe('HEAD')
  })
  it('drops known commits and ignorable branches', () => {
    const raw = [
      { sha: 's1', subject: 'a', authorDate: '1', authorName: 'A', sourceRef: 'refs/heads/feature/x' },
      { sha: 's2', subject: 'b', authorDate: '2', authorName: 'A', sourceRef: 'refs/heads/dev' },
      { sha: 's3', subject: 'c', authorDate: '3', authorName: 'A', sourceRef: 'refs/heads/feature/y' },
    ]
    const causes = toCandidateCauses(raw, new Set(['s3']), (name) => name === 'dev', 'origin')
    expect(causes.map((c) => [c.sha, c.branch, c.ref])).toEqual([['s1', 'feature/x', 'feature/x']])
  })
  it('keeps the newest commit per branch, newest branches first', () => {
    const cause = (sha: string, branch: string, authorDate: string) => ({ sha, branch, ref: branch, authorDate, subject: '', authorName: '', taskUrl: null, commitUrl: null })
    const picked = newestPerBranch([cause('a1', 'A', '1'), cause('b1', 'B', '5'), cause('a2', 'A', '3')], 5)
    expect(picked.map((c) => c.sha)).toEqual(['b1', 'a2'])
    expect(newestPerBranch([cause('a1', 'A', '1'), cause('b1', 'B', '5')], 1).map((c) => c.sha)).toEqual(['b1'])
  })
})

describe('helpers', () => {
  it('mapWithConcurrency keeps order and the limit', async () => {
    let running = 0
    let peak = 0
    const out = await mapWithConcurrency([5, 1, 3, 2], 2, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, n))
      running--
      return n * 10
    })
    expect(out).toEqual([50, 10, 30, 20])
    expect(peak).toBe(2)
  })
  it('earliest / latest ISO dates', () => {
    const items = [{ d: '2024-02-01' }, { d: '2023-12-31' }, { d: '2024-03-01' }]
    expect(earliestDate(items, (i) => i.d)).toBe('2023-12-31')
    expect(latestDate(items, (i) => i.d)).toBe('2024-03-01')
  })
})
