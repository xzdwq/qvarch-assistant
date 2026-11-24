import { ref, shallowRef } from 'vue'
import { MAX_GROUPS, MONITOR_KEEP } from '@shared/browser/inspect/constants'
import type { InspectNews, InspectView } from '@shared/browser/inspect/types'

/**
 * The inspector's state in the window: each tab's view (its passport, its log of groups), kept up by main's news —
 * only the groups that changed come, merged here by id. A copy's word shown a moment.
 */
export const inspectViews = shallowRef<Record<string, InspectView>>({})
export const inspectNotice = ref<{ text: string; error?: boolean }>()

let noticeTimer: ReturnType<typeof setTimeout> | undefined
function notice(text: string, error = false): void {
  clearTimeout(noticeTimer)
  inspectNotice.value = { text, error }
  noticeTimer = setTimeout(() => (inspectNotice.value = undefined), error ? 5000 : 2200)
}

/** A tab's news merged into its view (a new page / cleared — the log anew). */
export function applyInspectNews(n: InspectNews): void {
  const was = inspectViews.value[n.tabId]
  const groups = n.reset || !was ? [] : [...was.groups]
  for (const g of n.groups) {
    const i = groups.findIndex((x) => x.id === g.id)
    if (i >= 0) groups[i] = g
    else groups.push(g)
  }
  if (groups.length > MAX_GROUPS) groups.splice(0, groups.length - MAX_GROUPS)
  const passport = n.passport ?? (n.reset ? undefined : was?.passport)
  const monitor = [...(was?.monitor ?? []), ...n.monitor].slice(-MONITOR_KEEP)
  const anims = n.anims ?? (n.reset ? [] : (was?.anims ?? []))
  inspectViews.value = { ...inspectViews.value, [n.tabId]: { tabId: n.tabId, on: n.on, ...(n.blocked ? { blocked: n.blocked } : {}), ...(passport ? { passport } : {}), groups, monitor, anims } }
}
/** A copy from the page's menu done (or not). */
export function inspectCopied(p: { what: string; chars?: number; error?: string }): void {
  if (p.error) notice(`${p.what}: не вышло — ${p.error}`, true)
  else notice(`Скопировано: ${p.what.replace(/^Скопировать /, '')} · ${p.chars ?? 0} символов`)
}
/** A copy made in the window itself (the report). */
export const copiedHere = (what: string) => notice(`Скопировано: ${what}`)

/** A tab's whole view read once (the panel opened on it). */
export async function loadInspect(tabId: string): Promise<void> {
  const v = await window.qa.browser('inspectView', tabId)
  if (v) inspectViews.value = { ...inspectViews.value, [tabId]: v }
}
