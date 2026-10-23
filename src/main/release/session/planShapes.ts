import { extractTaskKey } from '../config';
import { MAX_COMMITS_PER_BRANCH, type SkippedBranch } from '../core/planner';
import { BranchRef, MergeEventInfo, PlanItem, ReleasePlan } from '../core/types';
import type { FirstParentCommit, MergeEventDetails } from '../git/gitService';
import type { CommitLinks } from './releaseLinks';

/** Links of a branch / commit (see ReleaseLinks.of). */
export type LinksOf = (branchName: string, subject: string, sha: string, prNumber: number | null) => CommitLinks;

/** Oldest author date first. */
export const byAuthorDate = (a: { authorDate: string }, b: { authorDate: string }): number => (a.authorDate < b.authorDate ? -1 : 1);

/** An empty but valid plan — the client learns the release branch from it before there is any chronology. */
export function emptyPlanFor(releaseBranch: string, mainBranch = ''): ReleasePlan {
  return {
    releaseBranch,
    mainBranch,
    items: [],
    contextCommits: [],
    contextCommitsTruncated: false,
    anchorCommit: null,
    mergeEventsByBranch: {},
    absorbedBranches: [],
  };
}

/**
 * Sets each item's PR (the merge that really absorbed THAT commit — the one having it as a parent) with its
 * links, and gathers each branch's merge events. By topology (see GitService.listMergeEvents); a branch may be
 * merged several times, one merge may absorb several commits — events are deduplicated by the merge's sha.
 */
export function collectMergeEvents(
  items: PlanItem[],
  mergeEventsByParentSha: Map<string, MergeEventDetails[]>,
  linksOf: LinksOf
): Record<string, MergeEventInfo[]> {
  const mergeEventsByBranch: Record<string, MergeEventInfo[]> = {};
  for (const branch of new Set(items.map((i) => i.branch))) {
    const seenMergeShas = new Set<string>();
    const relevant: MergeEventDetails[] = [];
    for (const item of items.filter((i) => i.branch === branch)) {
      const ownEvents = (mergeEventsByParentSha.get(item.sha) ?? []).slice().sort(byAuthorDate);
      item.prNumber = ownEvents[0]?.prNumber ?? null;
      Object.assign(item, linksOf(item.branch, item.subject, item.sha, item.prNumber));
      for (const ev of ownEvents) {
        if (seenMergeShas.has(ev.sha)) continue;
        seenMergeShas.add(ev.sha);
        relevant.push(ev);
      }
    }
    if (relevant.length === 0) continue;
    mergeEventsByBranch[branch] = relevant
      .slice()
      .sort(byAuthorDate)
      .map((ev) => ({
        sha: ev.sha,
        subject: ev.subject,
        authorDate: ev.authorDate,
        authorName: ev.authorName,
        prNumber: ev.prNumber,
        ...linksOf(branch, ev.subject, ev.sha, ev.prNumber),
      }));
  }
  return mergeEventsByBranch;
}

/** The PR of a branch's last commit: the earliest merge having it as a parent. */
export function lastCommitPrNumber(branch: BranchRef, mergeEventsByParentSha: Map<string, MergeEventDetails[]>): number | null {
  const ownEvents = mergeEventsByParentSha.get(branch.lastCommitSha) ?? [];
  return ownEvents.slice().sort(byAuthorDate)[0]?.prNumber ?? null;
}

/**
 * Release branch commits → live branches by the task key of each commit's subject (one branch per key).
 * The keys covered, so the rest can become orphan items.
 */
export function matchReleaseCommitsToBranches(commits: FirstParentCommit[], candidates: BranchRef[]): { matchedRefs: string[]; coveredKeys: Set<string> } {
  const matchedRefs: string[] = [];
  const coveredKeys = new Set<string>();
  for (const c of commits) {
    const key = extractTaskKey(c.subject);
    if (!key) continue;
    const branch = candidates.find((b) => extractTaskKey(b.name) === key);
    if (branch && !coveredKeys.has(key)) {
      coveredKeys.add(key);
      matchedRefs.push(branch.ref);
    }
  }
  return { matchedRefs, coveredKeys };
}

/** Release branch commits whose task matched no live branch (or that have no key). */
export function uncoveredCommits(commits: FirstParentCommit[], coveredKeys: Set<string>): FirstParentCommit[] {
  return commits.filter((c) => {
    const key = extractTaskKey(c.subject);
    return !key || !coveredKeys.has(key);
  });
}

/**
 * A commit already on the release branch as an "orphan" plan item: applied and included (already committed),
 * its task key (or the release branch) as its pseudo-branch — enough for its lane colour and a disabled box.
 */
export function orphanPlanItem(commit: FirstParentCommit, releaseBranch: string, alreadyInMain: boolean, linksOf: LinksOf): PlanItem {
  const pseudoBranch = extractTaskKey(commit.subject) ?? releaseBranch;
  return {
    sha: commit.sha,
    parents: commit.parents,
    subject: commit.subject,
    authorDate: commit.authorDate,
    authorName: commit.authorName,
    alreadyInMain,
    branch: pseudoBranch,
    files: [],
    insertions: 0,
    deletions: 0,
    included: true,
    applied: true,
    overlapsWith: [],
    dryRunStatus: 'empty',
    dryRunConflictFiles: [],
    dryRunConflictSources: [],
    prNumber: null,
    ...linksOf(pseudoBranch, commit.subject, commit.sha, null),
  };
}

/** The warnings after building the chronology, as one message (empty — none). */
export function planWarnings(skipped: SkippedBranch[], truncatedBranches: string[], dryRunWarning: string | null): string[] {
  const warnings: string[] = [];
  if (skipped.length > 0) {
    warnings.push('Не удалось получить коммиты для веток: ' + skipped.map((s) => `${s.branch} (${s.reason})`).join('; '));
  }
  if (truncatedBranches.length > 0) {
    warnings.push(
      `У веток ${truncatedBranches.join(', ')} между ней и dev-веткой больше ${MAX_COMMITS_PER_BRANCH} коммитов — показаны только самые свежие. ` +
        'Возможно, dev-ветка сильно отстала или настройка devBranch указывает не туда — проверьте в настройках.'
    );
  }
  if (dryRunWarning) warnings.push(dryRunWarning);
  return warnings;
}

/** Why a release branch has no own commits: released into main already, or just empty. */
export function emptyReleaseBranchNote(releaseBranch: string, mainBranch: string, alreadyMerged: boolean): string {
  return alreadyMerged
    ? `Ветка ${releaseBranch} уже полностью выпущена в ${mainBranch} — собирать в неё больше нечего.`
    : `Ветка ${releaseBranch} создана, но в ней пока нет своих коммитов — выберите ветки ниже и постройте хронологию.`;
}
