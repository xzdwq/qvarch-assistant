import { shallowRef } from 'vue'
import type { JiraState } from '@shared/jira'

const empty: JiraState = { configured: false, hasSecret: false, connected: false, syncing: false, issues: [], starred: [], myStatus: {} }
const state = shallowRef<JiraState>(empty)
let started = false

/** The Jira connection state, shared by every component of a window (one subscription). */
export function useJira() {
  if (!started) {
    started = true
    void window.qa.jiraState().then((s) => (state.value = s))
    window.qa.onJira((s) => (state.value = s))
  }
  return state
}

/** "4ч 30м" for Jira seconds. */
export function formatSec(sec?: number): string {
  if (!sec) return '—'
  const m = Math.round(sec / 60)
  const h = Math.floor(m / 60)
  return h ? (m % 60 ? `${h}ч ${String(m % 60).padStart(2, '0')}м` : `${h}ч`) : `${m}м`
}
