import { app as electronApp } from 'electron'
import { BROWSER_METHODS } from '../../shared/browser'
import { SQL_METHODS } from '../../shared/sql'
import { TEST_FILES_METHODS } from '../../shared/testFiles'
import type { AppContext } from '../app/appContext'
import { Browser } from '../browser'
import { netClear, netListen, setupNoteBrowser } from '../noteBrowser'
import { SqlStore } from '../sql/store'
import { emit, handle, handleDispatch, listen } from './router'

/**
 * The Браузер section (its pages, recording, checks, the API map), the notebook's test files, «Базы данных» — each a
 * service the window calls by method name — and the notes' browser component (a page's requests listened to).
 */
export function registerBrowserIpc(app: AppContext): void {
  const browser = new Browser(app.store.root, (type, payload) => app.emitToMain('onBrowser', type, payload))
  app.browser = browser
  if (app.windows.main && !app.windows.main.isDestroyed()) browser.attach(app.windows.main)
  electronApp.on('will-quit', () => browser.hooks.stop())
  // a file picked while recording: into the notebook's «Записанные»
  browser.onRecordFiles = (paths) => app.files().recorded(paths)

  handleDispatch('browser', BROWSER_METHODS, () => browser)
  handleDispatch('files', TEST_FILES_METHODS, () => app.files())
  // «Базы данных»: made on its first use (the notebook is there by then)
  handleDispatch('sql', SQL_METHODS, () => (app.sqlStore ??= new SqlStore(app.store.root, app.script('sqlWorker.js'), app.vault)))
  listen('browserLayout', (_e, rects) => browser.layout(Array.isArray(rects) ? rects : []))
  listen('browserOpen', (_e, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
    browser.open(url)
    app.windows.showMain({ view: 'browser' })
  })

  // the notes' browser component
  const nbEmit = (host: Electron.WebContents, type: string, payload: unknown) => emit(host, 'onNoteBrowser', type, payload)
  setupNoteBrowser(nbEmit, () => browser.uaOverride())
  handle('nbNet', (e, id, on, preserve) => netListen(e.sender, Number(id), !!on, !!preserve, nbEmit))
  handle('nbNetClear', (e, id) => netClear(e.sender, Number(id)))
}
