import { releaseBranchMatcher } from '../config';
import type { ExtraBaseRef } from '../core/planner';
import { BranchRef, ReleaseConfig } from '../core/types';

/**
 * Splits the branch filter into independent OR terms — by spaces, but "text in double quotes" is one term
 * (a phrase of a commit message, see GitService.searchCommitMessages). Quotes are dropped; a lone quote is
 * a plain character.
 */
export function parseFilterNeedles(filterText: string): string[] {
  const needles: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(filterText)) !== null) {
    const term = (m[1] ?? m[2]).toLowerCase();
    if (term) needles.push(term);
  }
  return needles;
}

/** Any needle in the branch's name or ref (case-insensitive; needles are lower-case already). */
export function branchMatchesNeedles(branch: BranchRef, needles: string[]): boolean {
  const haystack = `${branch.name} ${branch.ref}`.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Drops a remote-tracking branch whose local twin has the same name AND the same last commit. The sha check
 * is a must: a stale local branch of the same name once hid the real remote one with all the work; when the
 * two differ both stay — the difference itself is a useful signal.
 */
export function dropDuplicateRemoteBranches(branches: BranchRef[]): BranchRef[] {
  const localShaByName = new Map(branches.filter((b) => !b.isRemote).map((b) => [b.name, b.lastCommitSha]));
  return branches.filter((b) => !b.isRemote || localShaByName.get(b.name) !== b.lastCommitSha);
}

/** Of two ISO dates the later one (`b` may be missing). */
export function laterDate(a: string, b: string | null): string {
  return b && b > a ? b : a;
}

/** What a project's settings say about branch names: release, service, ignorable, extra base branches. */
export class BranchRules {
  private readonly isReleaseName: (name: string) => boolean;

  constructor(private readonly config: ReleaseConfig) {
    this.isReleaseName = releaseBranchMatcher(config.releaseBranchPattern);
  }

  /** The name fits the release branch pattern. */
  isRelease(name: string): boolean {
    return this.isReleaseName(name);
  }

  /** A service branch (qa, revert-pr-, chore/… — nonTaskBranchPrefixes). */
  isService(name: string): boolean {
    return this.config.nonTaskBranchPrefixes.some((p) => name.startsWith(p));
  }

  /** Main / dev / release / service branches are never a forgotten task or a conflict cause. */
  isIgnorableCandidate(name: string): boolean {
    return name === this.config.devBranch || name === this.config.mainBranch || this.isRelease(name) || this.isService(name);
  }

  /** The release branches among the given ones. */
  releaseBranches(branches: BranchRef[]): BranchRef[] {
    return branches.filter((b) => this.isRelease(b.name));
  }

  /** Tips of the existing release branches — the topological marks of earlier releases in main. */
  releaseTipShas(branches: BranchRef[]): Set<string> {
    return new Set(this.releaseBranches(branches).map((b) => b.lastCommitSha));
  }

  /**
   * The last-commit date of the N-th newest release branch — a cheap "when was that release"; null when there
   * are fewer than N (then only the picked commits bound the forgotten branches scan).
   */
  releaseLookbackDate(branches: BranchRef[], n: number): string | null {
    const releases = this.releaseBranches(branches)
      .filter((b) => b.lastCommitDate)
      .sort((a, b) => (a.lastCommitDate > b.lastCommitDate ? -1 : 1));
    return releases.length < n ? null : releases[n - 1].lastCommitDate;
  }

  /**
   * Base branches besides dev for a branch's own commits: service prefixes that are exact names (qa, not
   * revert-pr- or chore/) and exist — Bitbucket forks revert-pr-* from the branch reverted on (usually qa).
   * The remote ref is preferred.
   */
  extraBaseRefs(branches: BranchRef[]): ExtraBaseRef[] {
    const exactNames = this.config.nonTaskBranchPrefixes.filter((p) => !p.endsWith('/') && !p.endsWith('-'));
    const refs: ExtraBaseRef[] = [];
    for (const name of exactNames) {
      const ref = [`${this.config.remoteName}/${name}`, name].find((candidate) => branches.some((b) => b.ref === candidate));
      if (ref) refs.push({ ref, name });
    }
    return refs;
  }
}
