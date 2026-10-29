/** Jira's status categories the app knows, in their order: new / indeterminate (in progress) / done. */
export const JIRA_STATUS_CATEGORIES = ['new', 'indeterminate', 'done'] as const
export type JiraStatusCategory = (typeof JIRA_STATUS_CATEGORIES)[number]

/** A Jira issue as kept locally (only what the task list and the pickers need). */
export interface JiraIssue {
  key: string
  summary: string
  status: string
  category: JiraStatusCategory
  project: { key: string; name: string }
  type: string
  priority?: string
  /** Jira's id of the priority — the standard ones: 1 highest … 5 lowest. */
  priorityId?: string
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
  /** The description in Markdown (cut to a few thousand characters). */
  description?: string
  components?: string[]
  labels?: string[]
  /** Fix versions. */
  versions?: string[]
  /** The parent, at any level (a story's epic, an epic's solution…). */
  parent?: { key: string; summary: string }
  /** The level of its type in Jira's hierarchy: -1 a sub-task, 0 a task / story / bug, 1 an epic, 2+ above. */
  level?: number
  /** Who reported it (Jira's «Автор»). */
  reporter?: string
  /** Who made it. */
  creator?: string
  created?: number
}

/**
 * A task as a list shows it: in the tree — its depth, how many children it has, whether it is folded; `context` — an
 * ancestor shown for its descendants (not matching the filters itself, or not open, or of another project).
 */
export interface JiraListItem extends JiraIssue {
  /** The project section it is listed under (in the tree — its root's: a branch is never split). */
  section?: string
  depth?: number
  children?: number
  /** How many of the found tasks are under it (any depth). */
  inside?: number
  folded?: boolean
  context?: boolean
}

/** A release (a fix version) of a Jira project. */
export interface JiraVersion {
  id: string
  name: string
  project: string
  released: boolean
  archived?: boolean
  /** YYYY-MM-DD */
  releaseDate?: string
  description?: string
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
  /** When the error came. */
  errorAt?: number
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
  // every task that is not done; mine and starred first, then by due date and the latest change
  const top = (i: JiraIssue) => (i.mine || s.starred.includes(i.key) ? 0 : 1)
  return s.issues
    .filter((i) => i.category !== 'done')
    .sort((a, b) => top(a) - top(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.updated - a.updated)
}

/** How the task list is filtered and sorted (several values of one filter — any of them). */
export const JIRA_SORTS = ['created', 'due', 'priority', 'status', 'updated'] as const
export type JiraSort = (typeof JIRA_SORTS)[number]
/** By due date: overdue, due within a week, has a date, has none. */
export const JIRA_DUE_FILTERS = ['late', 'week', 'set', 'none'] as const
export type JiraDueFilter = (typeof JIRA_DUE_FILTERS)[number]
export interface JiraListQuery {
  sort?: JiraSort
  /** Newest / latest / highest first (the default). */
  desc?: boolean
  statuses?: string[]
  assignee?: Array<'mine' | 'other'>
  priorities?: string[]
  due?: JiraDueFilter[]
  /** Jira labels: a task with any of them. */
  labels?: string[]
  /** A flat list (by project) or the tree of parents (solution → epic → story → task). */
  view?: JiraListView
  /** In the tree: the tasks whose children are hidden. */
  folded?: string[]
}
export const JIRA_LIST_VIEWS = ['list', 'tree'] as const
export type JiraListView = (typeof JIRA_LIST_VIEWS)[number]
/** What the filters can offer: the statuses and priorities the open tasks have. */
export interface JiraFacets {
  statuses: string[]
  priorities: string[]
  labels: string[]
}

const PRIORITY_NAMES: Record<string, number> = {
  highest: 1, наивысший: 1, blocker: 1, critical: 1, критический: 1,
  high: 2, высокий: 2, major: 2,
  medium: 3, средний: 3, normal: 3, обычный: 3,
  low: 4, низкий: 4, minor: 4,
  lowest: 5, 'самый низкий': 5, trivial: 5, незначительный: 5,
}
/** 1 — the highest … 5 — the lowest (by a standard priority's name, else by Jira's id); 6 — none / unknown. */
export function priorityRank(i: Pick<JiraIssue, 'priority' | 'priorityId'>): number {
  const byName = i.priority ? PRIORITY_NAMES[i.priority.trim().toLowerCase()] : undefined
  if (byName) return byName
  const n = Number(i.priorityId)
  return n >= 1 && n <= 5 ? n : 6
}

/** The tasks the list shows, in its order: by project, the chosen sort inside each (empty values last either way). */
export function listTasks(issues: JiraIssue[], q: JiraListQuery, today: string): JiraIssue[] {
  const week = new Date(`${today}T12:00:00`)
  week.setDate(week.getDate() + 7)
  const weekEnd = week.toLocaleDateString('sv-SE')
  /** Each due filter: no date, any date, overdue, due within a week. */
  const DUE: Record<JiraDueFilter, (due?: string) => boolean> = {
    none: (due) => !due,
    set: (due) => !!due,
    late: (due) => !!due && due < today,
    week: (due) => !!due && due >= today && due <= weekEnd,
  }
  const dueOk = (i: JiraIssue) => !q.due?.length || q.due.some((d) => (DUE[d] ?? DUE.week)(i.due))
  const list = issues.filter(
    (i) =>
      (!q.statuses?.length || q.statuses.includes(i.status)) &&
      (!q.assignee?.length || q.assignee.includes(i.mine ? 'mine' : 'other')) &&
      (!q.priorities?.length || q.priorities.includes(i.priority ?? '')) &&
      (!q.labels?.length || (i.labels ?? []).some((l) => q.labels!.includes(l))) &&
      dueOk(i),
  )
  const dir = q.desc === false ? 1 : -1
  const cmp = (a: number | string | undefined, b: number | string | undefined) =>
    a === undefined ? (b === undefined ? 0 : 1) : b === undefined ? -1 : (a < b ? -1 : a > b ? 1 : 0) * dir
  /** The sort value of each order (undefined — no value, last). */
  const SORT_KEYS: Record<JiraSort, (i: JiraIssue) => number | string | undefined> = {
    created: (i) => i.created,
    updated: (i) => i.updated,
    due: (i) => i.due,
    priority: (i) => (priorityRank(i) === 6 ? undefined : -priorityRank(i)),
    status: (i) => `${JIRA_STATUS_CATEGORIES.indexOf(i.category)}${i.status}`,
  }
  // a sort stored by an older version that is gone — by status, as before
  const key = SORT_KEYS[q.sort ?? 'created'] ?? SORT_KEYS.status
  return list.sort((a, b) => a.project.key.localeCompare(b.project.key) || cmp(key(a), key(b)) || b.updated - a.updated)
}

/** Board URLs / keys → project keys ("…/projects/ABC/boards/98" → "ABC"). */
export function projectKeys(input: string): string[] {
  const keys = new Set<string>()
  for (const part of input.split(/[\s,;]+/)) {
    const m = part.match(/projects\/([A-Z][A-Z0-9_]+)/i) ?? part.match(/^([A-Z][A-Z0-9_]+)$/i)
    if (m) keys.add(m[1].toUpperCase())
  }
  return [...keys]
}
