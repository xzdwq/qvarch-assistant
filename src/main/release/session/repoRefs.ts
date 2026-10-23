import type { DevFirstParentShas } from '../core/planner';
import { ReleaseConfig } from '../core/types';
import type { GitService, MergeEventDetails } from '../git/gitService';

/** main / dev refs with what follows from them; they change only with the repository (Pull / Refresh). */
export interface RepoRefsSnapshot {
  mainRef: string;
  devRef: string;
  /** parent sha → merge events of dev (see GitService.listMergeEvents) */
  mergeEvents: Map<string, MergeEventDetails[]>;
  devFirstParentShas: DevFirstParentShas;
}

/**
 * Which refs stand for main and dev, cached with dev's merge events and first-parent set — recomputing them
 * on every filter keystroke slowed the list and the chronology. invalidate() when the repository may change.
 */
export class RepoRefs {
  private snapshot: RepoRefsSnapshot | null = null;

  constructor(
    private readonly git: GitService,
    private readonly config: ReleaseConfig
  ) {}

  /** Drops the cache (the branch list is re-read). */
  invalidate(): void {
    this.snapshot = null;
  }

  async current(): Promise<RepoRefsSnapshot> {
    if (this.snapshot) return this.snapshot;
    const [mainRef, devRef] = await Promise.all([this.resolveMainRef(), this.resolveDevRef()]);
    const [mergeEvents, devFirstParentShas] = await Promise.all([this.git.listMergeEvents(devRef), this.git.buildDevFirstParentSet(devRef)]);
    this.snapshot = { mainRef, devRef, mergeEvents, devFirstParentShas };
    return this.snapshot;
  }

  /**
   * The main branch: the LOCAL one when it exists, else the remote-tracking one — no checkout. The release
   * branch is cut from it and "already in main" is checked against it: one base for both. The user decides
   * when to update it (Pull), the remote never leaks in as the base behind their back.
   */
  resolveMainRef(): Promise<string> {
    return this.resolveBranchRef(this.config.mainBranch);
  }

  /** The dev branch — the base of feature branches' own commits; falls back to main when there is no dev. */
  async resolveDevRef(): Promise<string> {
    const devRef = `${this.config.remoteName}/${this.config.devBranch}`;
    if (await this.git.refExists(devRef)) return devRef;
    if (await this.git.refExists(this.config.devBranch)) return this.config.devBranch;
    return this.resolveMainRef();
  }

  /** The local branch, or the remote-tracking one when there is no local (e.g. a fresh clone). */
  private async resolveBranchRef(branchName: string): Promise<string> {
    if (await this.git.refExists(branchName)) return branchName;
    return `${this.config.remoteName}/${branchName}`;
  }
}
