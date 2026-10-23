import { BranchCommitInfo, BranchDiffStat, BranchRef, ConflictSource, MainStatus, ReleasePlan, ReleaseProgressEvent, StaleBranchHint } from './core/types'

/**
 * The extension's webview panel, for the app: the same host interface and the same messages, but they go to
 * the "Релиз" section of the main window over IPC (see main/index.ts) instead of a VS Code webview.
 */
export interface BranchListInfo {
  totalMatches: number
  totalBranches: number
  truncated: boolean
  limit: number
  refreshedGitState: boolean
}

export interface ReleasePanelHost {
  onRefreshBranches(): Promise<void>
  onFilterBranches(query: string): Promise<void>
  onSetBranchListLimit(limit: number, hideAlreadyInMain: boolean): Promise<void>
  onSetHideServiceBranches(hide: boolean): Promise<void>
  onSwitchBranch(branchName: string): Promise<void>
  onPullCurrentBranch(): Promise<void>
  onExpandBranch(ref: string): Promise<void>
  onBuildPlan(selectedRefs: string[]): Promise<void>
  onClearPlan(): Promise<void>
  onToggleItem(sha: string, included: boolean): Promise<void>
  onStartBuilding(releaseDate: string): Promise<void>
  onCheckReleaseDate(releaseDate: string): Promise<void>
  onStartAuto(): Promise<void>
  onAbortBuild(): Promise<void>
  onPublishRelease(): Promise<void>
  onSetStaleBranchesLookback(n: number): Promise<void>
}

export interface PanelContext {
  projectId?: string
  projectName?: string
}

/** A message to the renderer: `{ command, ...payload }` (the same as the webview got). */
export type ReleaseMessage = { command: string } & Record<string, unknown>
let sink: (msg: ReleaseMessage) => void = () => {}
export function setReleaseSink(fn: (msg: ReleaseMessage) => void): void {
  sink = fn
}

export class ReleasePanel {
  static current: ReleasePanel | undefined
  /** The project the section shows now. */
  currentProjectId: string | undefined

  static createOrShow(host: ReleasePanelHost, context?: PanelContext): ReleasePanel {
    const today = new Date().toLocaleDateString('sv-SE')
    if (ReleasePanel.current) {
      const p = ReleasePanel.current
      const switched = p.currentProjectId !== context?.projectId
      p.host = host
      p.currentProjectId = context?.projectId
      p.post({ command: 'refreshReleaseDate', today })
      p.post({ command: 'projectName', name: context?.projectName ?? null, id: context?.projectId ?? null })
      if (switched) p.post({ command: 'resetForNewContext' })
      return p
    }
    const p = new ReleasePanel(host)
    p.currentProjectId = context?.projectId
    ReleasePanel.current = p
    p.post({ command: 'projectName', name: context?.projectName ?? null, id: context?.projectId ?? null })
    return p
  }

  private constructor(private host: ReleasePanelHost) {}

  isCurrentHost(host: ReleasePanelHost): boolean {
    return this.host === host
  }

  /** A command from the section (the webview's postMessage). */
  async dispatch(message: { command: string } & Record<string, any>): Promise<void> {
    try {
      const h = this.host
      switch (message.command) {
        case 'refreshBranches':
          return await h.onRefreshBranches()
        case 'filterBranches':
          return await h.onFilterBranches(message.query)
        case 'setBranchListLimit':
          return await h.onSetBranchListLimit(message.limit, message.hideAlreadyInMain)
        case 'setHideServiceBranches':
          return await h.onSetHideServiceBranches(message.hide)
        case 'switchBranch':
          return await h.onSwitchBranch(message.branch)
        case 'pullCurrentBranch':
          return await h.onPullCurrentBranch()
        case 'expandBranch':
          return await h.onExpandBranch(message.ref)
        case 'buildPlan':
          return await h.onBuildPlan(message.selectedRefs)
        case 'clearPlan':
          return await h.onClearPlan()
        case 'toggleItem':
          return await h.onToggleItem(message.sha, message.included)
        case 'startBuilding':
          return await h.onStartBuilding(message.releaseDate)
        case 'checkReleaseDate':
          return await h.onCheckReleaseDate(message.releaseDate)
        case 'startAuto':
          return await h.onStartAuto()
        case 'abortBuild':
          return await h.onAbortBuild()
        case 'publishRelease':
          return await h.onPublishRelease()
        case 'setStaleBranchesLookback':
          return await h.onSetStaleBranchesLookback(message.value)
      }
    } catch (err: any) {
      this.postError(err?.message ?? String(err))
    }
  }

  private post(msg: ReleaseMessage): void {
    // the plan and the lists are plain data — a structured clone over IPC
    sink(JSON.parse(JSON.stringify(msg)) as ReleaseMessage)
  }

  postCurrentBranch(current: string, mainBranch: string, devBranch: string, staleBranchesLookbackReleases: number, dirtyState: { hasStaged: boolean; hasUnstaged: boolean }): void {
    this.post({ command: 'currentBranch', current, mainBranch, devBranch, staleBranchesLookbackReleases, hasStaged: dirtyState.hasStaged, hasUnstaged: dirtyState.hasUnstaged })
  }
  postReleaseBranchInfo(
    releaseBranch: string,
    commits: Array<{ sha: string; subject: string; authorDate: string; authorName: string; taskUrl: string | null; prUrl: string | null; commitUrl: string | null }>,
    note: string | null = null,
  ): void {
    this.post({ command: 'releaseBranchInfo', releaseBranch, commits, note })
  }
  postReleaseBranchPatternCount(count: number): void {
    this.post({ command: 'releaseBranchPatternCount', count })
  }
  postReleaseDateCheck(branchName: string, exists: boolean): void {
    this.post({ command: 'releaseDateCheck', branchName, exists })
  }
  postBranches(branches: BranchRef[], selectedRefs: string[], info: BranchListInfo): void {
    this.post({ command: 'branches', branches, selectedRefs, info })
  }
  postBranchCommits(ref: string, commits: BranchCommitInfo[], truncated: boolean, forkedFrom: string | null = null): void {
    this.post({ command: 'branchCommits', ref, commits, truncated, forkedFrom })
  }
  postStaleBranchesLoading(): void {
    this.post({ command: 'staleBranchesLoading' })
  }
  postStaleBranches(hints: StaleBranchHint[]): void {
    this.post({ command: 'staleBranches', hints })
  }
  postBranchMainStatus(statusByRef: Record<string, MainStatus>): void {
    this.post({ command: 'branchMainStatus', statusByRef })
  }
  postBranchDiffStats(diffStatByRef: Record<string, BranchDiffStat>): void {
    this.post({ command: 'branchDiffStats', diffStatByRef })
  }
  postPlan(plan: ReleasePlan | null): void {
    this.post({ command: 'planBuilt', plan })
  }
  postConflictAnalysisUpdate(updates: Array<{ sha: string; conflictSources: ConflictSource[] }>): void {
    this.post({ command: 'conflictAnalysisUpdate', updates })
  }
  postSelectedRefs(refs: string[]): void {
    this.post({ command: 'selectedRefs', refs })
  }
  postPlanBuilding(): void {
    this.post({ command: 'planBuilding' })
  }
  postProgress(event: ReleaseProgressEvent): void {
    this.post({ command: 'progress', event })
  }
  postPublished(): void {
    this.post({ command: 'published' })
  }
  postError(message: string): void {
    this.post({ command: 'error', message })
  }
}
