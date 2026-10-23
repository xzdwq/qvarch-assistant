import type { ContentMatch } from '../core/types';
import { FirstParentCommit } from './gitRecords';

/**
 * Pure text work of the conflict analysis (see ConflictSourceAnalyzer): the conflict blocks of a file with
 * markers, finding them in a clean file, the blame tally, the task key of a subject.
 */

/** How many lines of each side of a conflict the UI shows — a guard against a huge hunk. */
export const CONFLICT_HUNK_PREVIEW_LINES = 20;

/** One `<<<<<<< ======= >>>>>>>` block: both sides as text, plus the one line just outside each marker. */
export interface ConflictBlock {
  oursLines: string[];
  theirsLines: string[];
  contextBefore: string | null;
  contextAfter: string | null;
}

/** Where a block sits in a clean file (1-based lines); isContentMatch is false when found by a context line. */
export interface LineRange {
  start: number;
  end: number;
  isContentMatch: boolean;
}

export interface ConflictHunkText {
  oursText: string[];
  theirsText: string[];
  sameContent: boolean;
  oursStartLine: number | null;
  theirsStartLine: number | null;
}

export interface TaskDivergenceText {
  taskKey: string;
  contentMatch: ContentMatch;
  otherSha: string;
  otherSubject: string;
  otherAuthorName: string;
  otherAuthorDate: string;
}

/** What analyzeConflictSource tells about one conflicting file. */
export interface ConflictSourceAnalysis {
  sha: string | null;
  subject: string | null;
  authorName: string | null;
  authorDate: string | null;
  hunks: ConflictHunkText[];
  taskDivergence: TaskDivergenceText | null;
}

/** Lines of a file without the trailing \r of CRLF. */
export function splitFileLines(content: string): string[] {
  return content.split('\n').map((l) => l.replace(/\r$/, ''));
}

/**
 * The conflict blocks of a worktree file (before the abort). Text, not line numbers: cherry-pick has already
 * applied the commit's other hunks, so the numbers here do not match the clean base file.
 */
export function parseConflictBlocks(content: string): ConflictBlock[] {
  const lines = splitFileLines(content);
  const blocks: ConflictBlock[] = [];
  let oursStartIdx: number | null = null;
  let theirsStartIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    switch (conflictMarkerOf(lines[i])) {
      case 'ours':
        // an opening marker always starts a new block, even over an unfinished one
        oursStartIdx = i + 1;
        break;
      case 'separator':
        if (oursStartIdx !== null) theirsStartIdx = i + 1;
        break;
      case 'theirs':
        if (oursStartIdx === null || theirsStartIdx === null) break;
        blocks.push({
          oursLines: lines.slice(oursStartIdx, theirsStartIdx - 1),
          theirsLines: lines.slice(theirsStartIdx, i),
          // the line above the `<<<<<<<` marker (the marker itself is at oursStartIdx - 1)
          contextBefore: oursStartIdx > 1 ? lines[oursStartIdx - 2] : null,
          contextAfter: i + 1 < lines.length ? lines[i + 1] : null,
        });
        oursStartIdx = null;
        theirsStartIdx = null;
        break;
      case undefined:
        break;
    }
  }
  return blocks;
}

type ConflictMarker = 'ours' | 'separator' | 'theirs';

/** Git's conflict markers by their fixed 7-character prefix (diff3's `|||||||` base marker is not read). */
const CONFLICT_MARKERS: ReadonlyMap<string, ConflictMarker> = new Map([
  ['<<<<<<<', 'ours'],
  ['=======', 'separator'],
  ['>>>>>>>', 'theirs'],
]);
const CONFLICT_MARKER_LENGTH = 7;

/** Which conflict marker a line starts with, if any. */
function conflictMarkerOf(line: string): ConflictMarker | undefined {
  return CONFLICT_MARKERS.get(line.slice(0, CONFLICT_MARKER_LENGTH));
}

/**
 * Finds a block's lines in a clean file by content (by the outside context line when the side is empty);
 * several matches are narrowed by the context around the block. null — no match.
 */
export function locateLines(
  cleanLines: string[],
  needleLines: string[],
  contextBefore: string | null,
  contextAfter: string | null
): LineRange | null {
  const isContentMatch = needleLines.length > 0;
  const needle = isContentMatch ? needleLines : [contextBefore ?? contextAfter ?? ''];
  if (needle.length === 1 && needle[0] === '') return null;

  const matches: number[] = [];
  for (let i = 0; i + needle.length <= cleanLines.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (cleanLines[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i);
  }
  if (matches.length === 0) return null;

  let bestIdx = matches[0];
  if (matches.length > 1) {
    const withContext = matches.filter((i) => {
      const beforeOk = contextBefore === null || cleanLines[i - 1] === contextBefore;
      const afterOk = contextAfter === null || cleanLines[i + needle.length] === contextAfter;
      return beforeOk && afterOk;
    });
    if (withContext.length > 0) bestIdx = withContext[0];
  }
  return { start: bestIdx + 1, end: bestIdx + needle.length, isContentMatch };
}

function normalizeForCompare(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

/** Both sides are the same text apart from whitespace and blank lines — a merge-context conflict, either side will do. */
export function linesEqualIgnoringWhitespace(a: string[], b: string[]): boolean {
  const na = a.map(normalizeForCompare).filter((l) => l !== '');
  const nb = b.map(normalizeForCompare).filter((l) => l !== '');
  if (na.length !== nb.length) return false;
  return na.every((l, i) => l === nb[i]);
}

/** A block as the UI shows it: both sides (cut), whether they differ, where each starts (only on a content match). */
export function toConflictHunk(block: ConflictBlock, ours: LineRange | null, theirs: LineRange | null): ConflictHunkText {
  return {
    oursText: block.oursLines.slice(0, CONFLICT_HUNK_PREVIEW_LINES),
    theirsText: block.theirsLines.slice(0, CONFLICT_HUNK_PREVIEW_LINES),
    sameContent: linesEqualIgnoringWhitespace(block.oursLines, block.theirsLines),
    oursStartLine: ours?.isContentMatch ? ours.start : null,
    theirsStartLine: theirs?.isContentMatch ? theirs.start : null,
  };
}

interface BlameMeta {
  subject: string;
  authorName: string;
  authorDate: string;
}

/** Reads one porcelain header field (`<key> <value>`) of a commit into the gathered metadata. */
type BlameFieldReader = (meta: Map<string, BlameMeta>, sha: string, value: string) => void;

/**
 * The porcelain header fields the tally reads. `author` opens a commit's metadata (the first mention wins);
 * the others only fill a still-empty field of it. Other keys (author-mail, filename…) and content lines are skipped.
 */
const BLAME_FIELDS: ReadonlyMap<string, BlameFieldReader> = new Map<string, BlameFieldReader>([
  [
    'author',
    (meta, sha, value) => {
      if (!meta.has(sha)) meta.set(sha, { subject: '', authorName: value, authorDate: '' });
    },
  ],
  [
    'author-time',
    (meta, sha, value) => {
      const existing = meta.get(sha);
      if (existing && !existing.authorDate) existing.authorDate = new Date(Number(value) * 1000).toISOString();
    },
  ],
  [
    'summary',
    (meta, sha, value) => {
      const existing = meta.get(sha);
      if (existing && !existing.subject) existing.subject = value;
    },
  ],
]);

/**
 * Lines per commit over several `git blame --porcelain` outputs. Porcelain sends a commit's metadata only
 * on its first mention, so the metadata is gathered along the way.
 */
export class BlameTally {
  private readonly lineCounts = new Map<string, number>();
  private readonly meta = new Map<string, BlameMeta>();

  /** Adds one porcelain output. */
  add(raw: string): void {
    let currentSha: string | null = null;
    for (const line of raw.split('\n')) {
      const header = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/.exec(line);
      if (header) {
        currentSha = header[1];
        this.lineCounts.set(currentSha, (this.lineCounts.get(currentSha) ?? 0) + 1);
        continue;
      }
      if (!currentSha) continue;
      const space = line.indexOf(' ');
      if (space < 0) continue;
      BLAME_FIELDS.get(line.slice(0, space))?.(this.meta, currentSha, line.slice(space + 1));
    }
  }

  /** The commit owning most lines (on a tie the newer one), or null. */
  primary(): FirstParentCommit | null {
    let bestSha: string | null = null;
    let bestCount = -1;
    let bestDate = '';
    for (const [sha, count] of this.lineCounts) {
      const date = this.meta.get(sha)?.authorDate ?? '';
      if (count > bestCount || (count === bestCount && date > bestDate)) {
        bestSha = sha;
        bestCount = count;
        bestDate = date;
      }
    }
    if (!bestSha) return null;
    const info = this.meta.get(bestSha);
    if (!info) return null;
    return { sha: bestSha, parents: [], subject: info.subject, authorDate: info.authorDate, authorName: info.authorName };
  }
}

const CONTENT_MATCH_RANK: Record<ContentMatch, number> = { identical: 0, 'near-identical': 1, different: 2 };

/** Whether a candidate beats the current best: a closer content match first, then the newer one. */
export function isBetterDivergence(match: ContentMatch, date: string, best: { match: ContentMatch; date: string } | null): boolean {
  if (!best) return true;
  const rank = CONTENT_MATCH_RANK[match];
  const bestRank = CONTENT_MATCH_RANK[best.match];
  return rank < bestRank || (rank === bestRank && date > best.date);
}
