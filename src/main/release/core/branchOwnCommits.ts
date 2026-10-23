import { FirstParentCommit, GitService } from '../git/gitService';
import { mapWithConcurrency } from './concurrency';

/** The shas of dev's first-parent history — see GitService.buildDevFirstParentSet. */
export type DevFirstParentShas = Set<string>;

/** A base branch besides dev a branch may be forked from (e.g. qa — exact service branch names). */
export interface ExtraBaseRef {
  /** Ref for git (e.g. origin/qa) */
  ref: string;
  /** Short name shown to the user (e.g. qa) */
  name: string;
}

/** Where a walk down a branch's own history stopped: dev's main line, or another base branch. */
export type ChainBoundary = { kind: 'dev' } | { kind: 'extra'; name: string };

/**
 * Walks a first-parent chain (oldest-first) from its tip down to the first commit `boundaryOf` recognises;
 * the commits passed, oldest-first, without merges (admin "merge dev into the branch" syncs, not work).
 */
export function collectOwnCommits(
  chain: FirstParentCommit[],
  boundaryOf: (commit: FirstParentCommit) => ChainBoundary | undefined
): { own: FirstParentCommit[]; boundary: { commit: FirstParentCommit; at: ChainBoundary } | null } {
  const own: FirstParentCommit[] = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const commit = chain[i];
    const at = boundaryOf(commit);
    if (at) return { own: own.reverse(), boundary: { commit, at } };
    if (commit.parents.length > 1) continue;
    own.push(commit);
  }
  return { own: own.reverse(), boundary: null };
}

/** Optional: search earlier rounds of a reused branch (only for branches the user picked — see findEarlierDisconnectedRounds). */
export interface EarlierRoundsLookup {
  branchName: string;
  mainRef: string;
}

/**
 * A branch's own commits (unique against dev and the extra base branches).
 *
 * Usual case — no base branch has absorbed it: the nearest (newest) merge-base is the fork point. A branch
 * forked from qa (revert-pr-*) would otherwise count qa's history as its own.
 *
 * Absorbed (merge-base === tip; a name reused round after round): walk the branch's own first-parent
 * history down to dev's main line (devFirstParentShas) or an extra base's — unrelated dev commits between
 * rounds never appear on the branch's own chain, so they cannot stop the walk early.
 *
 * absorbed: true tells the client to close the branch's lane into the trunk even without a PR merge event
 * (e.g. dev was merged into the branch by hand).
 */
export async function resolveBranchOwnCommits(
  git: GitService,
  branchRef: string,
  devRef: string,
  devFirstParentShas: DevFirstParentShas,
  chainWalkCap: number,
  displayCap: number,
  extraBaseRefs: ExtraBaseRef[] = [],
  earlierRounds?: EarlierRoundsLookup
): Promise<{ commits: FirstParentCommit[]; truncated: boolean; forkedFrom?: string; absorbed: boolean }> {
  const branchTip = await git.resolveRef(branchRef);
  const baseCandidates = [{ ref: devRef, name: null as string | null }, ...extraBaseRefs.map((r) => ({ ref: r.ref, name: r.name }))];
  const mergeBaseResults = await mapWithConcurrency(baseCandidates, baseCandidates.length, async (candidate) => {
    try {
      return { ...candidate, sha: await git.mergeBase(candidate.ref, branchTip) };
    } catch {
      return null;
    }
  });
  const resolved = mergeBaseResults.filter((r): r is { ref: string; name: string | null; sha: string } => !!r);
  const forkPoints = resolved.filter((r) => r.sha !== branchTip);
  const absorbedBy = resolved.filter((r) => r.sha === branchTip);

  if (absorbedBy.length === 0) {
    let best = forkPoints[0];
    if (forkPoints.length > 1) {
      const dated = await mapWithConcurrency(forkPoints, forkPoints.length, async (fp) => ({ ...fp, date: await git.commitAuthorDate(fp.sha) }));
      dated.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      best = dated[0];
    }
    if (!best) return { commits: [], truncated: false, absorbed: false };
    const result = await git.firstParentLog(best.sha, branchRef, displayCap);
    return { ...result, forkedFrom: best.name ?? undefined, absorbed: false };
  }

  const extraBoundaries = await mapWithConcurrency(extraBaseRefs, extraBaseRefs.length, async (r) => ({
    name: r.name,
    shas: await git.buildDevFirstParentSet(r.ref),
  }));
  const { commits: chain, truncated: walkExhausted } = await git.firstParentChain(branchRef, chainWalkCap);
  const { own, boundary } = collectOwnCommits(chain, (commit): ChainBoundary | undefined => {
    if (devFirstParentShas.has(commit.sha)) return { kind: 'dev' };
    const extraHit = extraBoundaries.find((b) => b.shas.has(commit.sha));
    return extraHit ? { kind: 'extra', name: extraHit.name } : undefined;
  });

  // earlier rounds of the same branch whose link a fast-forward erased (not on the chain above at all)
  if (boundary?.at.kind === 'dev' && earlierRounds) {
    const earlier = await findEarlierDisconnectedRounds(git, devRef, earlierRounds, boundary.commit.sha, devFirstParentShas, chainWalkCap);
    if (earlier.length > 0) own.unshift(...earlier);
  }

  // the walk hit its cap before any boundary: older rounds may be missing (the session warns)
  const incomplete = walkExhausted && !boundary;
  const displayTruncated = own.length > displayCap;
  const commits = displayTruncated ? own.slice(own.length - displayCap) : own;
  const forkedFrom = boundary?.at.kind === 'extra' ? boundary.at.name : undefined;
  return { commits, truncated: displayTruncated || incomplete, forkedFrom, absorbed: true };
}

/**
 * Earlier rounds of a reused branch, found by the merge subjects naming it (see
 * GitService.findBranchMergeEventsByName) strictly before the current round's dev boundary. Walks from the
 * nearest round back and stops at the first one already in main — older ones are released too.
 */
async function findEarlierDisconnectedRounds(
  git: GitService,
  devRef: string,
  lookup: EarlierRoundsLookup,
  devBoundarySha: string,
  devFirstParentShas: DevFirstParentShas,
  chainWalkCap: number
): Promise<FirstParentCommit[]> {
  const events = await git.findBranchMergeEventsByName(devRef, lookup.branchName, 20);
  if (events.length === 0) return [];

  const priorEvents: typeof events = [];
  for (const event of events) {
    if (event.sha === devBoundarySha) continue;
    if (await git.isAncestor(event.sha, devBoundarySha)) priorEvents.push(event);
  }
  if (priorEvents.length === 0) return [];

  // newest first, as git log gave them
  const result: FirstParentCommit[] = [];
  for (const event of priorEvents) {
    const roundTip = event.parents[event.parents.length - 1];
    if (!roundTip) continue;
    if (await git.isAncestor(roundTip, lookup.mainRef)) break;
    const { commits: chain } = await git.firstParentChain(roundTip, chainWalkCap);
    const { own } = collectOwnCommits(chain, (commit) => (devFirstParentShas.has(commit.sha) ? { kind: 'dev' } : undefined));
    result.unshift(...own);
  }
  return result;
}
