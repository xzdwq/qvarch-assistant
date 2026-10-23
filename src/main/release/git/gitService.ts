import { ConflictSourceAnalyzer } from './conflictAnalyzer';
import { ConflictSourceAnalysis } from './conflictText';
import { GitHistory } from './gitHistory';
import { COMMIT_FORMAT, FirstParentCommit, findPreviousReleaseMerge, parseCommitRecord, splitRecords } from './gitRecords';

export { mainSubjectDateKey } from './gitRecords';
export type { FirstParentCommit, MergeEventDetails } from './gitRecords';

/**
 * How deep the release branch's own first-parent history is walked looking for the previous release's merge
 * (see resolveReleaseBranchBaseRef) — room for several releases fast-forwarded into main in a row.
 */
const RELEASE_BRANCH_FF_BOUNDARY_WALK_CAP = 2000;

/** A cherry-pick stopped on a real conflict (files left to resolve). */
export class GitConflictError extends Error {
  constructor(
    message: string,
    public readonly sha: string
  ) {
    super(message);
  }
}

/**
 * The release builder's git: the history queries (GitHistory) plus what changes the repository — branches,
 * pull/push, worktrees for the dry-run, cherry-picks — the release branch's own commits and the conflict
 * analysis (ConflictSourceAnalyzer).
 */
export class GitService extends GitHistory {
  private readonly conflicts = new ConflictSourceAnalyzer(this);

  async checkoutBranch(name: string): Promise<void> {
    await this.git.checkout(name);
  }

  /**
   * `git pull` of the current branch. Without an upstream a bare pull refuses; when `<remote>/<branch>` exists
   * the upstream is set to it first (what git itself suggests) — checked via @{u}, not by the error text
   * (that depends on git's locale). No such remote branch — the plain pull gives git's own error.
   */
  async pull(remoteName: string): Promise<void> {
    const hasUpstream = await this.git
      .raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
      .then(() => true)
      .catch(() => false);
    if (!hasUpstream) {
      const branch = await this.currentBranch();
      const remoteRef = `${remoteName}/${branch}`;
      if (branch && (await this.refExists(remoteRef))) {
        await this.git.raw(['branch', `--set-upstream-to=${remoteRef}`, branch]);
      }
    }
    await this.git.pull();
  }

  /**
   * Creates the release branch from baseRef; throws when it exists. `--no-track` is a must: from a remote
   * branch git would set the upstream to it (main), and the editor's "Sync" would then push the release
   * commits straight into main on the remote.
   */
  async createReleaseBranch(name: string, baseRef: string): Promise<void> {
    if (await this.branchExists(name)) {
      throw new Error(`Ветка ${name} уже существует. Используйте "продолжить сборку релиза", чтобы дособрать её.`);
    }
    await this.git.raw(['checkout', '-b', name, '--no-track', baseRef]);
  }

  /** Publishes the release branch (`git push -u`). */
  async pushBranch(remoteName: string, branchName: string): Promise<void> {
    await this.git.push(['-u', remoteName, branchName]);
  }

  /** A temporary detached worktree on ref — the dry-run's safe place for cherry-picks. */
  async addWorktree(path: string, ref: string): Promise<void> {
    await this.git.raw(['worktree', 'add', '--detach', path, ref]);
  }

  async removeWorktree(path: string): Promise<void> {
    try {
      await this.git.raw(['worktree', 'remove', '--force', path]);
    } catch {
      // the folder may be gone already
    }
  }

  /** Drops orphaned worktree entries (e.g. the app closed in the middle of a dry-run). */
  async pruneWorktrees(): Promise<void> {
    try {
      await this.git.raw(['worktree', 'prune']);
    } catch {
      // not critical
    }
  }

  /**
   * Cherry-picks one integration commit (`-m 1` for a merge). 'empty' — its content is already in the target:
   * git fails then too, but with no conflicting files; that pick is skipped so nothing stays half-done.
   */
  async cherryPickIntegrationCommit(commit: FirstParentCommit): Promise<'applied' | 'empty'> {
    try {
      if (commit.parents.length > 1) {
        await this.git.raw(['cherry-pick', '-m', '1', commit.sha]);
      } else {
        await this.git.raw(['cherry-pick', commit.sha]);
      }
      return 'applied';
    } catch {
      return this.settleFailedCherryPick(
        commit,
        `Конфликт при cherry-pick коммита ${commit.sha.slice(0, 8)} ("${commit.subject}"). ` +
          'Разрешите конфликт в рабочем каталоге, затем продолжите сборку релиза.'
      );
    }
  }

  /** Continues the cherry-pick already started (the user resolved the conflict by hand); same outcomes. */
  async continueCherryPick(commit: FirstParentCommit): Promise<'applied' | 'empty'> {
    try {
      await this.git.raw(['cherry-pick', '--continue']);
      return 'applied';
    } catch {
      return this.settleFailedCherryPick(
        commit,
        `Конфликт коммита ${commit.sha.slice(0, 8)} ("${commit.subject}") разрешён не полностью. ` +
          'Разрешите оставшиеся конфликты в рабочем каталоге и нажмите "Начать сборку" ещё раз.'
      );
    }
  }

  /** A failed pick: no conflicting files — an empty pick, skipped; otherwise a GitConflictError. */
  private async settleFailedCherryPick(commit: FirstParentCommit, conflictMessage: string): Promise<'empty'> {
    const conflicted = await this.conflictedFiles();
    if (conflicted.length === 0) {
      await this.cherryPickSkip();
      return 'empty';
    }
    throw new GitConflictError(conflictMessage, commit.sha);
  }

  /**
   * The sha of a cherry-pick started but not finished (CHERRY_PICK_HEAD), or null. More reliable than
   * conflicting files: after `git add` there are none, yet the pick still waits for --continue.
   */
  async cherryPickHeadSha(): Promise<string | null> {
    try {
      const out = await this.git.raw(['rev-parse', '--verify', 'CHERRY_PICK_HEAD']);
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  async isCherryPickInProgress(): Promise<boolean> {
    return (await this.cherryPickHeadSha()) !== null;
  }

  async cherryPickAbort(): Promise<void> {
    await this.git.raw(['cherry-pick', '--abort']);
  }

  async cherryPickSkip(): Promise<void> {
    await this.git.raw(['cherry-pick', '--skip']);
  }

  /** See ConflictSourceAnalyzer. */
  analyzeConflictSource(worktreePath: string, file: string, baseRef: string, devRef: string, itemSha: string): Promise<ConflictSourceAnalysis> {
    return this.conflicts.analyze(worktreePath, file, baseRef, devRef, itemSha);
  }

  /**
   * The release branch's own commits: what it has and main had not right before the branch went in (see
   * resolveReleaseBranchBaseRef). Shown when there is no saved plan for it. otherReleaseBranchTips — tips of
   * the other existing release branches (the session knows their name pattern).
   */
  async releaseBranchOwnCommits(
    releaseBranch: string,
    mainRef: string,
    maxCount: number,
    otherReleaseBranchTips: Set<string> = new Set()
  ): Promise<FirstParentCommit[]> {
    const baseRef = await this.resolveReleaseBranchBaseRef(releaseBranch, mainRef, otherReleaseBranchTips);
    const raw = await this.git.raw(['log', releaseBranch, '--not', baseRef, '--no-merges', `--max-count=${maxCount}`, `--pretty=format:${COMMIT_FORMAT}%x1e`]);
    return splitRecords(raw).map(parseCommitRecord);
  }

  /**
   * What to compare the release branch with. Once it went into main, `--not mainRef` sees nothing of its own:
   * - merged by a merge commit: that merge's first parent (main right before) — the merge is the one whose
   *   NON-first parent is the tip (the tip may also be the first parent of the next release's merge);
   * - fast-forwarded: the nearest merge on its own chain whose non-first parent is another existing release
   *   branch's tip (any merge, or any PR merge, has proven wrong — admin merges and unrelated PRs sit between);
   * - otherwise (not released yet — the usual case) mainRef as is.
   */
  private async resolveReleaseBranchBaseRef(releaseBranch: string, mainRef: string, otherReleaseBranchTips: Set<string>): Promise<string> {
    try {
      const releaseTip = await this.resolveRef(releaseBranch);
      const mainMergeEvents = await this.listMergeEvents(mainRef);
      const mergeEvent = (mainMergeEvents.get(releaseTip) ?? []).find((ev) => ev.parents[0] !== releaseTip);
      if (mergeEvent) return mergeEvent.parents[0];
      if (await this.isAncestor(releaseBranch, mainRef)) {
        // walked from the tip back (the chain is oldest-first), so the nearest merge wins, not an ancient one
        const { commits } = await this.firstParentChain(releaseTip, RELEASE_BRANCH_FF_BOUNDARY_WALK_CAP);
        const boundary = findPreviousReleaseMerge(commits, releaseTip, otherReleaseBranchTips);
        if (boundary) return boundary.sha;
      }
      return mainRef;
    } catch {
      return mainRef;
    }
  }
}
