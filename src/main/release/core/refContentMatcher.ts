import { GitService, mainSubjectDateKey } from '../git/gitService';
import { earliestDate } from './isoDates';

/** What a commit is matched by: its sha (for its patch-id), subject and author date. */
export interface MatchableCommit {
  sha: string;
  subject: string;
  authorDate: string;
}

/**
 * Whether a commit's CONTENT (not its sha — a cherry-pick has another sha and parents) is already in a ref:
 * by patch-id first (the exact diff), then by subject + author date (patch-id differs when the context around
 * the change drifted; the author date never changes). One index per batch of commits.
 */
export class RefContentMatcher {
  private constructor(
    private readonly patchIndex: Map<string, string>,
    private readonly subjectDateIndex: Map<string, string>,
    private readonly ownPatchIds: Map<string, string>
  ) {}

  /** The indexes of `ref` since the batch's earliest commit, and the batch's own patch-ids. */
  static async build(git: GitService, ref: string, commits: MatchableCommit[]): Promise<RefContentMatcher> {
    const since = earliestDate(commits, (c) => c.authorDate);
    const [patchIndex, subjectDateIndex, ownPatchIds] = await Promise.all([
      git.computePatchIdIndex(ref, since),
      git.buildMainSubjectDateIndex(ref, since),
      git.computePatchIdsForCommits(commits.map((c) => c.sha)),
    ]);
    return new RefContentMatcher(patchIndex, subjectDateIndex, ownPatchIds);
  }

  /** The commit's content is in the ref. */
  has(commit: MatchableCommit): boolean {
    const patchId = this.ownPatchIds.get(commit.sha);
    if (patchId && this.patchIndex.has(patchId)) return true;
    return this.subjectDateIndex.has(mainSubjectDateKey(commit.subject, commit.authorDate));
  }

  /** A diff with this patch-id is in the ref (e.g. a whole branch squashed into one commit). */
  hasPatchId(patchId: string): boolean {
    return this.patchIndex.has(patchId);
  }
}

/**
 * The shas of the commits whose content is already in `ref` — e.g. which plan items are already applied to
 * the release branch after a restart (the saved flag may lag behind the real history).
 */
export async function findCommitsAlreadyInRef(git: GitService, ref: string, commits: MatchableCommit[]): Promise<Set<string>> {
  if (commits.length === 0) return new Set();
  const matcher = await RefContentMatcher.build(git, ref, commits);
  return new Set(commits.filter((c) => matcher.has(c)).map((c) => c.sha));
}
