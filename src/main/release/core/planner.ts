/**
 * The release planner — what the session asks of git history, split by topic:
 * - branchOwnCommits — a branch's own commits against dev (and extra base branches);
 * - branchStatus — the expanded branch's commits, the exact "in main" status of the list;
 * - planItems — the chronology: plan items, overlaps, context and anchor commits;
 * - candidates — conflict causes and forgotten branches;
 * - refContentMatcher — "is this content already in that ref".
 */
export { MAX_COMMITS_PER_BRANCH, MAX_CONTEXT_COMMITS } from './planLimits';
export { mapWithConcurrency } from './concurrency';
export type { DevFirstParentShas, ExtraBaseRef } from './branchOwnCommits';
export { computeMainStatusForBranches, getBranchCommits } from './branchStatus';
export { buildPlanItems, findAnchorCommit, findContextCommits, type SkippedBranch } from './planItems';
export { findConflictCauses, findStaleUnmergedBranches } from './candidates';
export { findCommitsAlreadyInRef } from './refContentMatcher';
