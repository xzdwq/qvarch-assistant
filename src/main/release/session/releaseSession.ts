import { formatReleaseBranch, readProjects, saveProjects, type ReleaseContext } from '../config';
import { applyAll } from '../core/executor';
import { getBranchCommits } from '../core/planner';
import { ReleaseConfig } from '../core/types';
import { PanelContext, ReleasePanel, ReleasePanelHost } from '../panel';
import { BranchList } from './branchList';
import { PlanBuilder } from './planBuilder';
import { PlanChecks } from './planChecks';
import { PlanRestore } from './planRestore';
import { emptyPlanFor } from './planShapes';
import { SessionState } from './sessionState';

/**
 * One release session of a project in the "Релиз" section: opens the repository, serves the section's
 * commands (ReleasePanelHost) and composes the parts — the branch list, the plan builder, its checks and the
 * restore of an existing release branch — over one shared SessionState.
 */
export class ReleaseSession implements ReleasePanelHost {
  private readonly s: SessionState;
  private readonly branches: BranchList;
  private readonly checks: PlanChecks;
  private readonly builder: PlanBuilder;
  private readonly restore: PlanRestore;
  /** true once the repository is open — the section asks for the branches on load, maybe earlier. */
  private ready = false;

  constructor(context: ReleaseContext) {
    this.s = new SessionState(context, this);
    this.branches = new BranchList(this.s);
    this.checks = new PlanChecks(this.s);
    this.builder = new PlanBuilder(this.s, this.checks);
    this.restore = new PlanRestore(this.s, this.builder, this.checks);
  }

  /** The section's command (the webview's postMessage) — handled while this session owns the section. */
  dispatch(message: { command: string } & Record<string, unknown>): Promise<void> {
    return this.s.panel.dispatch(message);
  }

  /** Shows the section for this session first — before any git call, so it reacts at once. */
  private showSection(projectContext: PanelContext | undefined): void {
    this.s.panel = ReleasePanel.createOrShow(this, projectContext);
    this.s.projectId = projectContext?.projectId;
  }

  /** Opens the repository of the project (a saved profile, or the default config). */
  private async openRepository(overrideConfig: ReleaseConfig | undefined): Promise<void> {
    await this.s.openRepository(overrideConfig);
    this.ready = true;
    await this.s.git.pruneWorktrees();
  }

  /**
   * Opens the section — read-only, no checkout or pull; the branches come when ready. A build is restored
   * only when the CURRENT branch is a release branch (any release — they get more commits later); being on
   * dev means the user is not on the release right now.
   */
  async start(overrideConfig?: ReleaseConfig, projectContext?: PanelContext): Promise<void> {
    this.showSection(projectContext);
    try {
      await this.openRepository(overrideConfig);
      await this.postCurrentBranch();
      const shouldFinishPlan = await this.restore.adoptReleaseBranch(await this.s.git.currentBranch());
      await this.branches.refresh();
      if (shouldFinishPlan) {
        if (this.s.isActive()) this.s.panel.postPlanBuilding();
        await this.restore.finish();
      }
      await this.warnIfCherryPickInProgress();
    } catch (err: any) {
      if (this.s.isActive()) this.s.panel.postError(err?.message ?? String(err));
    }
  }

  /** Continues the saved build (an explicit command) whatever branch the repository is on now. */
  async resume(overrideConfig?: ReleaseConfig, projectContext?: PanelContext): Promise<void> {
    this.showSection(projectContext);
    try {
      await this.openRepository(overrideConfig);
      const state = await this.s.findUsablePersistedState();
      if (!state) {
        throw new Error('Нет сохранённой сборки релиза для этого репозитория (или её ветка больше не существует) — начните новую.');
      }
      this.s.adopt(state, (b) => emptyPlanFor(b));
      await this.postCurrentBranch();
      await this.branches.refresh();
      await this.restore.finish();
      await this.warnIfCherryPickInProgress();
    } catch (err: any) {
      if (this.s.isActive()) this.s.panel.postError(err?.message ?? String(err));
    }
  }

  private async warnIfCherryPickInProgress(): Promise<void> {
    if ((await this.s.git.isCherryPickInProgress()) && this.s.isActive()) {
      this.s.panel.postError(
        'В репозитории обнаружен незавершённый cherry-pick (вероятно, от прошлой сессии). ' +
          'Это может мешать переключению веток через интерфейс VS Code. ' +
          'Разрешите конфликт и нажмите "Начать сборку" ещё раз — она продолжит с того же места, либо нажмите "Отменить сборку (cherry-pick --abort)" ниже.'
      );
    }
  }

  /** The current branch with its dirty marks — read anew each time (changes may come from a terminal). */
  private async postCurrentBranch(): Promise<void> {
    const current = await this.s.git.currentBranch();
    const dirtyState = await this.s.git.workingTreeState();
    if (!this.s.isActive()) return;
    const { mainBranch, devBranch, staleBranchesLookbackReleases } = this.s.config;
    this.s.panel.postCurrentBranch(current, mainBranch, devBranch, staleBranchesLookbackReleases, dirtyState);
  }

  /** A setting changed right in the section goes into the open project's profile. */
  private async saveToProject(patch: Partial<ReleaseConfig>): Promise<void> {
    if (!this.s.projectId) return;
    const projects = readProjects();
    const index = projects.findIndex((p) => p.id === this.s.projectId);
    if (index >= 0) {
      projects[index] = { ...projects[index], ...patch };
      await saveProjects(projects);
    }
  }

  /** The section asks for the branches on load — ignored until the repository is open (start does it then). */
  async onRefreshBranches(): Promise<void> {
    if (!this.ready) return;
    await this.postCurrentBranch();
    await this.branches.refresh();
  }

  async onFilterBranches(query: string): Promise<void> {
    await this.branches.filter(query);
  }

  async onSetBranchListLimit(limit: number, hideAlreadyInMain: boolean): Promise<void> {
    await this.branches.setLimit(limit, hideAlreadyInMain, (branchListLimit) => this.saveToProject({ branchListLimit }));
  }

  async onSetHideServiceBranches(hide: boolean): Promise<void> {
    await this.branches.setHideServiceBranches(hide);
  }

  /**
   * Checkout only (Pull is its own button). A release branch is adopted as on opening — unless it is the one
   * already shown with its plan; switching to another branch leaves the release and the plan alone.
   */
  async onSwitchBranch(branchName: string): Promise<void> {
    await this.s.git.assertClean();
    await this.s.git.checkoutBranch(branchName);
    await this.postCurrentBranch();
    const alreadyOnIt = this.s.releaseBranch === branchName && !!this.s.plan;
    const shouldFinishPlan = alreadyOnIt ? false : await this.restore.adoptReleaseBranch(branchName);
    await this.branches.refresh();
    if (shouldFinishPlan) {
      if (this.s.isActive()) this.s.panel.postPlanBuilding();
      await this.restore.finish();
    }
  }

  /** Pull of the current branch. */
  async onPullCurrentBranch(): Promise<void> {
    await this.s.git.assertClean();
    await this.s.git.pull(this.s.config.remoteName);
    await this.postCurrentBranch();
    await this.branches.refresh();
  }

  /** A branch's own commits for the list — always answered, or the row stays "loading" forever. */
  async onExpandBranch(ref: string): Promise<void> {
    const s = this.s;
    const branch = s.fullBranches.find((b) => b.ref === ref);
    if (!branch) {
      s.panel.postBranchCommits(ref, [], false);
      s.panel.postError(`Ветка ${ref} не найдена в текущем списке — попробуйте обновить список веток.`);
      return;
    }
    try {
      const { devRef, mainRef } = await s.refs.current();
      const { commits, truncated, forkedFrom } = await getBranchCommits(s.git, branch, devRef, mainRef, undefined, s.rules.extraBaseRefs(s.fullBranches));
      for (const commit of commits) Object.assign(commit, s.links.of(branch.name, commit.subject, commit.sha, null));
      if (!s.isActive()) return;
      s.panel.postBranchCommits(ref, commits, truncated, forkedFrom ?? null);
    } catch (err: any) {
      if (!s.isActive()) return;
      s.panel.postBranchCommits(ref, [], false);
      s.panel.postError(`Не удалось получить коммиты ветки ${branch.name}: ${err?.message ?? err}`);
    }
  }

  /** Previews the chronology of the picked branches (with the conflict check); git is not changed. */
  async onBuildPlan(selectedRefs: string[]): Promise<void> {
    if (selectedRefs.length === 0) throw new Error('Выберите хотя бы одну ветку.');
    this.s.selectedRefs = new Set(selectedRefs);
    await this.builder.rebuild();
  }

  /** Drops the chronology and the selection — start over without closing the section. */
  async onClearPlan(): Promise<void> {
    this.s.selectedRefs = new Set();
    this.s.plan = null;
    this.s.persist();
    this.s.panel.postPlan(null);
  }

  /** The forgotten branches window (in releases), saved to the project; used from the next build. */
  async onSetStaleBranchesLookback(n: number): Promise<void> {
    const normalized = Number.isFinite(n) && n > 0 ? Math.floor(n) : this.s.config.staleBranchesLookbackReleases;
    this.s.config.staleBranchesLookbackReleases = normalized;
    await this.saveToProject({ staleBranchesLookbackReleases: normalized });
  }

  async onToggleItem(sha: string, included: boolean): Promise<void> {
    const item = this.s.plan?.items.find((i) => i.sha === sha);
    if (item && !item.applied) {
      item.included = included;
      this.s.persist();
    }
  }

  /** Whether a release branch for the date exists already (from the loaded list, no git call). */
  async onCheckReleaseDate(releaseDate: string): Promise<void> {
    if (!this.s.isActive()) return;
    if (!releaseDate) {
      this.s.panel.postReleaseDateCheck('', false);
      return;
    }
    const branchName = formatReleaseBranch(this.s.config.releaseBranchPattern, releaseDate);
    this.s.panel.postReleaseDateCheck(branchName, this.s.fullBranches.some((b) => b.name === branchName));
  }

  /** Creates (or reuses) the release branch from main — the only step that needs the date. */
  async onStartBuilding(releaseDate: string): Promise<void> {
    const s = this.s;
    if (!s.plan) throw new Error('Сначала постройте хронологию.');
    if (!releaseDate) throw new Error('Укажите дату релиза — она используется в имени релизной ветки.');
    await s.git.assertClean();
    s.releaseBranch = formatReleaseBranch(s.config.releaseBranchPattern, releaseDate);
    const mainRef = await s.refs.resolveMainRef();
    if (await s.git.branchExists(s.releaseBranch)) await s.git.checkoutBranch(s.releaseBranch);
    else await s.git.createReleaseBranch(s.releaseBranch, mainRef);
    s.plan.releaseBranch = s.releaseBranch;
    s.persist();
    await this.postCurrentBranch();
    if (!s.isActive()) return;
    s.panel.postPlan(s.plan);
  }

  /**
   * "Start the build": applies everything up to the first conflict; a click after resolving continues. A
   * switched project does not stop it (only its progress posts). The plan is rebuilt after — the branches may
   * have new commits, and applied is re-read from the release branch.
   */
  async onStartAuto(): Promise<void> {
    const plan = this.s.plan;
    if (!plan?.releaseBranch) throw new Error('Сначала создайте релизную ветку.');
    await applyAll(this.s.git, plan, (ev) => {
      this.s.persist();
      if (this.s.isActive()) this.s.panel.postProgress(ev);
    });
    await this.builder.rebuild();
  }

  /** The way out: aborts an unfinished cherry-pick. */
  async onAbortBuild(): Promise<void> {
    if (await this.s.git.isCherryPickInProgress()) await this.s.git.cherryPickAbort();
    await this.postCurrentBranch();
    if (!this.s.isActive()) return;
    this.s.panel.postError('');
  }

  /** Publishes the built release branch (git push -u), then rebuilds the plan (new commits may have come). */
  async onPublishRelease(): Promise<void> {
    const plan = this.s.plan;
    if (!plan?.releaseBranch) throw new Error('Сначала соберите релиз.');
    await this.s.git.pushBranch(this.s.config.remoteName, plan.releaseBranch);
    await this.builder.rebuild();
    if (!this.s.isActive()) return;
    this.s.panel.postPublished();
  }
}
