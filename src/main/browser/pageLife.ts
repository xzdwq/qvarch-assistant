import { dialog, type Session } from 'electron'
import { restartOrigin } from '../../shared/browser'
import type { BrowserHost, Tab } from './tab'

/**
 * A site's caches cleared before its page starts again (its process gone or hung): the HTTP cache with the compiled
 * code and the service workers — what this profile keeps of a site apart from another browser, so a broken entry
 * there would crash the page on every start. Its cookies and storage stay (the person stays signed in).
 */
export async function clearSiteCaches(ses: Session, url: string): Promise<void> {
  const origin = restartOrigin(url)
  if (!origin) return
  try {
    await ses.clearData({ origins: [origin], dataTypes: ['cache', 'serviceWorkers'] })
  } catch {
    // (not cleared — the page starts again all the same)
  }
}

/**
 * A tab's page watched by its own events: its process gone (a crash, out of memory) or not answering — told on its
 * place, «Перезапустить» starts it again (back to the page by itself when it answers again); a page that asks before
 * it is left — the person asked (Electron's way: answered at once, the leaving goes on or not).
 */
export function wirePageLife(b: BrowserHost, tab: Tab): void {
  const wc = tab.view.webContents
  const t = tab.t
  wc.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit' || wc !== tab.view.webContents) return
    console.warn(`[browser] page process gone: ${d.reason} (${d.exitCode}) at ${t.url}`)
    t.error = { code: d.exitCode, desc: d.reason, url: t.url, gone: 'crashed' }
    t.loading = false
    b.changed()
  })
  wc.on('unresponsive', () => {
    if (t.error) return
    t.error = { code: 0, desc: 'нет ответа', url: t.url, gone: 'hung' }
    b.changed()
  })
  wc.on('responsive', () => {
    if (t.error?.gone !== 'hung') return
    t.error = undefined
    b.changed()
  })
  wc.on('will-prevent-unload', (e) => {
    // (a scenario's run drives the page: it is left as the scenario wants)
    if (tab.dbg.has('run')) return e.preventDefault()
    const win = b.window()
    const ask = { type: 'question' as const, buttons: ['Покинуть', 'Остаться'], defaultId: 0, cancelId: 1, title: 'Покинуть страницу?', message: 'Покинуть страницу?', detail: 'Изменения на ней могут не сохраниться.' }
    if ((win ? dialog.showMessageBoxSync(win, ask) : dialog.showMessageBoxSync(ask)) === 0) e.preventDefault()
  })
}
