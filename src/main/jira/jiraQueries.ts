import type { JiraFacets, JiraIssue, JiraListItem, JiraListQuery, JiraVersion } from '../../shared/jira'
import { listTasks, priorityRank } from '../../shared/jira'
import { taskTree } from '../../shared/jiraTree'

/** A page of a list: `offset` from 0, `limit` within 1…200. */
function pageOf<T>(list: T[], offset: number, limit: number): T[] {
  const from = Math.max(0, offset)
  return list.slice(from, from + Math.min(200, Math.max(1, limit)))
}
/** The search's words (lower case); none — everything matches. */
const wordsOf = (q: string): string[] => q.trim().toLowerCase().split(/\s+/).filter(Boolean)
const uniq = (xs: Array<string | undefined>): string[] => [...new Set(xs.filter((x): x is string => !!x))]

const CATEGORY_ORDER = { indeterminate: 0, new: 1, done: 2 } as const

export interface IssueSearch {
  q: string
  offset: number
  limit: number
  /** 'pick' — choosing a task: mine and starred first, then by due date; 'list' — by project, due date, state. */
  mode: 'list' | 'pick'
  /** The task list's own filters and sort (instead of the mode's order). */
  query?: JiraListQuery
  starred: string[]
  /** Today, YYYY-MM-DD (the list's «overdue» and similar). */
  today: string
  /** The tasks' ancestors fetched apart (the tree's upper levels). */
  parents?: readonly JiraIssue[]
}

/**
 * A page of the open tasks that match a search (key, title, labels, components, status, people, the
 * description), the facets of all the open ones; without the descriptions.
 */
/** `total` — the rows (pages are of them; in the tree the ancestors too), `found` — the tasks themselves. */
export function findIssues(issues: JiraIssue[], s: IssueSearch): { items: JiraListItem[]; total: number; found: number; facets: JiraFacets } {
  const words = wordsOf(s.q)
  const top = (i: JiraIssue) => (i.mine || s.starred.includes(i.key) ? 0 : 1)
  const hit = (i: JiraIssue) => {
    if (!words.length) return true
    const hay = `${i.key} ${i.summary} ${(i.labels ?? []).join(' ')} ${(i.components ?? []).join(' ')} ${i.status} ${i.assignee ?? ''} ${i.parent?.key ?? ''} ${i.description ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  }
  const openOnes = issues.filter((i) => i.category !== 'done')
  const found = openOnes.filter(hit)
  const list = s.query
    ? listTasks(found, s.query, s.today)
    : found.sort(
        s.mode === 'pick'
          ? (a, b) => top(a) - top(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.updated - a.updated
          : (a, b) => a.project.key.localeCompare(b.project.key) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || b.updated - a.updated,
      )
  const rankOf = (priority: string) => priorityRank({ priority, priorityId: openOnes.find((i) => i.priority === priority)?.priorityId })
  const facets: JiraFacets = {
    statuses: uniq(openOnes.map((i) => i.status)).sort((a, b) => a.localeCompare(b, 'ru')),
    labels: uniq(openOnes.flatMap((i) => i.labels ?? [])).sort((a, b) => a.localeCompare(b, 'ru')),
    priorities: uniq(openOnes.map((i) => i.priority)).sort((a, b) => rankOf(a) - rankOf(b)),
  }
  // the tree: the found tasks under their ancestors (any task known — open ones not found, the ones fetched apart)
  const rows: JiraListItem[] =
    s.query?.view === 'tree' ? taskTree(list, new Map([...(s.parents ?? []), ...issues].map((i) => [i.key, i])), new Set(s.query.folded ?? [])) : list
  return { items: pageOf(rows, s.offset, s.limit).map(withoutDescription), total: rows.length, found: list.length, facets }
}

/** A task without its description (the windows ask for one task's description at a time). */
export function withoutDescription<T extends JiraIssue>({ description: _d, ...i }: T): T {
  return i as T
}

/**
 * A page of the releases matching a search (archived ones left out): the unreleased first (the nearest date first),
 * then the released ones (the latest first). `unreleased` — how many of all the matches are not released.
 */
export function findVersions(versions: JiraVersion[], q: string, offset: number, limit: number): { items: JiraVersion[]; total: number; unreleased: number } {
  const words = wordsOf(q)
  const all = versions.filter((v) => !v.archived && words.every((w) => `${v.project} ${v.name} ${v.description ?? ''}`.toLowerCase().includes(w)))
  const open = all.filter((v) => !v.released).sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999') || a.name.localeCompare(b.name, 'ru', { numeric: true }))
  const done = all.filter((v) => v.released).sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') || b.name.localeCompare(a.name, 'ru', { numeric: true }))
  const list = [...open, ...done]
  return { items: pageOf(list, offset, limit), total: list.length, unreleased: open.length }
}
