/** A Jira issue as kept locally (only what the task list and the pickers need). */
export interface JiraIssue {
  key: string
  summary: string
  status: string
  /** Jira status category: new / indeterminate (in progress) / done. */
  category: 'new' | 'indeterminate' | 'done'
  project: { key: string; name: string }
  type: string
  priority?: string
  /** YYYY-MM-DD */
  due?: string
  /** Original estimate, seconds. */
  estimateSec?: number
  /** Logged in Jira, seconds. */
  spentSec?: number
  assignee?: string
  /** Assigned to the signed-in user. */
  mine: boolean
  updated: number
}

/** My own mark for a task (set in the app, not in Jira). */
export type MyTaskStatus = 'review' | 'done'

/** What the renderers see of the Jira connection. */
export interface JiraState {
  /** Client ID entered and the secret saved. */
  configured: boolean
  hasSecret: boolean
  connected: boolean
  account?: { accountId: string; name: string }
  siteUrl?: string
  syncing: boolean
  syncedAt?: number
  error?: string
  issues: JiraIssue[]
  /** Tasks picked by hand from the whole list. */
  starred: string[]
  myStatus: Record<string, MyTaskStatus>
}

/** The task a block of time is linked to. */
export interface TaskRef {
  key: string
  summary: string
}

/** "1 задача", "2 задачи", "5 задач" */
export function tasksWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  return d === 1 && dd !== 11 ? `${n} задача` : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? `${n} задачи` : `${n} задач`
}

/** A plain copy of a task ref — reactive proxies cannot cross IPC ("An object could not be cloned"). */
export const plainTask = (t?: TaskRef): TaskRef | undefined => (t ? { key: t.key, summary: t.summary } : undefined)

/** The block's label without the task key in front (the key is shown on its own). */
export function labelWithoutKey(label: string, key?: string): string {
  return key && label.startsWith(key) ? label.slice(key.length).replace(/^[\s:·—-]+/, '') : label
}

/** Tasks offered when labelling time: mine (not done) + picked by hand. */
export function pickableTasks(s: Pick<JiraState, 'issues' | 'starred' | 'myStatus'>): JiraIssue[] {
  return s.issues
    .filter((i) => (i.mine || s.starred.includes(i.key)) && i.category !== 'done' && s.myStatus[i.key] !== 'done')
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.updated - a.updated)
}

/** Board URLs / keys → project keys ("…/projects/DOS/boards/98" → "DOS"). */
export function projectKeys(input: string): string[] {
  const keys = new Set<string>()
  for (const part of input.split(/[\s,;]+/)) {
    const m = part.match(/projects\/([A-Z][A-Z0-9_]+)/i) ?? part.match(/^([A-Z][A-Z0-9_]+)$/i)
    if (m) keys.add(m[1].toUpperCase())
  }
  return [...keys]
}
