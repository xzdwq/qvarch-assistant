import { computed } from 'vue'
import type { PlanItem } from '@shared/release'
import { openUrl } from '../../lib/links'
import { planTick, rs, send, showError } from '../../lib/releaseStore'

/** What the section's cards do — commands to the session over the store, shared by several cards. */

/** Opens a link (task, PR, commit) when there is one. */
export const openLink = (url?: string | null) => url && openUrl(url)

/** "Открыть в VS Code" — conflicts are resolved in the editor. */
export const openInCode = (path: string) => path && void window.qa.releaseOpenInCode(path)

/** The open project's repository folder. */
export const repoPath = computed(() => rs.projects.find((p) => p.id === rs.projectId)?.repositoryPath ?? '')

/** Builds the chronology of the selected branches (with the conflict check). */
export function buildPlan(): void {
  showError('')
  rs.busy.plan = true
  send({ command: 'buildPlan', selectedRefs: [...rs.selected] })
}

/** Adds a branch to the selection or takes it out. */
export function setSelected(ref: string, on: boolean): void {
  const s = new Set(rs.selected)
  if (on) s.add(ref)
  else s.delete(ref)
  rs.selected = s
}

/** Asks for a branch's own commits once (the row shows "loading" until they come). */
export function loadBranchCommits(ref: string): void {
  if (rs.commits.has(ref)) return
  rs.commits.set(ref, 'loading')
  send({ command: 'expandBranch', ref })
}

/** Includes / excludes a plan item. */
export function toggleItem(it: PlanItem, on: boolean): void {
  it.included = on
  planTick.value++
  send({ command: 'toggleItem', sha: it.sha, included: on })
}
