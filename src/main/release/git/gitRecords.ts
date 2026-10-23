import { BranchRef } from '../core/types';

/**
 * Pure parsers of git's output for the release builder: the log formats it asks for, split into records
 * (`%x1e`) and fields (`%x1f`). No processes here — GitService runs git and hands the text over.
 */

const FIELD_SEPARATOR = '\x1f';
const RECORD_SEPARATOR = '\x1e';

/** The ref namespaces of local and of remote-tracking branches. */
export const LOCAL_BRANCH_REF_PREFIX = 'refs/heads/';
export const REMOTE_BRANCH_REF_PREFIX = 'refs/remotes/';

/** sha, parents, subject, author date, author — the commit format every first-parent log uses. */
export const COMMIT_FORMAT = ['%H', '%P', '%s', '%aI', '%an'].join('%x1f');
/** sha, subject, author date, author, the ref git reached it from (`--source`). */
export const CANDIDATE_FORMAT = ['%H', '%s', '%aI', '%an', '%S'].join('%x1f');

export interface FirstParentCommit {
  sha: string;
  parents: string[];
  subject: string;
  authorDate: string;
  authorName: string;
}

/** A merge commit (see GitService.listMergeEvents): its own sha, not a branch commit's. */
export interface MergeEventDetails {
  sha: string;
  /** Its parents: a plain merge always has the merged branch's tip among them (topology, not subject text). */
  parents: string[];
  subject: string;
  authorDate: string;
  authorName: string;
  /** Best-effort, only for the PR badge/link (see extractPrNumber); null when no known format matched. */
  prNumber: number | null;
}

/** A not-yet-released commit with the ref git reached it from (`--source`). */
export interface CandidateCommit {
  sha: string;
  subject: string;
  authorDate: string;
  authorName: string;
  sourceRef: string;
}

/** One key for the subject+author-date index, used both to build it and to look it up. */
export function mainSubjectDateKey(subject: string, authorDate: string): string {
  return `${subject} ${authorDate}`;
}

/**
 * Merge subjects a PR number can be read from — decoration only: the merge itself is found by topology,
 * so an unknown hosting or UI language just gets no PR badge.
 */
const PR_NUMBER_PATTERNS: RegExp[] = [
  /\(pull request #(\d+)\)/i, // Bitbucket (EN): Merged in X (pull request #42)
  /\(pull-запрос #(\d+)\)/i, // Bitbucket (RU): Объединено в X (pull-запрос #42)
  /^Merge pull request #(\d+) from/i, // GitHub: Merge pull request #42 from user/branch
  /!(\d+)$/, // GitLab: the subject usually ends with "...!42"
];

/** The PR number of a merge subject, or null. */
export function extractPrNumber(subject: string): number | null {
  const trimmed = subject.trim();
  for (const pattern of PR_NUMBER_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) return Number(match[1]);
  }
  return null;
}

/** Non-empty trimmed lines. */
export function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Non-empty trimmed `%x1e`-terminated records. */
export function splitRecords(raw: string): string[] {
  return raw
    .split(RECORD_SEPARATOR)
    .map((e) => e.trim())
    .filter(Boolean);
}

/** One COMMIT_FORMAT record. */
export function parseCommitRecord(entry: string): FirstParentCommit {
  const [sha, parents, subject, authorDate, authorName] = entry.split(FIELD_SEPARATOR);
  return { sha, parents: parents.split(' ').filter(Boolean), subject, authorDate, authorName };
}

/**
 * A newest-first COMMIT_FORMAT log asked for with `--max-count=cap+1`: the newest `cap` commits in the
 * chronological (oldest-first) order, and whether there were more.
 */
export function parseNewestFirstLog(raw: string, cap?: number): { commits: FirstParentCommit[]; truncated: boolean } {
  const entries = splitRecords(raw);
  const truncated = !!cap && entries.length > cap;
  const limited = truncated ? entries.slice(0, cap) : entries;
  return { commits: limited.map(parseCommitRecord).reverse(), truncated };
}

/** A CANDIDATE_FORMAT log. */
export function parseCandidateLog(raw: string): CandidateCommit[] {
  return splitRecords(raw).map((entry) => {
    const [sha, subject, authorDate, authorName, sourceRef] = entry.split(FIELD_SEPARATOR);
    return { sha, subject, authorDate, authorName, sourceRef };
  });
}

/** `git patch-id` output: [patchId, sha] pairs. */
export function parsePatchIdLines(stdout: string): Array<[patchId: string, sha: string]> {
  const pairs: Array<[string, string]> = [];
  for (const line of stdout.split('\n')) {
    const [patchId, sha] = line.trim().split(/\s+/);
    if (patchId && sha) pairs.push([patchId, sha]);
  }
  return pairs;
}

/** `%H%x1f%s%x1f%aI` lines → "subject + author date" → sha (the first, i.e. newest, wins). */
export function parseSubjectDateIndex(raw: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const line of splitLines(raw)) {
    const [sha, subject, authorDate] = line.split(FIELD_SEPARATOR);
    if (!sha || !subject || !authorDate) continue;
    const key = mainSubjectDateKey(subject, authorDate);
    if (!index.has(key)) index.set(key, sha);
  }
  return index;
}

/** COMMIT_FORMAT merge lines → parent sha → every merge that has it as a parent. */
export function parseMergeEventsByParent(raw: string): Map<string, MergeEventDetails[]> {
  const byParentSha = new Map<string, MergeEventDetails[]>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const [sha, parentsRaw, subject, authorDate, authorName] = line.split(FIELD_SEPARATOR);
    const parents = parentsRaw.split(' ').filter(Boolean);
    const event: MergeEventDetails = { sha, parents, subject, authorDate, authorName, prNumber: extractPrNumber(subject ?? '') };
    for (const parentSha of parents) {
      const list = byParentSha.get(parentSha) ?? [];
      list.push(event);
      byParentSha.set(parentSha, list);
    }
  }
  return byParentSha;
}

/** `%H%x1f%P%x1f%aI` records of merges found by the branch's name. */
export function parseNamedMergeEvents(raw: string): Array<{ sha: string; parents: string[]; authorDate: string }> {
  return splitRecords(raw).map((entry) => {
    const [sha, parentsRaw, authorDate] = entry.split(FIELD_SEPARATOR);
    return { sha, parents: parentsRaw.split(' ').filter(Boolean), authorDate };
  });
}

/** What `--numstat` writes instead of a line count for a binary file. */
const NUMSTAT_BINARY = '-';

/** `git diff --numstat`: the files and the line totals (binary files count as files only — git writes "-"). */
export function parseNumstat(raw: string): { files: string[]; insertions: number; deletions: number } {
  const files: string[] = [];
  let insertions = 0;
  let deletions = 0;
  for (const line of splitLines(raw)) {
    const [ins, del, ...fileParts] = line.split('\t');
    files.push(fileParts.join('\t'));
    if (ins !== NUMSTAT_BINARY) insertions += Number(ins);
    if (del !== NUMSTAT_BINARY) deletions += Number(del);
  }
  return { files, insertions, deletions };
}

/** The `for-each-ref` fields GitService.listBranches asks for, tab-separated. */
export const BRANCH_REF_FORMAT = ['%(refname:short)', '%(refname)', '%(objectname)', '%(authordate:iso-strict)', '%(authorname)', '%(subject)'].join('%09');

/** `for-each-ref` lines → branches (without `<remote>/HEAD`); per-slice fields stay empty, the session fills them. */
export function parseBranchRefs(raw: string): BranchRef[] {
  const result: BranchRef[] = [];
  for (const line of splitLines(raw)) {
    const [short, full, sha, date, author, subject] = line.split('\t');
    if (!short || !full || short.endsWith('/HEAD')) continue;
    const isRemote = full.startsWith(REMOTE_BRANCH_REF_PREFIX);
    result.push({
      ref: short,
      name: isRemote ? short.slice(short.indexOf('/') + 1) : short,
      isRemote,
      lastCommitSha: sha ?? '',
      lastCommitDate: date ?? '',
      lastCommitAuthor: author ?? '',
      lastCommitSubject: subject ?? '',
      // costly for every branch at once — filled only for the slice shown (session)
      mainStatus: 'none',
      prNumber: null,
      taskUrl: null,
      prUrl: null,
      commitUrl: null,
    });
  }
  return result;
}

/**
 * The merge on the release branch's own first-parent chain (oldest-first) nearest to its tip whose non-first
 * parent is another existing release branch's tip — where the previous release went into main.
 */
export function findPreviousReleaseMerge(
  chain: FirstParentCommit[],
  releaseTip: string,
  otherReleaseBranchTips: Set<string>
): FirstParentCommit | undefined {
  for (let i = chain.length - 1; i >= 0; i--) {
    const c = chain[i];
    if (c.sha !== releaseTip && c.parents.length > 1 && c.parents.slice(1).some((p) => otherReleaseBranchTips.has(p))) return c;
  }
  return undefined;
}
