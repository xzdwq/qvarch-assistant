import { dialog } from 'electron'
import type { BrowserHost, Tab } from './tab'

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
