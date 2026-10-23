import { GitService } from '../git/gitService';
import { DevFirstParentShas, ExtraBaseRef, resolveBranchOwnCommits } from './branchOwnCommits';
import { mapWithConcurrency } from './concurrency';
import { CHAIN_WALK_CAP, CONCURRENCY, EMPTY_TREE_SHA, MAX_COMMITS_PER_BRANCH, MAX_CONTEXT_COMMITS } from './planLimits';
import { RefContentMatcher } from './refContentMatcher';
import { BranchRef, CommitInfo, PlanItem } from './types';

export interface SkippedBranch {
  branch: string;
  reason: string;
}

/** A picked branch's own commits as plan items (with their files and line totals); `base` — the diff base of the whole branch. */
async function collectBranchItems(
  git: GitService,
  branch: BranchRef,
  devRef: string,
  mainRef: string,
  devFirstParentShas: DevFirstParentShas,
  extraBaseRefs: ExtraBaseRef[] = []
): Promise<{ items: PlanItem[]; truncated: boolean; base: string; absorbed: boolean }> {
  const { commits, truncated, absorbed } = await resolveBranchOwnCommits(
    git,
    branch.ref,
    devRef,
    devFirstParentShas,
    CHAIN_WALK_CAP,
    MAX_COMMITS_PER_BRANCH,
    extraBaseRefs,
    { branchName: branch.name, mainRef }
  );
  const diffStats = await mapWithConcurrency(commits, CONCURRENCY, (commit) => git.diffStat(commit.sha, commit.parents[0] ?? EMPTY_TREE_SHA));
  const items: PlanItem[] = commits.map((commit, i) => ({
    sha: commit.sha,
    parents: commit.parents,
    subject: commit.subject,
    authorDate: commit.authorDate,
    authorName: commit.authorName,
    alreadyInMain: false, // one pass over all items in buildPlanItems
    branch: branch.name,
    files: diffStats[i].files,
    insertions: diffStats[i].insertions,
    deletions: diffStats[i].deletions,
    included: true,
    applied: false,
    overlapsWith: [],
    dryRunStatus: 'untested',
    dryRunConflictFiles: [],
    dryRunConflictSources: [],
    prNumber: null, // the session fills it from the merge events
    taskUrl: null,
    prUrl: null,
    commitUrl: null,
  }));
  // the whole-branch diff base (computeWholeDiffPatchId); no own commits — the empty tree is a valid base
  const base = commits[0]?.parents[0] ?? EMPTY_TREE_SHA;
  return { items, truncated, base, absorbed };
}

/** Marks each item touching the same files as items of OTHER picked branches. */
export function computeOverlaps(items: PlanItem[]): void {
  const fileOwners = new Map<string, string[]>();
  for (const item of items) {
    for (const file of item.files) {
      const owners = fileOwners.get(file) ?? [];
      owners.push(item.sha);
      fileOwners.set(file, owners);
    }
  }
  const branchBySha = new Map(items.map((i) => [i.sha, i.branch] as const));
  for (const item of items) {
    const overlap = new Set<string>();
    for (const file of item.files) {
      for (const otherSha of fileOwners.get(file) ?? []) {
        if (otherSha !== item.sha && branchBySha.get(otherSha) !== item.branch) overlap.add(otherSha);
      }
    }
    item.overlapsWith = [...overlap];
  }
}

/**
 * The picked branches' commits in author-date order, relative to dev, with file overlaps and "already in main"
 * (one index for all; plus each branch as one whole diff — catches a branch squashed into one commit).
 * absorbedBranches — branches dev absorbed without a PR merge: the client closes their lane into the trunk.
 */
export async function buildPlanItems(
  git: GitService,
  selectedBranches: BranchRef[],
  devRef: string,
  mainRef: string,
  devFirstParentShas: DevFirstParentShas,
  extraBaseRefs: ExtraBaseRef[] = []
): Promise<{ items: PlanItem[]; skipped: SkippedBranch[]; truncatedBranches: string[]; absorbedBranches: string[] }> {
  const all: PlanItem[] = [];
  const skipped: SkippedBranch[] = [];
  const truncatedBranches: string[] = [];
  const absorbedBranches: string[] = [];
  const basesByBranch = new Map<string, string>();

  for (const branch of selectedBranches) {
    try {
      const { items, truncated, base, absorbed } = await collectBranchItems(git, branch, devRef, mainRef, devFirstParentShas, extraBaseRefs);
      all.push(...items);
      basesByBranch.set(branch.name, base);
      if (truncated) truncatedBranches.push(branch.name);
      if (absorbed) absorbedBranches.push(branch.name);
    } catch (err: any) {
      skipped.push({ branch: branch.name, reason: err?.message ?? String(err) });
    }
  }

  all.sort((a, b) => new Date(a.authorDate).getTime() - new Date(b.authorDate).getTime());
  computeOverlaps(all);

  if (all.length > 0) {
    const matcher = await RefContentMatcher.build(git, mainRef, all);
    for (const item of all) item.alreadyInMain = matcher.has(item);

    // a branch whose commits were squashed into one: no single patch-id matches, the whole diff may
    const branchesToCheck = selectedBranches.filter((b) => !all.some((i) => i.branch === b.name && i.alreadyInMain));
    const wholeDiffPatchIds = await mapWithConcurrency(branchesToCheck, CONCURRENCY, async (branch) => {
      const base = basesByBranch.get(branch.name);
      return base ? git.computeWholeDiffPatchId(base, branch.ref) : null;
    });
    branchesToCheck.forEach((branch, i) => {
      const patchId = wholeDiffPatchIds[i];
      if (!patchId || !matcher.hasPatchId(patchId)) return;
      for (const item of all) if (item.branch === branch.name) item.alreadyInMain = true;
    });
  }

  return { items: all, skipped, truncatedBranches, absorbedBranches };
}

/** Dev commits between the chronology's oldest and newest commit that belong to no picked branch — context only. */
export async function findContextCommits(git: GitService, devRef: string, items: PlanItem[]): Promise<{ commits: CommitInfo[]; truncated: boolean }> {
  if (items.length === 0) return { commits: [], truncated: false };
  const dates = items.map((i) => i.authorDate);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const knownShas = new Set(items.map((i) => i.sha));
  const { commits, truncated } = await git.firstParentLogByDateRange(devRef, minDate, maxDate, MAX_CONTEXT_COMMITS);
  return {
    commits: commits.filter((c) => !knownShas.has(c.sha)).map((c) => ({ ...c, alreadyInMain: false, taskUrl: null, commitUrl: null })),
    truncated,
  };
}

/** The last dev commit strictly before the chronology starts — an anchor shown like the context commits. */
export async function findAnchorCommit(git: GitService, devRef: string, beforeDate: string): Promise<CommitInfo | null> {
  const { commits } = await git.firstParentLogByDateRange(devRef, '1970-01-01T00:00:00Z', beforeDate, 1);
  const commit = commits[0];
  return commit ? { ...commit, alreadyInMain: false, taskUrl: null, commitUrl: null } : null;
}
