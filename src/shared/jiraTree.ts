import type { JiraIssue, JiraListItem } from './jira'

/**
 * The tasks as a tree of their parents (a solution → its epics → their stories → their tasks → sub-tasks), however
 * deep Jira's hierarchy goes. The tasks found are the leaves of interest; their ancestors are shown above them as
 * context (dimmed) when they are not among the found ones themselves (filtered out, done, of another project). Each
 * level in the list's order; a folded task hides what is under it. A broken chain (a cycle) is cut, never followed.
 */

/** How deep the parents are followed up (Jira's levels: sub-task, task, epic and a few above). */
export const TREE_DEPTH_MAX = 8

/**
 * The rows of the tree: `found` — the tasks that matched, in the list's order; `known` — every task known by key
 * (the found ones, the open ones, the ancestors fetched apart); `folded` — the keys whose children are hidden.
 */
export function taskTree(found: readonly JiraIssue[], known: ReadonlyMap<string, JiraIssue>, folded: ReadonlySet<string>): JiraListItem[] {
  const order = new Map(found.map((i, n) => [i.key, n]))
  const isFound = (k: string) => order.has(k)
  /** A task's parent among the known ones (none — it is a root). */
  const parentOf = (i: JiraIssue) => (i.parent && known.has(i.parent.key) ? known.get(i.parent.key) : undefined)
  // every found task and its chain of ancestors, child → parent (a cycle cut where it closes)
  const kids = new Map<string, Set<string>>()
  const roots = new Set<string>()
  for (const leaf of found) {
    const seen = new Set<string>()
    let cur: JiraIssue = leaf
    for (let d = 0; d < TREE_DEPTH_MAX; d++) {
      seen.add(cur.key)
      const up = parentOf(cur)
      if (!up || seen.has(up.key)) {
        roots.add(cur.key)
        break
      }
      ;(kids.get(up.key) ?? kids.set(up.key, new Set()).get(up.key)!).add(cur.key)
      cur = up
      if (d === TREE_DEPTH_MAX - 1) roots.add(cur.key)
    }
  }
  /** A branch's place: its own (a found task) or its first found descendant's — the list's order kept. */
  const rank = new Map<string, number>()
  const rankOf = (k: string, path = new Set<string>()): number => {
    const r = rank.get(k)
    if (r !== undefined) return r
    if (path.has(k)) return Infinity
    path.add(k)
    let best = order.get(k) ?? Infinity
    for (const c of kids.get(k) ?? []) best = Math.min(best, rankOf(c, path))
    rank.set(k, best)
    return best
  }
  const byRank = (a: string, b: string) => rankOf(a) - rankOf(b)
  /** How many found tasks are under a task (a folded one shows it). */
  const inside = new Map<string, number>()
  const insideOf = (k: string, path = new Set<string>()): number => {
    const n = inside.get(k)
    if (n !== undefined) return n
    if (path.has(k)) return 0
    path.add(k)
    let sum = 0
    for (const c of kids.get(k) ?? []) sum += (isFound(c) ? 1 : 0) + insideOf(c, path)
    inside.set(k, sum)
    return sum
  }
  const out: JiraListItem[] = []
  const walk = (k: string, depth: number, path: Set<string>, section: string) => {
    const i = known.get(k)
    if (!i || path.has(k)) return
    const children = [...(kids.get(k) ?? [])].sort(byRank)
    const isFolded = folded.has(k) && children.length > 0
    out.push({ ...i, depth, section, children: children.length, inside: insideOf(k), ...(isFolded ? { folded: true } : {}), ...(isFound(k) ? {} : { context: true }) })
    if (isFolded) return
    const next = new Set(path).add(k)
    for (const c of children) walk(c, depth + 1, next, section)
  }
  // by the root's project (a branch stays whole under it), then in the list's order
  const projectOf = (k: string) => known.get(k)?.project.key ?? ''
  for (const r of [...roots].sort((a, b) => projectOf(a).localeCompare(projectOf(b)) || byRank(a, b))) walk(r, 0, new Set(), projectOf(r))
  return out
}
