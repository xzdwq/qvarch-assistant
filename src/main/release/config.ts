import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ProjectProfile, ReleaseConfig } from './core/types'

/**
 * The release builder's settings in the app: the project profiles (data/release.json) and the session state
 * of each repository (data/release-state.json) — in the extension these were VS Code settings / workspaceState.
 */
let dataDir = ''
export function setReleaseDataDir(dir: string): void {
  dataDir = dir
}
const projectsFile = () => join(dataDir, 'release.json')
const stateFile = () => join(dataDir, 'release-state.json')

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return undefined
  }
}
function writeJson(file: string, v: unknown): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(v, null, 2), 'utf8')
  renameSync(tmp, file)
}

export const DEFAULT_CONFIG: ReleaseConfig = {
  mainBranch: 'main',
  devBranch: 'dev',
  remoteName: 'origin',
  releaseBranchPattern: 'release/release-{date}',
  repositoryPath: '',
  branchListLimit: 100,
  nonTaskBranchPrefixes: ['qa', 'revert-pr-', 'chore/'],
  hideDuplicateRemoteBranches: true,
  staleBranchesLookbackReleases: 4,
  taskTrackerBaseUrl: '',
  bitbucketWorkspace: '',
  bitbucketRepoSlug: '',
}

/** No "current workspace" in the app — the release is always built for a saved project. */
export function readConfig(): ReleaseConfig {
  return { ...DEFAULT_CONFIG }
}

export function readProjects(): ProjectProfile[] {
  const list = readJson<{ projects?: ProjectProfile[] }>(projectsFile())?.projects ?? []
  return list.map((p) => ({ ...DEFAULT_CONFIG, ...p, hideDuplicateRemoteBranches: p.hideDuplicateRemoteBranches ?? true, staleBranchesLookbackReleases: p.staleBranchesLookbackReleases ?? 4 }))
}

export async function saveProjects(projects: ProjectProfile[]): Promise<void> {
  writeJson(projectsFile(), { ...readJson<object>(projectsFile()), projects })
}

/** Saves one profile (a new one gets an id); a name and a repository path are required. */
export function saveProject(p: Partial<ProjectProfile>): ProjectProfile {
  if (!p.name?.trim()) throw new Error('Укажите имя проекта.')
  if (!p.repositoryPath?.trim()) throw new Error('Укажите путь к репозиторию проекта.')
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d)
  const profile: ProjectProfile = {
    ...DEFAULT_CONFIG,
    ...p,
    id: p.id || randomUUID(),
    name: p.name.trim(),
    repositoryPath: p.repositoryPath.trim(),
    mainBranch: p.mainBranch?.trim() || 'main',
    devBranch: p.devBranch?.trim() || 'dev',
    remoteName: p.remoteName?.trim() || 'origin',
    releaseBranchPattern: p.releaseBranchPattern?.trim() || 'release/release-{date}',
    branchListLimit: num(p.branchListLimit, 100),
    staleBranchesLookbackReleases: num(p.staleBranchesLookbackReleases, 4),
    nonTaskBranchPrefixes: Array.isArray(p.nonTaskBranchPrefixes) ? p.nonTaskBranchPrefixes : parseNonTaskBranchPrefixes(String(p.nonTaskBranchPrefixes ?? '')),
    hideDuplicateRemoteBranches: p.hideDuplicateRemoteBranches ?? true,
    taskTrackerBaseUrl: p.taskTrackerBaseUrl?.trim() ?? '',
    bitbucketWorkspace: p.bitbucketWorkspace?.trim() ?? '',
    bitbucketRepoSlug: p.bitbucketRepoSlug?.trim() ?? '',
  }
  const list = readProjects()
  const i = list.findIndex((x) => x.id === profile.id)
  if (i >= 0) list[i] = profile
  else list.push(profile)
  writeJson(projectsFile(), { ...readJson<object>(projectsFile()), projects: list })
  return profile
}
export function deleteProject(id: string): void {
  writeJson(projectsFile(), { ...readJson<object>(projectsFile()), projects: readProjects().filter((p) => p.id !== id) })
}

/** The VS Code user settings files: the default one and every profile's (the extension's settings may live in a profile). */
function vscodeSettingsFiles(): string[] {
  const user = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Code', 'User')
  const files = [join(user, 'settings.json')]
  try {
    for (const d of readdirSync(join(user, 'profiles'))) files.push(join(user, 'profiles', d, 'settings.json'))
  } catch {
    // no profiles
  }
  return files.filter((f) => existsSync(f))
}

/**
 * The profiles of the VS Code extension (user settings "qvarhRelease.projects") — taken over once, when the
 * app has none yet. settings.json may have comments and trailing commas (JSONC).
 */
export function importVscodeProjects(): number {
  const found: ProjectProfile[] = []
  for (const file of vscodeSettingsFiles()) {
    let raw = readFileSync(file, 'utf8')
    raw = raw.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s: string | undefined) => s ?? '').replace(/,(\s*[}\]])/g, '$1')
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      found.push(...((parsed['qvarhRelease.projects'] as ProjectProfile[] | undefined) ?? []))
    } catch {
      // a broken file — skipped
    }
  }
  const have = readProjects()
  let n = 0
  for (const p of found) {
    if (!p?.repositoryPath || have.some((h) => h.id === p.id || h.repositoryPath === p.repositoryPath)) continue
    saveProject(p)
    n++
  }
  return n
}

/** workspaceState of the extension: one JSON file with a key per repository. */
export const releaseState = {
  get<T>(key: string): T | undefined {
    return readJson<Record<string, T>>(stateFile())?.[key]
  },
  update(key: string, value: unknown): Promise<void> {
    const all = readJson<Record<string, unknown>>(stateFile()) ?? {}
    if (value === undefined) delete all[key]
    else all[key] = value
    writeJson(stateFile(), all)
    return Promise.resolve()
  },
}
export interface ReleaseContext {
  workspaceState: typeof releaseState
}

/**
 * Ключ задачи вида "PROJ-123" (буквы, затем дефис, затем номер) — универсальный формат, принятый
 * не только в Jira, но и в большинстве других таск-трекеров.
 */
const TASK_KEY_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/

/** Ищет ключ задачи (напр. PROJ-123) в имени ветки или subject коммита. */
export function extractTaskKey(text: string): string | null {
  const match = TASK_KEY_PATTERN.exec(text)
  return match ? match[1] : null
}

export function buildTaskUrl(cfg: ReleaseConfig, key: string): string {
  return `${cfg.taskTrackerBaseUrl.replace(/\/+$/, '')}/${key}`
}

export function buildBitbucketPrUrl(cfg: ReleaseConfig, repoSlug: string, prNumber: number): string {
  return `https://bitbucket.org/${cfg.bitbucketWorkspace}/${repoSlug}/pull-requests/${prNumber}`
}

export function buildBitbucketCommitUrl(cfg: ReleaseConfig, repoSlug: string, sha: string): string {
  return `https://bitbucket.org/${cfg.bitbucketWorkspace}/${repoSlug}/commits/${sha}`
}

/** Если bitbucketRepoSlug не задан в конфиге — по умолчанию берём имя папки репозитория. */
export function resolveBitbucketRepoSlug(cfg: ReleaseConfig, repoPath: string): string {
  if (cfg.bitbucketRepoSlug) {
    return cfg.bitbucketRepoSlug
  }
  const parts = repoPath.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

export function parseNonTaskBranchPrefixes(raw: string): string[] {
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
}

export function resolveRepositoryPath(cfg: ReleaseConfig): string {
  if (cfg.repositoryPath) {
    return cfg.repositoryPath
  }
  throw new Error('У проекта не задан путь к репозиторию.')
}

export function formatReleaseBranch(pattern: string, date: string): string {
  return pattern.replace('{date}', date)
}

/**
 * Проверка "это релизная ветка?" по неймспейсу шаблона релизной ветки — части пути до первого "/"
 * (например "release/release-{date}" → всё, что начинается с "release/").
 */
export function releaseBranchMatcher(pattern: string): (name: string) => boolean {
  const slashIndex = pattern.indexOf('/')
  const namespace = slashIndex >= 0 ? pattern.slice(0, slashIndex + 1) : pattern.split('{')[0]
  return (name: string) => name.startsWith(namespace)
}
