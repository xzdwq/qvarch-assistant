import type { EditorView } from '@codemirror/view'
import type { CommandContext } from '@nb/commands/command'
import { noteRun } from '@nb/engine'
import { apiMapHosts, tabs as browserTabs } from '@renderer/lib/browser'
import { dbConns, loadConns } from '@renderer/lib/sqlDb'

/** What an «@» command may ask of the editor: the note, its values, the app's state (connections, the browser's site). */
export function commandContext(view: EditorView, notePath: string, query: string): CommandContext {
  const ctx = () => (notePath ? noteRun(notePath).ctx : {})
  return {
    latin: /^[a-z]/i.test(query.trim()),
    notePath,
    freeName(base) {
      const text = view.state.doc.toString()
      for (let n = 1; ; n++) {
        const name = n === 1 ? base : `${base}${n}`
        if (!new RegExp(`name=${name}(\\s|$)`, 'm').test(text)) return name
      }
    },
    newestListName() {
      const c = ctx()
      return Object.keys(c)
        .filter((k) => Array.isArray(c[k].value))
        .sort((a, b) => c[b].at - c[a].at)[0]
    },
    lastValueName: () => Object.keys(ctx()).pop(),
    firstDbConnection: () => dbConns.value[0]?.name ?? '',
    currentSiteUrl() {
      const host = [...apiMapHosts.value].sort((a, b) => b.last - a.last)[0]?.host
      const tab = browserTabs.value.find((t) => host && /^https?:/.test(t.url) && new URL(t.url).host === host) ?? browserTabs.value.find((t) => /^https?:/.test(t.url))
      return tab?.url ?? (host ? `https://${host}/` : 'https://')
    },
    now: () => new Date(),
    newId: () => Math.random().toString(36).slice(2, 10),
  }
}
/** The database connections loaded (a new query block takes the first one). */
export const loadDbConnections = () => void loadConns()
