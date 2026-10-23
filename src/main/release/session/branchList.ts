import { computeMainStatusForBranches, type DevFirstParentShas } from '../core/planner';
import { BranchRef } from '../core/types';
import { mainSubjectDateKey } from '../git/gitService';
import { branchMatchesNeedles, dropDuplicateRemoteBranches, parseFilterNeedles } from './branchRules';
import { lastCommitPrNumber } from './planShapes';
import type { SessionState } from './sessionState';

/** A background refinement of the "in main" status of one slice. */
interface RefineRequest {
  slice: BranchRef[];
  devRef: string;
  mainRef: string;
  devFirstParentShas: DevFirstParentShas;
  generation: number;
}

/**
 * The branch list of the section: reads the branches, sends a filtered, limited slice with a quick "in main"
 * status, then refines the status in the background (one pass at a time, only the newest waiting).
 */
export class BranchList {
  /** The last filter text — to resend the slice after the limit or a switch changed. */
  private lastFilterQuery = '';
  /**
   * "Hide branches already in main" — applied with the limit by "Apply", not on the click: it filters on the
   * server BEFORE the limit cut (otherwise "show 2000" would show fewer), and that needs a costlier status.
   */
  private hideAlreadyInMain = false;
  /** "Show service branches" off (hidden) by default — a name prefix check, applied at once. */
  private hideServiceBranches = true;
  /** Grows with every slice — a stale background refinement never overwrites a newer list. */
  private sliceGeneration = 0;
  /** Single-flight of the refinement: each keystroke starts one, a pass may take minutes on big repositories. */
  private refineInFlight = false;
  private refinePending: RefineRequest | null = null;

  constructor(private readonly s: SessionState) {}

  /** Re-reads the branches from git and sends the first slice (the repository may have changed — refs too). */
  async refresh(): Promise<void> {
    this.s.refs.invalidate();
    const branches = await this.s.git.listBranches();
    this.s.fullBranches = this.s.config.hideDuplicateRemoteBranches ? dropDuplicateRemoteBranches(branches) : branches;
    this.postReleaseBranchPatternCount();
    await this.sendSlice('', true);
  }

  /** The list filter changed. */
  filter(query: string): Promise<void> {
    return this.sendSlice(query);
  }

  /** The limit and "hide already in main" — applied together ("Apply"); the limit is saved to the project. */
  async setLimit(limit: number, hideAlreadyInMain: boolean, saveToProject: (limit: number) => Promise<void>): Promise<void> {
    const normalized = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : this.s.config.branchListLimit;
    this.s.config.branchListLimit = normalized;
    this.hideAlreadyInMain = hideAlreadyInMain;
    await saveToProject(normalized);
    await this.sendSlice(this.lastFilterQuery);
  }

  /** Shows / hides the service branches at once. */
  async setHideServiceBranches(hide: boolean): Promise<void> {
    this.hideServiceBranches = hide;
    await this.sendSlice(this.lastFilterQuery);
  }

  /** How many branches fit the release branch pattern — "how many releases were there", shown on top. */
  private postReleaseBranchPatternCount(): void {
    if (!this.s.isActive()) return;
    this.s.panel.postReleaseBranchPatternCount(this.s.rules.releaseBranches(this.s.fullBranches).length);
  }

  /**
   * The quick "fully in main" status by each branch's LAST commit — patch-id (cherry-picked into main: same
   * diff, other sha) or subject + author date. Cheap enough for any set of candidates, even before the limit cut.
   */
  private async computeFastMainStatus(branches: BranchRef[], mainRef: string): Promise<Map<string, boolean>> {
    const withSha = branches.filter((b) => b.lastCommitSha);
    if (withSha.length === 0) return new Map();
    const minDate = withSha.reduce((min, b) => (b.lastCommitDate < min ? b.lastCommitDate : min), withSha[0].lastCommitDate);
    const [mainIndex, subjectDateIndex, ownPatchIds] = await Promise.all([
      this.s.git.computePatchIdIndex(mainRef, minDate),
      this.s.git.buildMainSubjectDateIndex(mainRef, minDate),
      this.s.git.computePatchIdsForCommits(withSha.map((b) => b.lastCommitSha)),
    ]);
    return new Map(
      withSha.map((b) => {
        const patchId = ownPatchIds.get(b.lastCommitSha);
        const matched = (!!patchId && mainIndex.has(patchId)) || subjectDateIndex.has(mainSubjectDateKey(b.lastCommitSubject, b.lastCommitDate));
        return [b.ref, matched] as const;
      })
    );
  }

  /** Branches matching the filter by name, plus those with a matching not-yet-released commit message. */
  private async filterBranches(needles: string[], mainRef: string, generation: number): Promise<BranchRef[] | null> {
    const all = this.s.fullBranches;
    if (!needles.length) return all;
    const nameMatches = all.filter((b) => branchMatchesNeedles(b, needles));
    // e.g. a branch named without the task key, the key only in its commit message — one git call for all
    const commitMatchedRefs = await this.s.git.searchCommitMessages(needles, mainRef);
    if (generation !== this.sliceGeneration) return null;
    if (commitMatchedRefs.size === 0) return nameMatches;
    const alreadyMatched = new Set(nameMatches.map((b) => b.ref));
    const extra = all.filter((b) => commitMatchedRefs.has(b.ref) && !alreadyMatched.has(b.ref));
    return extra.length > 0 ? [...nameMatches, ...extra] : nameMatches;
  }

  /**
   * Sends the filtered and limited slice (thousands of rows are not rendered at once) with the quick status.
   * With "hide already in main" the status is needed for ALL matches before the cut, so the slice still has
   * `limit` rows; otherwise only for the slice. Every await may be overtaken by a newer slice — or the project.
   */
  async sendSlice(filterText: string, refreshedGitState = false): Promise<void> {
    this.lastFilterQuery = filterText;
    const generation = ++this.sliceGeneration;
    const needles = parseFilterNeedles(filterText);

    const { mainRef, devRef, mergeEvents, devFirstParentShas } = await this.s.refs.current();
    if (generation !== this.sliceGeneration) return;
    const byFilter = await this.filterBranches(needles, mainRef, generation);
    if (!byFilter) return;
    const matches = this.hideServiceBranches ? byFilter.filter((b) => !this.s.rules.isService(b.name)) : byFilter;

    let candidates = matches;
    let fastStatusByRef = new Map<string, boolean>();
    if (this.hideAlreadyInMain) {
      fastStatusByRef = await this.computeFastMainStatus(matches, mainRef);
      candidates = matches.filter((b) => !fastStatusByRef.get(b.ref));
    }
    const limit = Math.max(1, this.s.config.branchListLimit);
    const slice = candidates.slice(0, limit);
    if (!this.hideAlreadyInMain) fastStatusByRef = await this.computeFastMainStatus(slice, mainRef);

    // an older request finishing later must never overwrite the newer list ("search adds extra rows")
    if (generation !== this.sliceGeneration || !this.s.isActive()) return;

    const sliceWithFlags = slice.map((b) => {
      const prNumber = lastCommitPrNumber(b, mergeEvents);
      // only none / full here (by the last commit); 'partial' comes from the refinement below
      const mainStatus: 'none' | 'full' = fastStatusByRef.get(b.ref) ? 'full' : 'none';
      return { ...b, mainStatus, prNumber, ...this.s.links.of(b.name, b.lastCommitSubject, b.lastCommitSha, prNumber) };
    });
    this.s.panel.postBranches(sliceWithFlags, [...this.s.selectedRefs], {
      totalMatches: candidates.length,
      totalBranches: this.s.fullBranches.length,
      truncated: candidates.length > slice.length,
      limit,
      refreshedGitState,
    });
    void this.refineMainStatus({ slice, devRef, mainRef, devFirstParentShas, generation });
  }

  /**
   * The exact status by ALL own commits of the shown branches, in the background (tells "partially in main"
   * apart). One pass at a time: a newer request waits as the only pending one and runs right after.
   */
  private async refineMainStatus(request: RefineRequest): Promise<void> {
    if (this.refineInFlight) {
      this.refinePending = request;
      return;
    }
    this.refineInFlight = true;
    try {
      await this.runRefinePass(request);
      while (this.refinePending) {
        const next = this.refinePending;
        this.refinePending = null;
        await this.runRefinePass(next);
      }
    } finally {
      this.refineInFlight = false;
    }
  }

  /**
   * One refinement pass; failures keep the quick status silently. The extra base branches are left out on
   * purpose — one more git call per shown branch; expanding a branch counts them exactly anyway.
   */
  private async runRefinePass({ slice, devRef, mainRef, devFirstParentShas, generation }: RefineRequest): Promise<void> {
    try {
      if (generation !== this.sliceGeneration) return;
      const { statusByRef, diffStatByRef } = await computeMainStatusForBranches(this.s.git, slice, devRef, mainRef, devFirstParentShas);
      if (generation !== this.sliceGeneration || !this.s.isActive()) return;
      if (statusByRef.size > 0) this.s.panel.postBranchMainStatus(Object.fromEntries(statusByRef));
      if (diffStatByRef.size > 0) this.s.panel.postBranchDiffStats(Object.fromEntries(diffStatByRef));
    } catch {
      // a secondary refinement — ignored on purpose
    }
  }
}
