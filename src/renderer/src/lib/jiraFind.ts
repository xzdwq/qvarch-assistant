import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import type { JiraFacets, JiraIssue, JiraListQuery } from '@shared/jira'
import { useJira } from './jira'

/**
 * Open Jira tasks page by page: the search goes to the main process (debounced), the next page is asked for when
 * the list is scrolled near its end (`onScroll`) — a long list never renders at once.
 */
export function useJiraFind(q: Ref<string>, opts: { page?: number; active?: Ref<boolean>; mode?: 'list' | 'pick'; query?: Ref<JiraListQuery> } = {}) {
  const PAGE = opts.page ?? 50
  const items = shallowRef<JiraIssue[]>([])
  const total = ref(0)
  const loading = ref(false)
  const facets = shallowRef<JiraFacets>({ statuses: [], priorities: [] })
  const jira = useJira()
  let seq = 0
  async function load(reset: boolean): Promise<void> {
    if (opts.active && !opts.active.value) return
    if (!reset && (loading.value || items.value.length >= total.value)) return
    const my = ++seq
    loading.value = true
    try {
      const r = await window.qa.jiraFind(q.value, reset ? 0 : items.value.length, PAGE, opts.mode, opts.query ? (JSON.parse(JSON.stringify(opts.query.value)) as JiraListQuery) : undefined)
      if (my !== seq) return
      items.value = reset ? r.items : [...items.value, ...r.items]
      total.value = r.total
      facets.value = r.facets
    } finally {
      if (my === seq) loading.value = false
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(q, () => {
    clearTimeout(timer)
    timer = setTimeout(() => void load(true), 160)
  })
  if (opts.query) watch(opts.query, () => void load(true), { deep: true })
  // a sync, a star, an own «готово» — the list follows
  watch(jira, () => void load(true))
  if (opts.active) watch(opts.active, (on) => on && void load(true))
  void load(true)
  onBeforeUnmount(() => clearTimeout(timer))
  /** For a scrolling box: near the bottom — the next page. */
  function onScroll(e: Event): void {
    const el = e.target as HTMLElement
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 160) void load(false)
  }
  return { items, total, facets, loading, more: () => load(false), reload: () => load(true), onScroll }
}
