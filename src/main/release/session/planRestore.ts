import type { PlanBuilder } from './planBuilder';
import type { PlanChecks } from './planChecks';
import { byAuthorDate, emptyPlanFor, emptyReleaseBranchNote, matchReleaseCommitsToBranches, orphanPlanItem, uncoveredCommits } from './planShapes';
import type { SessionState } from './sessionState';

/** How many own commits of a release branch are read to restore its chronology. */
const RELEASE_BRANCH_COMMITS_CAP = 200;

/**
 * Brings back the chronology of an existing release branch: from the saved state, refreshed against the real
 * history; without one — rebuilt from the branch's own commits (matched to live branches by task key); failing
 * that — at least what the branch already holds.
 */
export class PlanRestore {
  constructor(
    private readonly s: SessionState,
    private readonly builder: PlanBuilder,
    private readonly checks: PlanChecks
  ) {}

  /**
   * When the branch fits the release pattern: takes its saved state, or an empty valid plan (the client knows
   * "the release exists" by the plan's release branch). No git calls beyond reading the state — finish() does
   * the rest. false — not a release branch: nothing is touched.
   */
  async adoptReleaseBranch(branchName: string): Promise<boolean> {
    if (!branchName || !this.s.rules.isRelease(branchName)) return false;
    const state = await this.s.findUsablePersistedState();
    if (state && state.releaseBranch === branchName) {
      this.s.adopt(state, (b) => emptyPlanFor(b));
    } else {
      this.s.releaseBranch = branchName;
      this.s.selectedRefs = new Set();
      this.s.plan = emptyPlanFor(branchName);
    }
    return true;
  }

  /**
   * After the release branch, selection and plan are set (and the branch list sent with that selection — the
   * client ticks boxes only from the first list): refreshes the merge events, applied and "already in main"
   * against the real history, re-runs the dry-run, saves and shows the plan, starts the background checks.
   * An empty plan is rebuilt from the branch (see reconstructFromReleaseBranch).
   */
  async finish(): Promise<void> {
    const s = this.s;
    if (!s.plan) return;
    if (s.plan.items.length === 0) {
      const reconstructed = await this.reconstructFromReleaseBranch();
      if (!reconstructed) {
        s.persist();
        if (s.isActive()) s.panel.postPlan(s.plan);
        await this.showReleaseBranchCommits();
      }
      return;
    }
    let mainRef: string | null = null;
    try {
      const refs = await s.refs.current();
      mainRef = refs.mainRef;
      s.plan.mergeEventsByBranch = this.builder.applyMergeEvents(s.plan.items, refs.mergeEvents);
      await this.checks.syncAppliedFromReleaseBranch();
      await this.checks.syncAlreadyInMain(mainRef);
      // the saved dry-run predates what is applied now — wrong for applied items
      await this.checks.runFastDryRun();
    } catch {
      // the plan still shows, just not refreshed
    }
    s.persist();
    if (s.isActive()) s.panel.postPlan(s.plan);
    const generation = s.nextPlanGeneration();
    void this.checks.runBackgroundConflictAnalysis(generation);
    // this session's own scan: the previous session's result is dropped as not current (the spinner hung forever)
    if (mainRef) this.checks.startStaleBranchesScan(generation, mainRef);
  }

  /**
   * Rebuilds the chronology from the release branch's own commits when there is no saved plan for it (made by
   * hand, or a forgotten task added after the release). Task keys of its commit subjects pick the live branches
   * (a full content comparison over all branches would cost a chronology of them all); commits whose task has no
   * live branch become orphan items. false only when the branch has no own commits (or on a failure).
   */
  private async reconstructFromReleaseBranch(): Promise<boolean> {
    const s = this.s;
    if (!s.releaseBranch) return false;
    try {
      const mainRef = await s.refs.resolveMainRef();
      const ownCommits = await s.git.releaseBranchOwnCommits(s.releaseBranch, mainRef, RELEASE_BRANCH_COMMITS_CAP, s.rules.releaseTipShas(s.fullBranches));
      if (ownCommits.length === 0) return false;

      const candidates = s.fullBranches.filter((b) => !s.rules.isIgnorableCandidate(b.name));
      const { matchedRefs, coveredKeys } = matchReleaseCommitsToBranches(ownCommits, candidates);
      let generation: number;
      if (matchedRefs.length > 0) {
        s.selectedRefs = new Set(matchedRefs);
        // the list went out before: the client takes a selection from the list only once — push it explicitly
        if (s.isActive()) s.panel.postSelectedRefs([...s.selectedRefs]);
        await this.builder.rebuild(); // persists, posts, scans by itself
        if (!s.plan) return false; // the selection went stale meanwhile
        generation = s.planGeneration;
      } else {
        generation = s.nextPlanGeneration();
        s.plan = emptyPlanFor(s.releaseBranch, mainRef);
      }

      const orphans = uncoveredCommits(ownCommits, coveredKeys);
      if (orphans.length > 0) {
        const alreadyMerged = await s.git.isAncestor(s.releaseBranch, mainRef);
        const orphanItems = orphans.map((c) => orphanPlanItem(c, s.releaseBranch, alreadyMerged, (...args) => s.links.of(...args)));
        s.plan.items = [...s.plan.items, ...orphanItems].sort(byAuthorDate);
        s.persist();
        if (s.isActive()) s.panel.postPlan(s.plan);
        this.checks.startStaleBranchesScan(generation, mainRef);
      }
      return true;
    } catch {
      return false; // finish() falls back to the plain info
    }
  }

  /**
   * The last, informational fallback: what the release branch already holds, read from git — or why it holds
   * nothing (released into main already, or just empty).
   */
  private async showReleaseBranchCommits(): Promise<void> {
    const s = this.s;
    if (!s.releaseBranch) return;
    try {
      const mainRef = await s.refs.resolveMainRef();
      const commits = await s.git.releaseBranchOwnCommits(s.releaseBranch, mainRef, RELEASE_BRANCH_COMMITS_CAP, s.rules.releaseTipShas(s.fullBranches));
      const withLinks = commits.map((c) => ({ ...c, ...s.links.of('', c.subject, c.sha, null) }));
      let note: string | null = null;
      if (commits.length === 0) note = emptyReleaseBranchNote(s.releaseBranch, s.config.mainBranch, await s.git.isAncestor(s.releaseBranch, mainRef));
      if (s.isActive()) s.panel.postReleaseBranchInfo(s.releaseBranch, withLinks, note);
    } catch {
      // an optional hint must not break opening the section
    }
  }
}
