import { BranchRef } from '../core/types';
import {
  BRANCH_REF_FORMAT,
  CANDIDATE_FORMAT,
  COMMIT_FORMAT,
  CandidateCommit,
  FirstParentCommit,
  MergeEventDetails,
  parseBranchRefs,
  parseCandidateLog,
  parseCommitRecord,
  parseMergeEventsByParent,
  parseNamedMergeEvents,
  parseNewestFirstLog,
  parseNumstat,
  parsePatchIdLines,
  parseSubjectDateIndex,
  splitLines,
} from './gitRecords';
import { GitRepo } from './gitRepo';

/**
 * How many shas go into one `git log --no-walk -p` call: Windows limits a command line to ~32K chars
 * (`spawn ENAMETOOLONG`); 200 shas are ~8200.
 */
const PATCH_ID_CHUNK_SIZE = 200;
/** How many such chunks run at once (each is two git processes). */
const PATCH_ID_PARALLEL_CHUNKS = 3;

/**
 * Read-only history queries: the "already in main" indexes (patch-id, subject + author date), first-parent
 * logs, merge events, the branch list and the searches over not-yet-released commits.
 */
export class GitHistory extends GitRepo {
  /**
   * patch-id → sha over the ref's full history (not --first-parent: a task's commits reach main as the second
   * parent of a merge). Robust to cherry-pick (new sha, same diff). `sinceIso` bounds the walk — cherry-pick
   * keeps the author date, so a copy cannot appear before its original.
   */
  async computePatchIdIndex(ref: string, sinceIso?: string): Promise<Map<string, string>> {
    const logArgs = ['log', '-p'];
    if (sinceIso) logArgs.push(`--since=${sinceIso}`);
    logArgs.push(ref);
    const { stdout, code } = await this.pipeIntoPatchId(logArgs);
    if (code !== 0) return new Map();
    return new Map(parsePatchIdLines(stdout));
  }

  /**
   * "subject + author date" → sha over the ref's full history — the fallback when patch-id differs only
   * because the context around the change drifted; cherry-pick and rebase never change the author date.
   */
  async buildMainSubjectDateIndex(ref: string, sinceIso?: string): Promise<Map<string, string>> {
    const args = ['log', '--pretty=%H%x1f%s%x1f%aI'];
    if (sinceIso) args.push(`--since=${sinceIso}`);
    args.push(ref);
    return parseSubjectDateIndex(await this.git.raw(args));
  }

  /** sha → patch-id of the given commits, in chunks (see PATCH_ID_CHUNK_SIZE); the ones that failed are missing. */
  async computePatchIdsForCommits(shas: string[]): Promise<Map<string, string>> {
    if (shas.length === 0) return new Map();
    const chunks: string[][] = [];
    for (let i = 0; i < shas.length; i += PATCH_ID_CHUNK_SIZE) chunks.push(shas.slice(i, i + PATCH_ID_CHUNK_SIZE));
    const bySha = new Map<string, string>();
    for (let i = 0; i < chunks.length; i += PATCH_ID_PARALLEL_CHUNKS) {
      const results = await Promise.all(chunks.slice(i, i + PATCH_ID_PARALLEL_CHUNKS).map((chunk) => this.computePatchIdsForChunk(chunk)));
      for (const result of results) for (const [sha, patchId] of result) bySha.set(sha, patchId);
    }
    return bySha;
  }

  private async computePatchIdsForChunk(shas: string[]): Promise<Map<string, string>> {
    const { stdout, code } = await this.pipeIntoPatchId(['log', '--no-walk', '-p', ...shas]);
    if (code !== 0) return new Map();
    return new Map(parsePatchIdLines(stdout).map(([patchId, sha]) => [sha, patchId] as const));
  }

  /** The patch-id of a whole branch as one diff (base..tip) — catches branches squashed into one commit. */
  async computeWholeDiffPatchId(baseSha: string, tipRef: string): Promise<string | null> {
    const { stdout, code } = await this.pipeIntoPatchId(['diff', baseSha, tipRef]);
    if (code !== 0) return null;
    const [patchId] = stdout.trim().split(/\s+/);
    return patchId || null;
  }

  /** Every sha of the ref's first-parent history (hashes only — cheap): commits already on dev's main line. */
  async buildDevFirstParentSet(ref: string): Promise<Set<string>> {
    const raw = await this.git.raw(['log', '--first-parent', '--pretty=%H', ref]);
    return new Set(splitLines(raw));
  }

  /** The ref's first-parent history from its tip down, with no lower bound (oldest-first); `maxCount` caps the walk. */
  async firstParentChain(ref: string, maxCount: number): Promise<{ commits: FirstParentCommit[]; truncated: boolean }> {
    const raw = await this.git.raw(['log', '--first-parent', '--topo-order', `--max-count=${maxCount + 1}`, `--pretty=format:${COMMIT_FORMAT}%x1e`, ref]);
    return parseNewestFirstLog(raw, maxCount);
  }

  /**
   * First-parent history baseRef..headRef in integration order. Over `maxCount` the newest ones come back,
   * with truncated=true (e.g. a dev branch far behind).
   */
  async firstParentLog(baseRef: string, headRef: string, maxCount?: number): Promise<{ commits: FirstParentCommit[]; truncated: boolean }> {
    const args = ['log', '--first-parent', '--topo-order', `--pretty=format:${COMMIT_FORMAT}%x1e`];
    if (maxCount) args.push(`--max-count=${maxCount + 1}`);
    args.push(`${baseRef}..${headRef}`);
    return parseNewestFirstLog(await this.git.raw(args), maxCount);
  }

  /** First-parent history of a ref within a date range — the chronology's context commits. */
  async firstParentLogByDateRange(
    ref: string,
    sinceIso: string,
    untilIso: string,
    maxCount?: number
  ): Promise<{ commits: FirstParentCommit[]; truncated: boolean }> {
    const args = ['log', '--first-parent', '--topo-order', `--since=${sinceIso}`, `--until=${untilIso}`, `--pretty=format:${COMMIT_FORMAT}%x1e`];
    if (maxCount) args.push(`--max-count=${maxCount + 1}`);
    args.push(ref);
    return parseNewestFirstLog(await this.git.raw(args), maxCount);
  }

  /** The last commit that touched a file in a ref's history, or null — the coarse fallback of the conflict analysis. */
  async lastCommitTouchingFile(ref: string, file: string): Promise<FirstParentCommit | null> {
    const raw = await this.git.raw(['log', '-1', `--pretty=format:${COMMIT_FORMAT}`, ref, '--', file]);
    const trimmed = raw.trim();
    return trimmed ? parseCommitRecord(trimmed) : null;
  }

  /**
   * Commits touching a file on any branch (`--all`) and not yet in mainRef, with the ref git reached each from
   * (`--source`) — candidates for the real cause of a conflict. `--no-merges`: a merge has no diff of its own,
   * so it would never match main and would drag its whole branch in.
   */
  async logCommitsNotInRefTouchingFile(mainRef: string, file: string, maxCount: number): Promise<CandidateCommit[]> {
    const raw = await this.git.raw(['log', '--all', '--not', mainRef, '--source', '--no-merges', `--max-count=${maxCount}`, `--pretty=format:${CANDIDATE_FORMAT}%x1e`, '--', file]);
    return parseCandidateLog(raw);
  }

  /** The same over the whole repository, cut by the author date instead of a file — the forgotten branches scan. */
  async logCommitsNotInRefBeforeDate(devRef: string, beforeDateIso: string, maxCount: number): Promise<CandidateCommit[]> {
    const raw = await this.git.raw([
      'log',
      '--all',
      '--not',
      devRef,
      '--source',
      '--no-merges',
      `--until=${beforeDateIso}`,
      `--max-count=${maxCount}`,
      `--pretty=format:${CANDIDATE_FORMAT}%x1e`,
    ]);
    return parseCandidateLog(raw);
  }

  /**
   * parent sha → every merge commit of the ref's first-parent history having it as a parent, in one call.
   * Topology, not subject text: a plain merge always has the merged tip among its parents, whatever the
   * hosting, its UI language or a bare `git merge`. The PR number is decoration (see extractPrNumber).
   */
  async listMergeEvents(ref: string): Promise<Map<string, MergeEventDetails[]>> {
    const raw = await this.git.raw(['log', '--first-parent', '--merges', `--pretty=format:${COMMIT_FORMAT}`, ref]);
    return parseMergeEventsByParent(raw);
  }

  /**
   * Merges into devRef naming this exact branch ("Merged in <name> (pull request #" — Bitbucket EN / RU).
   * Text, not topology: the only trace of earlier rounds of a reused branch whose link a fast-forward erased.
   * Used only for branches the user picked.
   */
  async findBranchMergeEventsByName(devRef: string, branchName: string, limit: number): Promise<Array<{ sha: string; parents: string[]; authorDate: string }>> {
    const raw = await this.git.raw([
      'log',
      '--first-parent',
      devRef,
      '--fixed-strings',
      `--grep=Merged in ${branchName} (pull request #`,
      `--grep=Объединено в ${branchName} (pull-запрос #`,
      `--max-count=${limit}`,
      `--pretty=format:%H%x1f%P%x1f%aI%x1e`,
    ]);
    return parseNamedMergeEvents(raw);
  }

  /**
   * Local and remote-tracking branches, newest activity first (sorted by committer date), each with its last
   * commit. The card's date is the AUTHOR date: everything else compares by it (cherry-pick keeps it).
   */
  async listBranches(): Promise<BranchRef[]> {
    const raw = await this.git.raw(['for-each-ref', `--format=${BRANCH_REF_FORMAT}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes']);
    return parseBranchRefs(raw);
  }

  /**
   * Refs of branches with a not-yet-released commit whose message holds any of the needles — a task named only
   * in a commit message. Bounded by mainRef, not devRef (a branch's own commits may already be reachable from
   * dev). One call for all branches: `--source` names the ref each commit was reached from (one ref per commit).
   * Needles are literal (`--fixed-strings`) and ORed (several `--grep`).
   */
  async searchCommitMessages(needles: string[], mainRef: string): Promise<Set<string>> {
    if (needles.length === 0) return new Set();
    const args = ['log', '--branches', '--remotes', '--not', mainRef, '--source', '--fixed-strings', '-i'];
    for (const needle of needles) args.push(`--grep=${needle}`);
    args.push('--format=%S');
    return new Set(splitLines(await this.git.raw(args)));
  }

  /** Files and line totals of a commit against its first parent, in one `--numstat` call. */
  async diffStat(sha: string, firstParentSha: string): Promise<{ files: string[]; insertions: number; deletions: number }> {
    return parseNumstat(await this.git.raw(['diff', '--numstat', firstParentSha, sha]));
  }
}
