import { readConfig, resolveRepositoryPath, type ReleaseContext } from '../config';
import { BranchRef, ReleaseConfig, ReleasePlan } from '../core/types';
import { GitService } from '../git/gitService';
import type { ReleasePanel, ReleasePanelHost } from '../panel';
import { BranchRules } from './branchRules';
import { ReleaseLinks } from './releaseLinks';
import { RepoRefs } from './repoRefs';

const STATE_KEY_PREFIX = 'qvarhRelease.session.v3';

/** What is saved per repository between runs. */
export interface PersistedState {
  releaseBranch: string;
  selectedRefs: string[];
  plan: ReleasePlan | null;
}

/**
 * One release session's state, shared by its parts (branch list, plan builder, checks, restore): the project's
 * settings and git, the branches, the selection, the plan and its generation, persistence.
 */
export class SessionState {
  config!: ReleaseConfig;
  git!: GitService;
  panel!: ReleasePanel;
  rules!: BranchRules;
  links!: ReleaseLinks;
  refs!: RepoRefs;
  repoPath = '';
  /** The saved project the section is open for — settings changed in the section go into it. */
  projectId: string | undefined;

  /** Every branch of the repository (no limit) — the source of truth for picking and searching. */
  fullBranches: BranchRef[] = [];
  selectedRefs = new Set<string>();
  plan: ReleasePlan | null = null;
  releaseBranch = '';
  /** Grows with every plan build — a slow stale result never overwrites a newer plan. */
  planGeneration = 0;

  constructor(
    private readonly context: ReleaseContext,
    private readonly host: ReleasePanelHost
  ) {}

  /** Reads the project's settings and opens its repository (a saved profile is a superset of the config). */
  async openRepository(overrideConfig?: ReleaseConfig): Promise<void> {
    this.config = overrideConfig ?? readConfig();
    this.repoPath = resolveRepositoryPath(this.config);
    this.git = new GitService(this.repoPath);
    this.rules = new BranchRules(this.config);
    this.links = new ReleaseLinks(this.config, this.repoPath);
    this.refs = new RepoRefs(this.git, this.config);
    await this.git.assertRepo();
  }

  /**
   * The section is a singleton and every open makes a NEW session its host at once. A session whose project
   * was switched away keeps its git work going (a half-applied build must not be cut), but must not post
   * into the section any more.
   */
  isActive(): boolean {
    return this.panel.isCurrentHost(this.host);
  }

  selectedBranchRefs(): BranchRef[] {
    return this.fullBranches.filter((b) => this.selectedRefs.has(b.ref));
  }

  /** Starts a new plan generation and returns it. */
  nextPlanGeneration(): number {
    this.planGeneration += 1;
    return this.planGeneration;
  }

  /** Takes the release branch, selection and plan of a saved state. */
  adopt(state: PersistedState, emptyPlan: (releaseBranch: string) => ReleasePlan): void {
    this.releaseBranch = state.releaseBranch;
    this.selectedRefs = new Set(state.selectedRefs);
    this.plan = state.plan ? { ...state.plan, releaseBranch: this.releaseBranch } : emptyPlan(this.releaseBranch);
  }

  /** The state key is per repository: one workspace may hold profiles of different repositories. */
  private stateKey(): string {
    return `${STATE_KEY_PREFIX}:${this.repoPath}`;
  }

  persist(): void {
    const state: PersistedState = { releaseBranch: this.releaseBranch, selectedRefs: [...this.selectedRefs], plan: this.plan };
    void this.context.workspaceState.update(this.stateKey(), state);
  }

  /**
   * The saved state of THIS repository when its release branch still exists. Migrates once from the old
   * key shared by all repositories — only when that release branch exists here (else it is another project's).
   */
  async findUsablePersistedState(): Promise<PersistedState | undefined> {
    let state = this.context.workspaceState.get<PersistedState>(this.stateKey());
    if (!state) {
      const legacy = this.context.workspaceState.get<PersistedState>(STATE_KEY_PREFIX);
      if (legacy?.releaseBranch && (await this.git.branchExists(legacy.releaseBranch))) {
        state = legacy;
        void this.context.workspaceState.update(this.stateKey(), legacy);
        void this.context.workspaceState.update(STATE_KEY_PREFIX, undefined);
      }
    }
    if (state?.releaseBranch && !(await this.git.branchExists(state.releaseBranch))) {
      return undefined; // the branch is gone — the state no longer applies
    }
    return state;
  }
}
