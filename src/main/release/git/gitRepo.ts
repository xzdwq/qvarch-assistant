import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import simpleGit, { SimpleGit } from 'simple-git';

/** The porcelain X/Y status codes the working-tree state reads. */
const PORCELAIN_CODE = { unmodified: ' ', untracked: '?' } as const;

/**
 * The repository at its lowest level: running git (simple-git, raw spawns piped into `git patch-id`) and the
 * cheap questions about refs and the working tree. GitHistory and GitService build on it.
 */
export class GitRepo {
  protected readonly git: SimpleGit;
  protected readonly repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    // An idle timeout kills a git process that hangs silently (waiting for credentials, GPG…) instead of a
    // promise that never settles. 2 minutes, not less: big history walks (the "already in main" indexes over
    // old release branches) legitimately run past 25 s on Windows.
    this.git = simpleGit(repoPath, { timeout: { block: 120000 } });
  }

  /** A raw git call — the analyzers built on this repository use it. */
  raw(args: string[]): Promise<string> {
    return this.git.raw(args);
  }

  /**
   * Runs git and collects its stdout, optionally fed by another process's stdout (pipes like
   * `git log -p | git patch-id`). A spawn error of either process (e.g. ENAMETOOLONG on a long argument list)
   * counts as a non-zero exit — callers already treat that as an empty result.
   */
  private spawnCapture(args: string[], sourceProc?: ChildProcessWithoutNullStreams): Promise<{ stdout: string; code: number }> {
    return new Promise((resolve) => {
      const proc = spawn('git', args, { cwd: this.repoPath });
      let stdout = '';
      let settled = false;
      const settle = (result: { stdout: string; code: number }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      proc.stdout.on('data', (d) => {
        stdout += d;
      });
      proc.stderr.on('data', () => {
        // ignored on purpose — callers handle the empty result
      });
      if (sourceProc) {
        sourceProc.stdout.pipe(proc.stdin);
        sourceProc.on('error', () => settle({ stdout, code: 1 }));
      } else {
        proc.stdin.end();
      }
      proc.on('error', () => settle({ stdout, code: 1 }));
      proc.on('close', (code) => settle({ stdout, code: code ?? 0 }));
    });
  }

  /** `git <sourceArgs> | git patch-id --stable`. */
  protected pipeIntoPatchId(sourceArgs: string[]): Promise<{ stdout: string; code: number }> {
    const sourceProc = spawn('git', sourceArgs, { cwd: this.repoPath });
    return this.spawnCapture(['patch-id', '--stable'], sourceProc);
  }

  async assertRepo(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      throw new Error('Указанный путь не является git-репозиторием.');
    }
  }

  async assertClean(): Promise<void> {
    const status = await this.git.status();
    if (!status.isClean()) {
      throw new Error(
        'В рабочем каталоге есть незакоммиченные изменения. Закоммитьте, застэшьте или отмените их перед сборкой релиза.'
      );
    }
  }

  /**
   * Uncommitted changes of the current branch, staged apart from unstaged (the "*" / "+" marks by the
   * current branch). Read from the porcelain X/Y codes: an untracked file (`??`) is unstaged only.
   */
  async workingTreeState(): Promise<{ hasStaged: boolean; hasUnstaged: boolean }> {
    const status = await this.git.status();
    return {
      hasStaged: status.files.some((f) => f.index !== PORCELAIN_CODE.unmodified && f.index !== PORCELAIN_CODE.untracked),
      hasUnstaged: status.files.some((f) => f.working_dir !== PORCELAIN_CODE.unmodified),
    };
  }

  async currentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current ?? '';
  }

  async conflictedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return status.conflicted;
  }

  async resolveRef(ref: string): Promise<string> {
    return (await this.git.revparse([ref])).trim();
  }

  /** A commit's author date — to pick the nearest of several fork points. */
  async commitAuthorDate(sha: string): Promise<string> {
    return (await this.git.raw(['log', '-1', '--pretty=%aI', sha])).trim();
  }

  async refExists(ref: string): Promise<boolean> {
    try {
      await this.git.revparse(['--verify', `${ref}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  async branchExists(name: string): Promise<boolean> {
    const branches = await this.git.branch(['--list', name]);
    return Object.keys(branches.branches).length > 0;
  }

  /**
   * Whether ancestorRef is in descendantRef's history. Not `merge-base --is-ancestor`: it answers only by the
   * exit code with no output, and simple-git does not throw on that — it came out true for any two refs.
   * Comparing plain `merge-base` output with the ancestor's sha answers through stdout instead.
   */
  async isAncestor(ancestorRef: string, descendantRef: string): Promise<boolean> {
    try {
      const [ancestorSha, mergeBaseSha] = await Promise.all([
        this.resolveRef(ancestorRef),
        this.git.raw(['merge-base', ancestorRef, descendantRef]).then((s) => s.trim()),
      ]);
      return mergeBaseSha === ancestorSha;
    } catch {
      return false;
    }
  }

  /**
   * `git merge-base`, failing loudly when the branches share no history: git then exits 1 with empty output,
   * simple-git returns '', and `''..ref` would mean `HEAD..ref` — the whole history down to the root.
   */
  async mergeBase(a: string, b: string): Promise<string> {
    const result = (await this.git.raw(['merge-base', a, b])).trim();
    if (!result) {
      throw new Error(`У веток ${a} и ${b} нет общего предка (не связаны общей историей).`);
    }
    return result;
  }
}
