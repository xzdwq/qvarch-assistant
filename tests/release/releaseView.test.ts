import { describe, expect, it } from 'vitest'
import type { PlanItem } from '../../src/shared/release'
import {
  cherryPickSegments,
  compactCount,
  conflictBlockers,
  formatDateTime,
  ipcErrorText,
  overlapBranchNames,
  planMatchesSelection,
  segmentKey,
  shortSha,
  summarizeChronology,
  taskTickInfo,
  tickTaskBranches,
  uniqueConflictCauses,
} from '../../src/shared/releaseView'

const item = (sha: string, over: Partial<PlanItem> = {}) =>
  ({ sha, branch: 'A', authorName: 'Ann', insertions: 0, deletions: 0, files: [], included: true, applied: false, overlapsWith: [], dryRunStatus: 'ok', dryRunConflictFiles: [], dryRunConflictSources: [], ...over }) as unknown as PlanItem

describe('formatting', () => {
  it('sha, date, counts', () => {
    expect(shortSha('0123456789abcdef')).toBe('01234567')
    expect(formatDateTime(new Date(2024, 0, 2, 3, 4, 5).toISOString())).toBe('02.01.2024 03:04:05')
    expect(formatDateTime('not a date')).toBe('not a date')
    expect(formatDateTime(null)).toBe('')
    expect([999, 1000, 1500, 12345].map(compactCount)).toEqual(['999', '1k', '1.5k', '12k'])
  })
  it('strips the IPC prefix of an error', () => {
    expect(ipcErrorText(new Error("Error invoking remote method 'x': Error: boom"))).toBe('boom')
    expect(ipcErrorText('plain')).toBe('plain')
  })
})

describe('tickTaskBranches', () => {
  const branches = [{ name: 'feature/ABC-12', ref: 'r1' }, { name: 'ABC-123-other', ref: 'r2' }, { name: 'abc-12-fix', ref: 'r3' }]
  it('ticks the branches holding a key as a whole word', () => {
    const { selected, found } = tickTaskBranches(branches, ['ABC-12', 'XYZ-1'], new Set(['keep']))
    expect([...selected].sort()).toEqual(['keep', 'r1', 'r3'])
    expect(found).toBe(1)
    expect(taskTickInfo(2, found)).toBe('задач 2 · веток отмечено 1 · без ветки 1')
    expect(taskTickInfo(1, 1)).toBe('задач 1 · веток отмечено 1')
  })
})

describe('chronology', () => {
  it('summarizes the included items', () => {
    const s = summarizeChronology([
      item('a', { insertions: 3, files: ['x', 'y'], dryRunStatus: 'conflict' }),
      item('b', { branch: 'B', authorName: 'Bob', deletions: 2, files: ['y'], dryRunStatus: 'conditional' }),
    ])
    expect(s).toEqual({ commits: 2, branches: 2, authors: 2, ins: 3, del: 2, files: 2, conflicts: 1, conditional: 1 })
  })
  it('the plan matches the selection by branch names', () => {
    expect(planMatchesSelection(['A', 'B', 'A'], ['B', 'A'])).toBe(true)
    expect(planMatchesSelection(['A'], ['A', 'C'])).toBe(false)
  })
  it('cherry-pick commands end at a conflict or an unchecked commit', () => {
    const segs = cherryPickSegments([item('1'), item('2', { dryRunStatus: 'conflict' }), item('3', { dryRunStatus: 'conditional' }), item('4')])
    expect(segs.map(segmentKey)).toEqual(['1,2', '3', '4'])
  })
  it('conflict hints', () => {
    const cause = (branch: string) => ({ branch, ref: branch, sha: 's', subject: '', authorName: '', authorDate: '', taskUrl: null, commitUrl: null })
    const it1 = item('c', { dryRunConflictSources: [{ possibleCauses: [cause('X'), cause('Y')] }, { possibleCauses: [cause('X')] }] } as unknown as Partial<PlanItem>)
    expect(uniqueConflictCauses(it1).map((c) => c.branch)).toEqual(['X', 'Y'])

    const a = item('a', { dryRunStatus: 'conflict', files: ['f'] })
    const b = item('b', { dryRunStatus: 'conflict', files: ['g'] })
    const c = item('c', { dryRunStatus: 'conditional', dryRunConflictFiles: ['f'] })
    expect(conflictBlockers(c, [a, b, c, item('d', { dryRunStatus: 'conflict', files: ['f'] })])).toEqual([a])

    const shaToBranch = new Map([['o1', 'B'], ['o2', 'B']])
    expect(overlapBranchNames(item('x', { overlapsWith: ['o1', 'o2'] }), shaToBranch)).toBe('B')
    expect(overlapBranchNames(item('x', { overlapsWith: ['zz'] }), shaToBranch)).toBe('1 коммит(ами) на других ветках')
  })
})
