import { FirstParentCommit, GitService } from '../git/gitService';
import { DevFirstParentShas, ExtraBaseRef, resolveBranchOwnCommits } from './branchOwnCommits';
import { mapWithConcurrency } from './concurrency';
import { BACKGROUND_CONCURRENCY, CHAIN_WALK_CAP, CONCURRENCY, EMPTY_TREE_SHA, MAX_COMMITS_PER_BRANCH } from './planLimits';
import { RefContentMatcher } from './refContentMatcher';
import { BranchCommitInfo, BranchDiffStat, BranchRef, CommitInfo, MainStatus, mainStatusOf } from './types';

/** No own commits (already part of dev) or a failed diff — a known zero, never an endless spinner. */
const ZERO_DIFF_STAT: BranchDiffStat = { insertions: 0, deletions: 0, filesChanged: 0 };

/** Marks the commits whose content is already in main (patch-id / subject + date — see RefContentMatcher). */
async function markAlreadyInMain(git: GitService, commits: FirstParentCommit[], mainRef: string): Promise<CommitInfo[]> {
  if (commits.length === 0) return [];
  const matcher = await RefContentMatcher.build(git, mainRef, commits);
  return commits.map((c) => ({
    ...c,
    alreadyInMain: matcher.has(c),
    taskUrl: null, // the session adds the links — the planner knows no link settings
    commitUrl: null,
  }));
}

/**
 * A branch's own commits for the preview (a branch expanded in the list), each with its line totals — only
 * when the user expands it, so the per-commit diff stays out of the chronology's other commits.
 */
export async function getBranchCommits(
  git: GitService,
  branch: BranchRef,
  devRef: string,
  mainRef: string,
  devFirstParentShas?: DevFirstParentShas,
  extraBaseRefs: ExtraBaseRef[] = []
): Promise<{ commits: BranchCommitInfo[]; truncated: boolean; forkedFrom?: string }> {
  const ownShas = devFirstParentShas ?? (await git.buildDevFirstParentSet(devRef));
  const { commits, truncated, forkedFrom } = await resolveBranchOwnCommits(git, branch.ref, devRef, ownShas, CHAIN_WALK_CAP, MAX_COMMITS_PER_BRANCH, extraBaseRefs, {
    branchName: branch.name,
    mainRef,
  });
  const withMainStatus = await markAlreadyInMain(git, commits, mainRef);
  const diffStats = await mapWithConcurrency(withMainStatus, CONCURRENCY, (commit) => git.diffStat(commit.sha, commit.parents[0] ?? EMPTY_TREE_SHA));
  const withDiffStat = withMainStatus.map((commit, i) => ({ ...commit, insertions: diffStats[i].insertions, deletions: diffStats[i].deletions }));
  return { commits: withDiffStat, truncated, forkedFrom };
}

/**
 * The exact "in main" status (none / partial / full) of a list of branches by ALL their own commits — the
 * background refinement of the session's quick guess by the last commit. Up to two git calls per branch.
 * On the way, each branch's total diff (first parent of its earliest own commit .. its tip) for the row preview.
 */
export async function computeMainStatusForBranches(
  git: GitService,
  branches: BranchRef[],
  devRef: string,
  mainRef: string,
  devFirstParentShas: DevFirstParentShas,
  extraBaseRefs: ExtraBaseRef[] = []
): Promise<{ statusByRef: Map<string, MainStatus>; diffStatByRef: Map<string, BranchDiffStat> }> {
  const perBranch = await mapWithConcurrency(branches, BACKGROUND_CONCURRENCY, async (branch) => {
    try {
      const { commits } = await resolveBranchOwnCommits(git, branch.ref, devRef, devFirstParentShas, CHAIN_WALK_CAP, MAX_COMMITS_PER_BRANCH, extraBaseRefs);
      return { ref: branch.ref, commits, diffStat: await branchDiffStat(git, commits) };
    } catch {
      return { ref: branch.ref, commits: [] as FirstParentCommit[], diffStat: ZERO_DIFF_STAT };
    }
  });

  const statusByRef = new Map<string, MainStatus>();
  const diffStatByRef = new Map(perBranch.map(({ ref, diffStat }) => [ref, diffStat] as const));
  const allCommits = perBranch.flatMap((b) => b.commits);
  if (allCommits.length === 0) return { statusByRef, diffStatByRef };

  const matcher = await RefContentMatcher.build(git, mainRef, allCommits);
  for (const { ref, commits } of perBranch) {
    // no own commits: nothing to refine — the quick status stays
    if (commits.length === 0) continue;
    statusByRef.set(ref, mainStatusOf(commits.filter((c) => matcher.has(c)).length, commits.length));
  }
  return { statusByRef, diffStatByRef };
}

/** The branch's total diff over its own commits; zero when there are none or git failed (a secondary summary). */
async function branchDiffStat(git: GitService, commits: FirstParentCommit[]): Promise<BranchDiffStat> {
  if (commits.length === 0) return ZERO_DIFF_STAT;
  try {
    const base = commits[0].parents[0] ?? EMPTY_TREE_SHA;
    const tip = commits[commits.length - 1].sha;
    const stat = await git.diffStat(tip, base);
    return { insertions: stat.insertions, deletions: stat.deletions, filesChanged: stat.files.length };
  } catch {
    return ZERO_DIFF_STAT;
  }
}
