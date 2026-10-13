import { reactive, ref, shallowRef } from 'vue'
import type { BranchCommitInfo, BranchDiffStat, BranchRef, ConflictSource, MainStatus, ProjectProfile, ReleasePlan, StaleBranchHint } from '@shared/release'
import { makeColors } from './releaseRail'
import { onNewDay } from './today'

/**
 * The "Релиз" section's state — kept here, outside the component, so that leaving the section and coming
 * back keeps the branch list, the selection and the chronology (the extension's panel was "retained" too).
 * Messages come from main (the session) exactly as they came to the extension's webview.
 */
export const today = () => new Date().toLocaleDateString('sv-SE')
export const colors = makeColors()

type Msg = { command: string } & Record<string, any>
export const rs = reactive({
  projects: [] as ProjectProfile[],
  projectId: '' as string,
  projectName: '',
  opened: '' as string,
  mainBranch: 'main',
  devBranch: 'dev',
  lookback: 4,
  patternCount: null as number | null,
  branches: [] as BranchRef[],
  selected: new Set<string>(),
  selectionInit: false,
  expanded: new Set<string>(),
  commits: new Map<string, 'loading' | { commits: BranchCommitInfo[]; truncated: boolean; forkedFrom: string | null }>(),
  nameByRef: new Map<string, string>(),
  statusOverride: new Map<string, MainStatus>(),
  diffStats: new Map<string, BranchDiffStat>(),
  listInfo: 'Загрузка веток…',
  limit: 100,
  limitInit: false,
  filter: '',
  hideInMain: false,
  showService: false,
  current: '',
  dirty: { hasStaged: false, hasUnstaged: false },
  dateCheck: { branchName: null as string | null, exists: false },
  releaseDate: today(),
  plan: null as ReleasePlan | null,
  staleHints: null as StaleBranchHint[] | null,
  staleLoading: false,
  releaseInfo: null as null | { releaseBranch: string; commits: Array<{ sha: string; subject: string; authorDate: string; authorName: string; taskUrl: string | null; commitUrl: string | null }>; note: string | null },
  expandedConflicts: new Set<string>(),
  copied: new Set<string>(),
  contextCollapsed: true,
  published: false,
  error: '',
  /** The last error was a cherry-pick conflict — "Открыть в VS Code" is offered. */
  conflict: false,
  busy: { refresh: false, pull: false, plan: false, create: false, start: false, publish: false },
})
onNewDay((prev, next) => {
  if (rs.releaseDate === prev) {
    rs.releaseDate = next
    requestDateCheck()
  }
})
/** Bumped on every change of the chronology — the rail is redrawn. */
export const planTick = ref(0)
export const lastMsg = shallowRef<Msg>()

const KEY = 'qa.release.project'
try {
  rs.projectId = localStorage.getItem(KEY) ?? ''
} catch {
  // first run
}

export function send(msg: Msg): void {
  void window.qa.releaseCmd(msg)
}
export function showError(m: string, conflict = false): void {
  rs.error = m
  rs.conflict = conflict && !!m
}

export async function loadProjects(): Promise<void> {
  rs.projects = await window.qa.releaseProjects()
}

/** Opens a project in the section (a new session in main); `force` — again even if it is open already. */
export async function openProject(id: string, force = false, resume = false): Promise<void> {
  if (!id) return
  if (rs.opened === id && !force) return
  rs.projectId = id
  rs.opened = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // not remembered — fine
  }
  rs.listInfo = 'Загрузка веток…'
  try {
    await window.qa.releaseOpen(id, resume)
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e))
  }
}

export function requestDateCheck(): void {
  send({ command: 'checkReleaseDate', releaseDate: rs.releaseDate.trim() })
}

function resetForNewContext(): void {
  rs.branches = []
  rs.selected = new Set()
  rs.selectionInit = false
  rs.limitInit = false
  rs.plan = null
  rs.releaseInfo = null
  rs.patternCount = null
  rs.dateCheck = { branchName: null, exists: false }
  showError('')
  rs.listInfo = 'Загрузка веток…'
  rs.staleHints = null
  rs.staleLoading = false
  rs.copied = new Set()
  rs.filter = ''
  rs.hideInMain = false
  rs.showService = false
  rs.expanded = new Set()
  rs.expandedConflicts = new Set()
  rs.commits = new Map()
  rs.nameByRef = new Map()
  rs.statusOverride = new Map()
  rs.diffStats = new Map()
  rs.published = false
  colors.reset()
  planTick.value++
}

function onMsg(msg: Msg): void {
  lastMsg.value = msg
  switch (msg.command) {
    case 'refreshReleaseDate':
      rs.releaseDate = msg.today
      requestDateCheck()
      break
    case 'projectName':
      rs.projectName = msg.name ?? ''
      break
    case 'resetForNewContext':
      resetForNewContext()
      break
    case 'currentBranch':
      rs.busy.create = false
      rs.busy.pull = false
      rs.current = msg.current
      rs.dirty = { hasStaged: !!msg.hasStaged, hasUnstaged: !!msg.hasUnstaged }
      rs.mainBranch = msg.mainBranch
      rs.devBranch = msg.devBranch
      rs.lookback = msg.staleBranchesLookbackReleases
      break
    case 'branches': {
      rs.busy.refresh = false
      requestDateCheck()
      if (msg.info.refreshedGitState) {
        rs.statusOverride = new Map()
        rs.diffStats = new Map()
      }
      rs.branches = msg.branches
      for (const b of msg.branches as BranchRef[]) rs.nameByRef.set(b.ref, b.name)
      if (!rs.selectionInit) {
        rs.selected = new Set(msg.selectedRefs)
        rs.selectionInit = true
      }
      if (!rs.limitInit) {
        rs.limit = msg.info.limit
        rs.limitInit = true
      }
      const info = msg.info
      rs.listInfo =
        info.totalBranches === 0
          ? 'В репозитории нет веток'
          : info.truncated
            ? `${msg.branches.length} из ${info.totalMatches} (всего ${info.totalBranches})`
            : `${msg.branches.length} из ${info.totalBranches}`
      break
    }
    case 'branchMainStatus':
      for (const [ref, s] of Object.entries(msg.statusByRef as Record<string, MainStatus>)) rs.statusOverride.set(ref, s)
      // the precise status came later than the slice: hide the ones that turned out to be in main
      if (rs.hideInMain) {
        const full = new Set(Object.entries(msg.statusByRef as Record<string, MainStatus>).filter(([, s]) => s === 'full').map(([r]) => r))
        if (full.size) rs.branches = rs.branches.filter((b) => !full.has(b.ref))
      }
      break
    case 'branchDiffStats':
      for (const [ref, s] of Object.entries(msg.diffStatByRef as Record<string, BranchDiffStat>)) rs.diffStats.set(ref, s)
      break
    case 'branchCommits': {
      rs.commits.set(msg.ref, { commits: msg.commits, truncated: msg.truncated, forkedFrom: msg.forkedFrom })
      const list = msg.commits as BranchCommitInfo[]
      if (list.length) {
        const n = list.filter((c) => c.alreadyInMain).length
        rs.statusOverride.set(msg.ref, n === 0 ? 'none' : n === list.length ? 'full' : 'partial')
      }
      break
    }
    case 'selectedRefs':
      rs.selected = new Set(msg.refs)
      rs.selectionInit = true
      break
    case 'planBuilding':
      rs.busy.plan = true
      break
    case 'planBuilt':
      rs.busy.plan = false
      rs.plan = msg.plan
      rs.staleHints = null
      rs.releaseInfo = null
      rs.copied = new Set()
      rs.published = false
      planTick.value++
      break
    case 'conflictAnalysisUpdate':
      if (rs.plan) {
        const by = new Map((msg.updates as Array<{ sha: string; conflictSources: ConflictSource[] }>).map((u) => [u.sha, u.conflictSources]))
        for (const it of rs.plan.items) {
          const s = by.get(it.sha)
          if (s) it.dryRunConflictSources = s
        }
        planTick.value++
      }
      break
    case 'releaseBranchPatternCount':
      rs.patternCount = msg.count
      break
    case 'releaseDateCheck':
      rs.dateCheck = { branchName: msg.branchName, exists: msg.exists }
      break
    case 'releaseBranchInfo':
      rs.releaseInfo = { releaseBranch: msg.releaseBranch, commits: msg.commits ?? [], note: msg.note ?? null }
      break
    case 'staleBranchesLoading':
      rs.staleLoading = true
      break
    case 'staleBranches':
      rs.staleLoading = false
      rs.staleHints = msg.hints
      for (const h of msg.hints as StaleBranchHint[]) rs.nameByRef.set(h.ref, h.branch)
      break
    case 'progress': {
      if (!rs.plan) return
      const ev = msg.event
      if (ev.type === 'applied') {
        const f = rs.plan.items.find((i) => i.sha === ev.item.sha)
        if (f) f.applied = true
        planTick.value++
      } else if (ev.type === 'conflict') {
        rs.busy.start = false
        showError(`Конфликт на коммите ${String(ev.item.sha).slice(0, 8)} «${ev.item.subject}». Разрешите его в репозитории и нажмите «Продолжить сборку».`, true)
      } else if (ev.type === 'done') {
        rs.busy.start = false
        showError('')
      }
      break
    }
    case 'published':
      rs.busy.publish = false
      rs.published = true
      break
    case 'error':
      rs.busy = { refresh: false, pull: false, plan: false, create: false, start: false, publish: false }
      showError(msg.message)
      break
  }
}
let listening = false
export function listen(): void {
  if (listening) return
  listening = true
  window.qa.onRelease(onMsg)
}
