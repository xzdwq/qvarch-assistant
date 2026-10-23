import { CandidateCommit, LOCAL_BRANCH_REF_PREFIX, REMOTE_BRANCH_REF_PREFIX } from '../git/gitRecords';
import { GitService } from '../git/gitService';
import { MAX_STALE_CANDIDATES } from './planLimits';
import { RefContentMatcher } from './refContentMatcher';
import { ConflictCause, StaleBranchHint } from './types';

/** The ref without the first of the prefixes it starts with (they are tried in order); unchanged when none. */
function stripFirstPrefix(ref: string, prefixes: readonly string[]): string {
  const prefix = prefixes.find((p) => ref.startsWith(p));
  return prefix === undefined ? ref : ref.slice(prefix.length);
}

/** A ref git reached a commit from (`--source`) → the branch name, without refs/heads/ or the remote. */
export function refToBranchName(ref: string, remoteName: string): string {
  return stripFirstPrefix(ref, [LOCAL_BRANCH_REF_PREFIX, `${REMOTE_BRANCH_REF_PREFIX}${remoteName}/`, REMOTE_BRANCH_REF_PREFIX]);
}

/**
 * The same ref in refname:short (keeps the remote: origin/feature/X) — the format of BranchRef.ref, so the
 * client can put it into its selection directly ("Добавить в релиз").
 */
export function sourceRefToShortRef(ref: string): string {
  return stripFirstPrefix(ref, [LOCAL_BRANCH_REF_PREFIX, REMOTE_BRANCH_REF_PREFIX]);
}

/** Ignored branches and known commits out; candidates as ConflictCause rows (newest per branch is picked later). */
export function toCandidateCauses(
  raw: CandidateCommit[],
  excludeShas: Set<string>,
  isIgnorableCandidate: (name: string) => boolean,
  remoteName: string
): ConflictCause[] {
  return raw
    .filter((c) => !excludeShas.has(c.sha))
    .map((c) => ({
      sha: c.sha,
      subject: c.subject,
      authorName: c.authorName,
      authorDate: c.authorDate,
      branch: refToBranchName(c.sourceRef, remoteName),
      ref: sourceRefToShortRef(c.sourceRef),
      taskUrl: null,
      commitUrl: null,
    }))
    .filter((c) => !isIgnorableCandidate(c.branch));
}

/** The newest commit per branch, newest branches first, at most `limit`. */
export function newestPerBranch(causes: ConflictCause[], limit: number): ConflictCause[] {
  const byBranch = new Map<string, ConflictCause>();
  for (const c of causes) {
    const existing = byBranch.get(c.branch);
    if (!existing || c.authorDate > existing.authorDate) byBranch.set(c.branch, c);
  }
  return [...byBranch.values()].sort((a, b) => (a.authorDate < b.authorDate ? 1 : -1)).slice(0, limit);
}

/**
 * Raw not-yet-in-main candidates → genuine ones: known commits and main/dev/release/service branches out,
 * then those whose content is in main anyway (an old release branch is "not an ancestor" yet released),
 * one (the newest) commit per branch.
 */
async function filterGenuineCandidates(
  git: GitService,
  mainRef: string,
  raw: CandidateCommit[],
  excludeShas: Set<string>,
  isIgnorableCandidate: (name: string) => boolean,
  remoteName: string,
  limit: number
): Promise<ConflictCause[]> {
  const candidates = toCandidateCauses(raw, excludeShas, isIgnorableCandidate, remoteName);
  if (candidates.length === 0) return [];
  const matcher = await RefContentMatcher.build(git, mainRef, candidates);
  return newestPerBranch(
    candidates.filter((c) => !matcher.has(c)),
    limit
  );
}

/**
 * The likely real cause of a dry-run conflict on a file: commits of branches not picked yet that change the
 * same file and are not in main — narrow (one `git log` for that file), so it points at a forgotten task.
 */
export async function findConflictCauses(
  git: GitService,
  mainRef: string,
  file: string,
  excludeShas: Set<string>,
  isIgnorableCandidate: (name: string) => boolean,
  remoteName: string
): Promise<ConflictCause[]> {
  const raw = await git.logCommitsNotInRefTouchingFile(mainRef, file, 50);
  return filterGenuineCandidates(git, mainRef, raw, excludeShas, isIgnorableCandidate, remoteName, 5);
}

/**
 * Branches not in main with work before `beforeDateIso` (the session takes the later of: the newest picked
 * commit, the oldest of the last N release branches) — maybe a forgotten task. Against main, not dev: a branch
 * merged into dev but left out of releases for long is exactly what to hint at. A whole-repository scan.
 */
export async function findStaleUnmergedBranches(
  git: GitService,
  mainRef: string,
  beforeDateIso: string,
  excludeShas: Set<string>,
  isIgnorableCandidate: (name: string) => boolean,
  remoteName: string
): Promise<StaleBranchHint[]> {
  const raw = await git.logCommitsNotInRefBeforeDate(mainRef, beforeDateIso, MAX_STALE_CANDIDATES);
  const causes = await filterGenuineCandidates(git, mainRef, raw, excludeShas, isIgnorableCandidate, remoteName, 10);
  return causes.map(({ branch, ref, sha, subject, authorName, authorDate, taskUrl, commitUrl }) => ({
    branch,
    ref,
    sha,
    subject,
    authorName,
    authorDate,
    taskUrl,
    commitUrl,
  }));
}
