import { clipboard, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { Hooks } from '../hooks'
import { SOURCE_SCHEME } from '../viewSource'
import type { BrowserStore } from './browserStore'
import type { CheckTabs } from './checkTabs'
import type { DockedDevTools } from './dockedDevTools'
import type { HookSearch } from './hookSearch'
import { handlePageKeys } from './pageKeys'
import type { ScenarioRecorder } from './scenarioRecorder'
import type { BrowserHost, Tab } from './tab'

/** What a tab's page events reach: the browser's parts and its tab actions. */
export interface TabEventsHost extends BrowserHost {
  readonly hooks: Hooks
  readonly hookSearch: HookSearch
  readonly checkTabs: CheckTabs
  readonly scenario: ScenarioRecorder
  readonly store: BrowserStore
  readonly devTools: DockedDevTools
  nav(id: string, action: 'back' | 'fwd' | 'reload' | 'hard' | 'stop' | 'devtools'): void
  zoom(id: string, percent: number): void
  savePage(id: string): Promise<void>
  viewSource(id: string): void
  /** A site asks to sign in (the window asks the user; `cb` without a user — cancelled). */
  askLogin(tab: Tab, info: { host: string; realm: string }, cb: (user?: string, pass?: string) => void): void
}

/**
 * A tab's page wired: its state follows the page (address, title, icon, loading, errors), the history, the hooks,
 * «Проверка» and a scenario's recording hear of its navigations; its links, sign-ins, keys and menu are the browser's.
 */
export function wireTab(b: TabEventsHost, tab: Tab): void {
  const wc = tab.view.webContents
  const t = tab.t
  const sync = () => {
    t.url = wc.getURL() || t.url
    t.canBack = wc.navigationHistory.canGoBack()
    t.canFwd = wc.navigationHistory.canGoForward()
    b.changed()
  }
  wc.on('did-start-loading', () => ((t.loading = true), b.changed()))
  wc.on('did-stop-loading', () => ((t.loading = false), sync()))
  wc.on('did-start-navigation', (d) => {
    // a hook's search listens from the start of the page (its HTML too)
    if (d.isMainFrame && !d.isSameDocument) b.hookSearch.sync(tab, d.url)
    if (d.isMainFrame && !d.isSameDocument) void b.checkTabs.sync(tab)
    if (d.isMainFrame && !d.isSameDocument) t.error = undefined
  })
  wc.on('dom-ready', () => b.hooks.apply(wc))
  // the page's HTML for a hook's search (no «loadingFinished» comes for it)
  wc.on('did-finish-load', () => b.hookSearch.pageLoaded(tab))
  // the recording tab: each page of it records (not only the one that asked), the address changes are waited for
  wc.on('dom-ready', () => b.scenario.recordsIn(t.id) && wc.send('qa:pwrec', true))
  wc.on('did-navigate', (_e, url) => {
    b.scenario.onNavigated(tab, url)
    b.hookSearch.sync(tab, url)
    t.url = url
    t.favicon = undefined
    // its title comes later (the old one is the previous page's)
    b.store.visit(tab, url, '', true)
    sync()
  })
  wc.on('did-navigate-in-page', (_e, url, isMain) => {
    if (!isMain) return
    b.scenario.onNavigated(tab, url)
    t.url = url
    // a single-page site's own pages count as openings too
    b.store.visit(tab, url, t.title, true)
    sync()
  })
  wc.on('will-navigate', (e) => {
    if (e.url.startsWith('file:') && !wc.getURL().startsWith('file:') && !e.url.startsWith(SOURCE_SCHEME)) {
      e.preventDefault()
      b.create(e.url, t.id)
    }
  })
  wc.on('page-title-updated', (_e, title) => {
    t.title = title
    b.store.visit(tab, t.url, title, false)
    b.changed()
  })
  // the window's rules allow no remote pictures: the icon comes over as data (small ones only)
  wc.on('page-favicon-updated', (_e, icons) => {
    const src = icons[0]
    if (!src) return
    if (src.startsWith('data:')) return void ((t.favicon = src), b.changed())
    void b.ses
      .fetch(src)
      .then(async (r) => {
        if (!r.ok) return
        const buf = Buffer.from(await r.arrayBuffer())
        if (buf.length > 64 * 1024) return
        t.favicon = `data:${r.headers.get('content-type') || 'image/x-icon'};base64,${buf.toString('base64')}`
        b.changed()
      })
      .catch(() => undefined)
  })
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    // -3: a navigation cut off by another one — no error
    if (!isMain || code === -3 || t.error?.cert) return
    t.error = { code, desc, url }
    t.loading = false
    b.changed()
  })
  wc.on('zoom-changed', (_e, dir) => b.zoom(t.id, t.zoom + (dir === 'in' ? 10 : -10)))
  // window.open / target=_blank: a new tab next to this one
  wc.setWindowOpenHandler(({ url }) => {
    b.create(url, t.id)
    return { action: 'deny' }
  })
  wc.on('login', (e, _details, info, cb) => {
    e.preventDefault()
    b.askLogin(tab, info, (u, p) => (u === undefined ? cb() : cb(u, p ?? '')))
  })
  handlePageKeys(wc, {
    nav: (a) => b.nav(t.id, a),
    zoomBy: (step) => b.zoom(t.id, t.zoom + step),
    zoomReset: () => b.zoom(t.id, 100),
    send: (key) => b.emit('key', { id: t.id, key }),
    save: () => void b.savePage(t.id),
    viewSource: () => b.viewSource(t.id),
    print: () => wc.print(),
  })
  wc.on('context-menu', (_e, p) => Menu.buildFromTemplate(pageMenu(b, tab, p)).popup({ window: b.window() }))
}

/** A page's context menu: its link, its editing, its picture, then the page's own actions. */
function pageMenu(b: TabEventsHost, tab: Tab, p: Electron.ContextMenuParams): MenuItemConstructorOptions[] {
  const wc = tab.view.webContents
  const id = tab.t.id
  const items: MenuItemConstructorOptions[] = []
  if (p.linkURL) {
    items.push({ label: 'Открыть в новой вкладке', click: () => b.create(p.linkURL, id) })
    items.push({ label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) })
    items.push({ type: 'separator' })
  }
  if (p.isEditable) {
    items.push({ label: 'Вырезать', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Копировать', role: 'copy', enabled: p.editFlags.canCopy }, { label: 'Вставить', role: 'paste', enabled: p.editFlags.canPaste }, { label: 'Выделить всё', role: 'selectAll' })
    items.push({ type: 'separator' })
  } else if (p.selectionText) {
    items.push({ label: 'Копировать', role: 'copy' }, { type: 'separator' })
  }
  if (p.srcURL && p.mediaType === 'image') items.push({ label: 'Открыть картинку в новой вкладке', click: () => b.create(p.srcURL, id) })
  if (p.srcURL && p.mediaType === 'image') items.push({ label: 'Сохранить картинку как…', click: () => wc.downloadURL(p.srcURL) }, { label: 'Копировать картинку', click: () => wc.copyImageAt(p.x, p.y) }, { type: 'separator' })
  items.push(
    { label: 'Назад', accelerator: 'Alt+Left', enabled: wc.navigationHistory.canGoBack(), click: () => b.nav(id, 'back') },
    { label: 'Вперёд', accelerator: 'Alt+Right', enabled: wc.navigationHistory.canGoForward(), click: () => b.nav(id, 'fwd') },
    { label: 'Обновить', accelerator: 'F5', click: () => b.nav(id, 'reload') },
    { type: 'separator' },
    { label: 'Сохранить как…', accelerator: 'Ctrl+S', click: () => void b.savePage(id) },
    { label: 'Печать…', accelerator: 'Ctrl+P', click: () => wc.print() },
    { type: 'separator' },
    { label: 'Копировать адрес страницы', click: () => clipboard.writeText(wc.getURL()) },
    { label: 'Открыть в системном браузере', click: () => void shell.openExternal(wc.getURL()) },
    { type: 'separator' },
    { label: 'Просмотр кода страницы', accelerator: 'Ctrl+U', click: () => b.viewSource(id) },
    { label: 'Посмотреть код', accelerator: 'Ctrl+Shift+I', click: () => (b.devTools.open(tab), wc.inspectElement(p.x, p.y)) },
  )
  return items
}
