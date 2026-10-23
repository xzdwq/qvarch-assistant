import { ref, watch } from 'vue'
import type { JiraVersion } from '@shared/jira'
import { ipcErrorText, taskTickInfo, tickTaskBranches } from '@shared/releaseView'
import { rs } from '../../lib/releaseStore'

/**
 * A Jira release picked over the branch list ticks its tasks' branches. A limited list may hide some of them:
 * then the full list is asked for (`showAll`) and the ticking is repeated when it comes.
 */
export function useJiraReleaseTicking(fullLimit: number, showAll: () => void) {
  const relBusy = ref(false)
  /** The keys to tick once the full list of branches comes. */
  let pendingKeys: string[] | undefined

  function tickKeys(keys: string[]): void {
    const { selected, found } = tickTaskBranches(rs.branches, keys, rs.selected)
    rs.selected = selected
    rs.jiraReleaseInfo = taskTickInfo(keys.length, found)
  }

  async function onRelease(v: JiraVersion | undefined): Promise<void> {
    rs.jiraRelease = v
    rs.jiraReleaseInfo = ''
    pendingKeys = undefined
    // cleared: only the release goes, the ticked branches stay
    if (!v) return
    relBusy.value = true
    try {
      const keys = await window.qa.jiraVersionIssues(v.id)
      if (rs.jiraRelease?.id !== v.id) return
      tickKeys(keys)
      if (rs.limit < fullLimit) {
        pendingKeys = keys
        rs.limit = fullLimit
        showAll()
      }
    } catch (e) {
      rs.jiraReleaseInfo = `Jira: ${ipcErrorText(e)}`
    } finally {
      relBusy.value = false
    }
  }

  watch(
    () => rs.branches,
    () => {
      if (!pendingKeys) return
      tickKeys(pendingKeys)
      pendingKeys = undefined
    },
  )
  return { relBusy, onRelease }
}
