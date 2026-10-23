import * as fs from 'fs/promises';
import * as path from 'path';
import { extractTaskKey } from '../config';
import {
  BlameTally,
  ConflictBlock,
  ConflictSourceAnalysis,
  LineRange,
  TaskDivergenceText,
  isBetterDivergence,
  locateLines,
  parseConflictBlocks,
  splitFileLines,
  toConflictHunk,
} from './conflictText';
import type { ContentMatch } from '../core/types';
import { FirstParentCommit, splitLines } from './gitRecords';
import type { GitHistory } from './gitHistory';

/**
 * Explains one file of a dry-run conflict while the worktree file still has its markers (before the abort):
 * 1. which lines conflict (the blocks), not "the last commit that touched the file" (it may have changed
 *    another place of the file);
 * 2. git blame of those lines on baseRef — who really owns the content that did not match;
 * 3. the task divergence: the same task key on dev as a different commit.
 * Markers that cannot be parsed (binary file…) fall back to the last commit that touched the file.
 */
export class ConflictSourceAnalyzer {
  constructor(private readonly repo: GitHistory) {}

  async analyze(worktreePath: string, file: string, baseRef: string, devRef: string, itemSha: string): Promise<ConflictSourceAnalysis> {
    const blocks = await this.readConflictBlocks(worktreePath, file).catch((): ConflictBlock[] => []);
    // "ours" is found in baseRef, "theirs" in the conflicting commit itself (its own version of the file)
    const oursLocations = await Promise.all(blocks.map((b) => this.locateInCleanFile(baseRef, file, b.oursLines, b.contextBefore, b.contextAfter)));
    const theirsLocations = await Promise.all(blocks.map((b) => this.locateInCleanFile(itemSha, file, b.theirsLines, b.contextBefore, b.contextAfter)));
    // the raw text of the conflict shows by itself, whatever the blame finds
    const hunks = blocks.map((block, i) => toConflictHunk(block, oursLocations[i], theirsLocations[i]));

    try {
      const ranges = oursLocations.filter((r): r is LineRange => r !== null);
      const blamed = ranges.length > 0 ? await this.blamePrimaryCommit(baseRef, file, ranges) : null;
      if (!blamed) return this.fallback(hunks, await this.repo.lastCommitTouchingFile('HEAD', file));
      const taskDivergence = await this.findTaskDivergence(devRef, file, blamed.sha, blamed.subject);
      return { sha: blamed.sha, subject: blamed.subject, authorName: blamed.authorName, authorDate: blamed.authorDate, hunks, taskDivergence };
    } catch {
      // optional diagnostics — the dry-run has found the conflict already
      return this.fallback(hunks, await this.repo.lastCommitTouchingFile('HEAD', file).catch(() => null));
    }
  }

  /** The answer without a blame: the last commit that touched the file, no task divergence. */
  private fallback(hunks: ConflictSourceAnalysis['hunks'], commit: FirstParentCommit | null): ConflictSourceAnalysis {
    return {
      sha: commit?.sha ?? null,
      subject: commit?.subject ?? null,
      authorName: commit?.authorName ?? null,
      authorDate: commit?.authorDate ?? null,
      hunks,
      taskDivergence: null,
    };
  }

  /** The conflict blocks of the worktree file; [] when it is gone or unreadable. */
  private async readConflictBlocks(worktreePath: string, file: string): Promise<ConflictBlock[]> {
    let content: string;
    try {
      content = await fs.readFile(path.join(worktreePath, file), 'utf8');
    } catch {
      return [];
    }
    return parseConflictBlocks(content);
  }

  /** Where a block's lines are in the file on ref; null when the file is not there or nothing matched. */
  private async locateInCleanFile(
    ref: string,
    file: string,
    needleLines: string[],
    contextBefore: string | null,
    contextAfter: string | null
  ): Promise<LineRange | null> {
    let cleanContent: string;
    try {
      cleanContent = await this.repo.raw(['show', `${ref}:${file}`]);
    } catch {
      return null; // not on ref (e.g. the conflicting commit creates it)
    }
    return locateLines(splitFileLines(cleanContent), needleLines, contextBefore, contextAfter);
  }

  /** git blame over the ranges: the commit owning most of their lines (on a tie the newer one). */
  private async blamePrimaryCommit(ref: string, file: string, ranges: Array<{ start: number; end: number }>): Promise<FirstParentCommit | null> {
    const tally = new BlameTally();
    for (const range of ranges) {
      try {
        tally.add(await this.repo.raw(['blame', `-L${range.start},${range.end}`, '--porcelain', ref, '--', file]));
      } catch {
        // the range may be missing (the file is shorter on ref) — skip it, keep the rest
      }
    }
    return tally.primary();
  }

  /**
   * A commit on dev with the blamed commit's task key — the file's own history only (cheap). Of several
   * (a task reworked in rounds) the one whose file content is closest wins, then the newer.
   */
  private async findTaskDivergence(devRef: string, file: string, blamedSha: string, blamedSubject: string): Promise<TaskDivergenceText | null> {
    const taskKey = extractTaskKey(blamedSubject);
    if (!taskKey) return null;

    let raw: string;
    try {
      raw = await this.repo.raw(['log', `--pretty=format:%H%x1f%s%x1f%aI%x1f%an`, devRef, '--', file]);
    } catch {
      return null;
    }
    const candidates = splitLines(raw)
      .map((line) => {
        const [sha, subject, authorDate, authorName] = line.split('\x1f');
        return { sha, subject, authorDate, authorName };
      })
      .filter((c) => c.sha !== blamedSha && extractTaskKey(c.subject) === taskKey);

    let best: { candidate: (typeof candidates)[number]; match: ContentMatch; date: string } | null = null;
    for (const candidate of candidates) {
      const match = await this.diffContentMatch(blamedSha, candidate.sha, file);
      if (isBetterDivergence(match, candidate.authorDate, best)) best = { candidate, match, date: candidate.authorDate };
    }
    if (!best) return null;
    return {
      taskKey,
      contentMatch: best.match,
      otherSha: best.candidate.sha,
      otherSubject: best.candidate.subject,
      otherAuthorName: best.candidate.authorName,
      otherAuthorDate: best.candidate.authorDate,
    };
  }

  /**
   * The file's content at two commits: no diff — identical; a diff that `-w --ignore-blank-lines` hides —
   * near-identical (`-w` alone does not count an added blank line as whitespace); otherwise different.
   */
  private async diffContentMatch(shaA: string, shaB: string, file: string): Promise<ContentMatch> {
    const raw = await this.repo.raw(['diff', '--numstat', shaA, shaB, '--', file]).catch(() => '');
    if (!raw.trim()) return 'identical';
    const rawTrivial = await this.repo.raw(['diff', '-w', '--ignore-blank-lines', '--numstat', shaA, shaB, '--', file]).catch(() => '');
    return rawTrivial.trim() ? 'different' : 'near-identical';
  }
}
