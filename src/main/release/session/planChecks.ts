import { performDryRun } from '../core/dryRun';
import { findCommitsAlreadyInRef, findConflictCauses, findStaleUnmergedBranches } from '../core/planner';
import { ConflictSource } from '../core/types';
import { latestDate } from '../core/isoDates';
import { laterDate } from './branchRules';
import type { SessionState } from './sessionState';

/**
 * The checks over the current plan: applied / "already in main" against the real history, the dry-run
 * (fast, then the slow explanation in the background) and the forgotten branches scan. They update
 * the plan in place; the caller persists and posts it.
 */
export class PlanChecks {
  constructor(private readonly s: SessionState) {}

  /**
   * Marks items already in the release branch by content (patch-id / subject + date) — the saved flag lags
   * when the session closed before saving or the branch was changed by hand; a release may be built in parts.
   */
  async syncAppliedFromReleaseBranch(): Promise<void> {
    const { plan, releaseBranch } = this.s;
    if (!plan || !releaseBranch) return;
    const notYetApplied = plan.items.filter((i) => !i.applied);
    if (notYetApplied.length === 0) return;
    const appliedShas = await findCommitsAlreadyInRef(this.s.git, releaseBranch, notYetApplied);
    for (const item of notYetApplied) if (appliedShas.has(item.sha)) item.applied = true;
  }

  /** Recomputes "already in main" of a saved plan against main as it is now, not as it was when saved. */
  async syncAlreadyInMain(mainRef: string): Promise<void> {
    const plan = this.s.plan;
    if (!plan || plan.items.length === 0) return;
    const alreadyInMainShas = await findCommitsAlreadyInRef(this.s.git, mainRef, plan.items);
    for (const item of plan.items) item.alreadyInMain = alreadyInMainShas.has(item.sha);
  }

  /**
   * Where the dry-run starts: the release branch when it exists (it holds what is really applied — starting
   * from main gives false conflicts for applied content), else the plan's main.
   */
  private async dryRunBaseRef(): Promise<string> {
    const { releaseBranch, plan } = this.s;
    return releaseBranch && (await this.s.git.branchExists(releaseBranch)) ? releaseBranch : plan!.mainBranch;
  }

  /**
   * The fast dry-run: real cherry-picks in a temporary worktree find each conflict exactly, but without the
   * explanation (blame, task divergence, causes) — that comes from runBackgroundConflictAnalysis.
   */
  async runFastDryRun(): Promise<void> {
    const plan = this.s.plan;
    if (!plan || plan.items.length === 0) return;
    const baseRef = await this.dryRunBaseRef();
    const devRef = await this.s.refs.resolveDevRef();
    const outcome = await performDryRun(this.s.git, baseRef, devRef, plan.items, { skipDetailedAnalysis: true });
    const bySha = new Map(outcome.results.map((r) => [r.sha, r] as const));
    for (const item of plan.items) {
      const result = bySha.get(item.sha);
      if (result) {
        item.dryRunStatus = result.status;
        item.dryRunConflictFiles = result.conflictFiles;
        item.dryRunConflictSources = result.conflictSources;
      } else if (item.included) {
        item.dryRunStatus = 'untested';
      }
    }
  }

  /**
   * The slow half: the full dry-run again (the only way back into the same conflict state) to explain each
   * conflict, plus the possible causes of a conflict not in main yet. Dropped when the plan was rebuilt meanwhile.
   */
  async runBackgroundConflictAnalysis(generation: number): Promise<void> {
    const plan = this.s.plan;
    if (!plan || plan.items.length === 0) return;
    let outcome;
    try {
      outcome = await performDryRun(this.s.git, await this.dryRunBaseRef(), await this.s.refs.resolveDevRef(), plan.items);
    } catch {
      return; // the chronology is shown by the fast pass already, just without the explanation
    }
    if (generation !== this.s.planGeneration || !this.s.plan) return;

    const bySha = new Map(outcome.results.map((r) => [r.sha, r] as const));
    const excludeShas = new Set(this.s.plan.items.map((i) => i.sha));
    const updates: Array<{ sha: string; conflictSources: ConflictSource[] }> = [];
    for (const item of this.s.plan.items) {
      const result = bySha.get(item.sha);
      if (!result || result.status !== 'conflict') continue;
      const sources = result.conflictSources.map((source) => this.withSourceLinks(source));
      if (!item.alreadyInMain) {
        for (const source of sources) {
          const causes = await findConflictCauses(this.s.git, this.s.plan.mainBranch, source.file, excludeShas, (name) => this.s.rules.isIgnorableCandidate(name), this.s.config.remoteName);
          source.possibleCauses = causes.map((c) => ({ ...c, ...this.s.links.of(c.branch, c.subject, c.sha, null) }));
        }
      }
      if (generation !== this.s.planGeneration || !this.s.plan) return; // could go stale while looking for causes
      item.dryRunConflictSources = sources; // kept in the plan too — survives persist / the next post
      updates.push({ sha: item.sha, conflictSources: sources });
    }
    if (updates.length === 0) return;
    this.s.persist();
    if (this.s.isActive()) this.s.panel.postConflictAnalysisUpdate(updates);
  }

  /** A conflict source with its commit links. */
  private withSourceLinks(source: ConflictSource): ConflictSource {
    const links = this.s.links;
    return {
      ...source,
      commitUrl: source.sha ? links.commitUrl(source.subject ?? '', source.sha) : null,
      taskDivergence: source.taskDivergence
        ? { ...source.taskDivergence, otherCommitUrl: links.commitUrl(source.taskDivergence.otherSubject, source.taskDivergence.otherSha) }
        : null,
    };
  }

  /**
   * The forgotten branches scan after the chronology is shown (the section shows a spinner meanwhile): branches
   * not in main with work before the later of the newest picked commit (MAX: adding an older branch must not
   * hide a found one) and the oldest of the last N releases. Failures stay silent — an optional hint.
   */
  async runFindStaleBranches(generation: number, mainRef: string): Promise<void> {
    const plan = this.s.plan;
    if (!plan) return;
    const latestSelectedDate = latestDate(plan.items, (i) => i.authorDate);
    const releaseLookbackDate = this.s.rules.releaseLookbackDate(this.s.fullBranches, this.s.config.staleBranchesLookbackReleases);
    const beforeDate = laterDate(latestSelectedDate, releaseLookbackDate);
    const excludeShas = new Set(plan.items.map((i) => i.sha));
    let hints: Awaited<ReturnType<typeof findStaleUnmergedBranches>> = [];
    try {
      hints = await findStaleUnmergedBranches(this.s.git, mainRef, beforeDate, excludeShas, (name) => this.s.rules.isIgnorableCandidate(name), this.s.config.remoteName);
    } catch {
      hints = [];
    }
    if (generation !== this.s.planGeneration || !this.s.isActive()) return;
    this.s.panel.postStaleBranches(hints.map((h) => ({ ...h, ...this.s.links.of(h.branch, h.subject, h.sha, null) })));
  }

  /** Shows the scan's spinner and starts it. */
  startStaleBranchesScan(generation: number, mainRef: string): void {
    this.s.panel.postStaleBranchesLoading();
    void this.runFindStaleBranches(generation, mainRef);
  }
}
