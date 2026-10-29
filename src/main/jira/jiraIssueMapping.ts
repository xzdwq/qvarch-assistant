import { JIRA_STATUS_CATEGORIES, type JiraIssue, type JiraStatusCategory } from '../../shared/jira'
import { adfToMarkdown } from '../../shared/adf'

/** The issue fields a search asks Jira for (what `jiraIssueFrom` reads). */
export const JIRA_ISSUE_FIELDS = ['summary', 'status', 'project', 'issuetype', 'priority', 'duedate', 'timeoriginalestimate', 'timespent', 'assignee', 'updated', 'description', 'components', 'labels', 'fixVersions', 'parent', 'reporter', 'creator', 'created']

/**
 * Where a task's parent may be written besides Jira's own `parent` (sites kept from before: Plans' «Parent Link» for
 * the levels above an epic, the old «Epic Link»): each such field known by its schema (its number differs on every
 * site) and how its value names the parent's key.
 */
export const PARENT_SOURCES: Record<string, (v: any) => string | undefined> = {
  'com.atlassian.jpo:jpo-custom-field-parent': (v) => v?.data?.key ?? v?.key,
  'com.pyxis.greenhopper.jira:gh-epic-link': (v) => (typeof v === 'string' ? v : undefined),
}
/** The site's fields that hold a parent (their ids), found among all its fields. */
export const parentFieldsOf = (fields: ReadonlyArray<{ id: string; schema?: { custom?: string } }>): Record<string, string> =>
  Object.fromEntries(fields.filter((f) => f.schema?.custom && Object.hasOwn(PARENT_SOURCES, f.schema.custom)).map((f) => [f.id, f.schema!.custom!]))

/** A task's parent: Jira's own field first, else a site's parent field (`parentFields` — field id → its schema). */
function parentOf(f: Record<string, any>, parentFields: Record<string, string>): JiraIssue['parent'] {
  if (f.parent?.key) return { key: f.parent.key, summary: f.parent.fields?.summary ?? '' }
  for (const [id, schema] of Object.entries(parentFields)) {
    const key = PARENT_SOURCES[schema](f[id])
    if (key) return { key, summary: '' }
  }
  return undefined
}

/** The names of a list of Jira objects (components, versions), or nothing. */
function namesOf(v: unknown): string[] | undefined {
  const out = Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? String((x as { name?: unknown }).name ?? '') : '')).filter(Boolean) : []
  return out.length ? out : undefined
}

/** A status category key from Jira as the app's (an unknown one — «new»). */
const statusCategoryOf = (key: unknown): JiraStatusCategory => JIRA_STATUS_CATEGORIES.find((c) => c === key) ?? 'new'

/**
 * A Jira issue's raw fields (REST API v3) as the app's task; `myAccountId` — who counts as «mine»; `parentFields` —
 * the site's own parent fields (parentFieldsOf).
 */
export function jiraIssueFrom(key: string, f: Record<string, any>, myAccountId?: string, parentFields: Record<string, string> = {}): JiraIssue {
  return {
    key,
    summary: f.summary ?? '',
    status: f.status?.name ?? '',
    category: statusCategoryOf(f.status?.statusCategory?.key),
    project: { key: f.project?.key ?? key.split('-')[0], name: f.project?.name ?? '' },
    type: f.issuetype?.name ?? '',
    priority: f.priority?.name,
    priorityId: f.priority?.id ? String(f.priority.id) : undefined,
    due: f.duedate ?? undefined,
    estimateSec: f.timeoriginalestimate ?? undefined,
    spentSec: f.timespent ?? undefined,
    assignee: f.assignee?.displayName,
    mine: !!f.assignee?.accountId && f.assignee.accountId === myAccountId,
    updated: f.updated ? Date.parse(f.updated) : 0,
    description: adfToMarkdown(f.description) || undefined,
    components: namesOf(f.components),
    labels: Array.isArray(f.labels) && f.labels.length ? f.labels.map(String) : undefined,
    versions: namesOf(f.fixVersions),
    parent: parentOf(f, parentFields),
    level: typeof f.issuetype?.hierarchyLevel === 'number' ? f.issuetype.hierarchyLevel : undefined,
    reporter: f.reporter?.displayName,
    creator: f.creator?.displayName,
    created: f.created ? Date.parse(f.created) : undefined,
  }
}

/** The project keys of the settings that can go into JQL (anything else is dropped). */
export const validProjectKeys = (projects: string[]): string[] => projects.filter((p) => /^[A-Z][A-Z0-9_]+$/.test(p))
