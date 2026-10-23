/** The planner's limits: caps against anomalous ranges and how many git calls run at once. */

/** Commits taken per branch at most (e.g. a dev branch far behind). */
export const MAX_COMMITS_PER_BRANCH = 300;

/** Parallel git calls for interactive work the user waits for (the chronology of the picked branches). */
export const CONCURRENCY = 6;

/**
 * Parallel git calls for background passes (the exact "in main" status over the shown list) — lower: a
 * process spawn is costly on Windows, and a long scan at 12 at once slowed unrelated actions down.
 */
export const BACKGROUND_CONCURRENCY = 3;

/** git's empty tree — the diff base of a root commit. */
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** How deep a branch's own first-parent history is walked to find where it joins dev (room for reused names). */
export const CHAIN_WALK_CAP = 2000;

/** Context (background) dev commits in the chronology at most. */
export const MAX_CONTEXT_COMMITS = 200;

/** Candidates of the forgotten branches scan at most (a scan of the whole repository — kept cheap). */
export const MAX_STALE_CANDIDATES = 100;
