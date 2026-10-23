import { buildPlanItems, findAnchorCommit, findContextCommits } from '../core/planner';
import { earliestDate } from '../core/isoDates';
import { MergeEventInfo, PlanItem } from '../core/types';
import type { MergeEventDetails } from '../git/gitService';
import type { PlanChecks } from './planChecks';
import { collectMergeEvents, planWarnings } from './planShapes';
import type { SessionState } from './sessionState';

/**
 * Builds the chronology of the picked branches: the plan items, dev's context and anchor commits, the merge
 * events; then checks it right away (applied, the fast dry-run) and starts the background checks.
 */
export class PlanBuilder {
  constructor(
    private readonly s: SessionState,
    private readonly checks: PlanChecks
  ) {}

  /**
   * Sets each item's PR and links and gathers each branch's merge events — from one source (dev's merge
   * events); also re-run for a saved plan, since dev keeps merging after it was saved.
   */
  applyMergeEvents(items: PlanItem[], mergeEventsByParentSha: Map<string, MergeEventDetails[]>): Record<string, MergeEventInfo[]> {
    return collectMergeEvents(items, mergeEventsByParentSha, (branch, subject, sha, prNumber) => this.s.links.of(branch, subject, sha, prNumber));
  }

  /**
   * Rebuilds the plan from the current selection. Every await may be overtaken by a newer build (the
   * generation) or a switched project; the dry-run failing only warns — the chronology still shows.
   */
  async rebuild(): Promise<void> {
    const s = this.s;
    const selected = s.selectedBranchRefs();
    if (selected.length === 0) {
      s.plan = null;
      s.panel.postPlan(null);
      return;
    }
    const generation = s.nextPlanGeneration();

    const { mainRef, devRef, mergeEvents, devFirstParentShas } = await s.refs.current();
    if (generation !== s.planGeneration) return; // the selection changed while the refs were read

    const { items, skipped, truncatedBranches, absorbedBranches } = await buildPlanItems(
      s.git,
      selected,
      devRef,
      mainRef,
      devFirstParentShas,
      s.rules.extraBaseRefs(s.fullBranches)
    );
    if (generation !== s.planGeneration) return;

    const mergeEventsByBranch = this.applyMergeEvents(items, mergeEvents);
    // the picked branches may have no commits of their own (dev itself, absorbed ones): no context, no anchor
    const [{ commits: contextCommits, truncated: contextTruncated }, anchorCommit] = items.length
      ? await Promise.all([findContextCommits(s.git, devRef, items), findAnchorCommit(s.git, devRef, earliestDate(items, (i) => i.authorDate))])
      : [{ commits: [], truncated: false }, null];
    for (const commit of contextCommits) Object.assign(commit, s.links.of('', commit.subject, commit.sha, null));
    if (anchorCommit) Object.assign(anchorCommit, s.links.of('', anchorCommit.subject, anchorCommit.sha, null));
    if (generation !== s.planGeneration) return;

    s.plan = {
      releaseBranch: s.releaseBranch,
      mainBranch: mainRef,
      items,
      contextCommits,
      contextCommitsTruncated: contextTruncated,
      anchorCommit,
      mergeEventsByBranch,
      absorbedBranches,
    };

    // the release branch may exist already (a rebuild of a started release): applied first, the dry-run after
    if (s.releaseBranch && (await s.git.branchExists(s.releaseBranch))) await this.checks.syncAppliedFromReleaseBranch();

    let dryRunWarning: string | null = null;
    try {
      await this.checks.runFastDryRun();
    } catch (err: any) {
      // items stay 'untested'; the user learns it from the warning
      dryRunWarning = `Проверка на конфликты не выполнена: ${err?.message ?? err}`;
    }
    if (generation !== s.planGeneration || !s.isActive()) return;

    s.persist();
    s.panel.postPlan(s.plan);
    this.checks.startStaleBranchesScan(generation, mainRef);
    void this.checks.runBackgroundConflictAnalysis(generation);

    const warnings = planWarnings(skipped, truncatedBranches, dryRunWarning);
    if (warnings.length > 0 && s.isActive()) s.panel.postError(warnings.join(' '));
  }
}
