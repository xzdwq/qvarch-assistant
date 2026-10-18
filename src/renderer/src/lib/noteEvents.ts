import { ref, shallowRef } from 'vue'
import type { EventRef } from '@shared/noteEvents'
import type { JiraIssue } from '@shared/jira'
import type { KindDef } from '@shared/types'

/**
 * The events the notebook mentions: every event of every day (one light list from main, kept a little while,
 * read again after the days change), the kinds (their icon and colour) and the Jira tasks named in notes.
 */
export const events = shallowRef<EventRef[]>([])
/** Bumped when anything shown on the chips may have changed (they redraw). */
export const eventsTick = ref(0)
let loadedAt = 0
let stale = true
let loading: Promise<EventRef[]> | undefined
window.qa.onDayState(() => (stale = true))
/** The list, fresh enough (read again when days changed and it is older than a few seconds). */
export function eventsNow(maxAge = 5000): Promise<EventRef[]> {
  if (!stale && events.value.length) return Promise.resolve(events.value)
  if (Date.now() - loadedAt < maxAge && events.value.length) return Promise.resolve(events.value)
  loading ??= window.qa
    .eventsIndex()
    .then((l) => {
      events.value = l
      loadedAt = Date.now()
      stale = false
      eventsTick.value++
      return l
    })
    .finally(() => (loading = undefined))
  return loading
}
const byKey = new Map<string, EventRef>()
let byKeyOf: EventRef[] | undefined
export function eventOf(day: string, id: string): EventRef | undefined {
  if (byKeyOf !== events.value) {
    byKey.clear()
    for (const e of events.value) byKey.set(`${e.day}/${e.id}`, e)
    byKeyOf = events.value
  }
  return byKey.get(`${day}/${id}`)
}

// ---------- the kinds ----------
const kinds = shallowRef<KindDef[]>([])
void window.qa.getSettings().then((s) => (kinds.value = s.kinds))
window.qa.onSettings((s) => {
  kinds.value = s.kinds
  eventsTick.value++
})
export const kindOf = (id: string) => kinds.value.find((k) => k.id === id)

// ---------- Jira tasks named in notes ----------
const issues = new Map<string, { at: number; issue?: JiraIssue; loading?: boolean }>()
/** A task's state as known (fetched once a minute at most; the chips redraw when it comes). */
export function issueOf(key: string): JiraIssue | undefined {
  const c = issues.get(key)
  if (!c || (!c.loading && Date.now() - c.at > 60_000)) {
    issues.set(key, { at: Date.now(), issue: c?.issue, loading: true })
    void window.qa
      .jiraIssue(key)
      .catch(() => undefined)
      .then((issue) => {
        issues.set(key, { at: Date.now(), issue: issue ?? c?.issue })
        eventsTick.value++
      })
  }
  return issues.get(key)?.issue
}
/** The Jira site's address (for opening a task), when connected. */
export const jiraSite = ref<string>()
void window.qa.jiraState().then((s) => (jiraSite.value = s.siteUrl))
