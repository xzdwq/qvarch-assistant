import { buildBitbucketCommitUrl, buildBitbucketPrUrl, buildTaskUrl, extractTaskKey, resolveBitbucketRepoSlug } from '../config';
import { ReleaseConfig } from '../core/types';

export interface CommitLinks {
  taskUrl: string | null;
  prUrl: string | null;
  commitUrl: string | null;
}

/** Task tracker / Bitbucket links of a branch or commit — from the settings alone, no external API. */
export class ReleaseLinks {
  private readonly repoSlug: string;

  constructor(
    private readonly config: ReleaseConfig,
    repoPath: string
  ) {
    this.repoSlug = resolveBitbucketRepoSlug(config, repoPath);
  }

  /** The task (key from the branch name, else the subject), the PR and the commit links. */
  of(branchName: string, subject: string, sha: string, prNumber: number | null): CommitLinks {
    const taskKey = extractTaskKey(branchName) ?? extractTaskKey(subject);
    return {
      taskUrl: taskKey && this.config.taskTrackerBaseUrl ? buildTaskUrl(this.config, taskKey) : null,
      prUrl: prNumber && this.repoSlug ? buildBitbucketPrUrl(this.config, this.repoSlug, prNumber) : null,
      commitUrl: sha && this.repoSlug ? buildBitbucketCommitUrl(this.config, this.repoSlug, sha) : null,
    };
  }

  /** The commit link only. */
  commitUrl(subject: string, sha: string): string | null {
    return this.of('', subject, sha, null).commitUrl;
  }
}
