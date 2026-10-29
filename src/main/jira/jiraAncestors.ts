import type { JiraIssue } from '../../shared/jira'
import { TREE_DEPTH_MAX } from '../../shared/jiraTree'

/** At most this many keys a search asks for at once. */
const CHUNK = 100

/**
 * The ancestors of the tasks that are not among them (a done story, an epic of another project, a solution above the
 * epics): their parents fetched, then those parents' parents… up to Jira's deepest hierarchy. A key that cannot be
 * read (no access, deleted) makes a whole search fail — a failed batch is halved until the key is found and left out.
 * `known` — the keys there already; `fetch` — the tasks of these keys (it throws on a bad key).
 */
export async function fetchAncestors(tasks: readonly JiraIssue[], known: (key: string) => boolean, fetch: (keys: string[]) => Promise<JiraIssue[]>): Promise<JiraIssue[]> {
  const got = new Map<string, JiraIssue>()
  const tried = new Set<string>()
  let frontier: readonly JiraIssue[] = tasks
  for (let level = 0; level < TREE_DEPTH_MAX && frontier.length; level++) {
    const want = [...new Set(frontier.map((i) => i.parent?.key).filter((k): k is string => !!k && !known(k) && !got.has(k) && !tried.has(k)))]
    want.forEach((k) => tried.add(k))
    const found: JiraIssue[] = []
    for (let i = 0; i < want.length; i += CHUNK) found.push(...(await fetchSome(want.slice(i, i + CHUNK), fetch)))
    for (const f of found) got.set(f.key, f)
    frontier = found
  }
  return [...got.values()]
}

/** A batch fetched; failed — its halves (one bad key alone — left out). */
async function fetchSome(keys: string[], fetch: (keys: string[]) => Promise<JiraIssue[]>): Promise<JiraIssue[]> {
  try {
    return await fetch(keys)
  } catch (e) {
    // (a lost connection is no bad key: halving would not help — it goes up)
    if (!(e instanceof Error) || !/Jira 4\d\d/.test(e.message)) throw e
    if (keys.length <= 1) return []
    const half = Math.ceil(keys.length / 2)
    return [...(await fetchSome(keys.slice(0, half), fetch)), ...(await fetchSome(keys.slice(half), fetch))]
  }
}
