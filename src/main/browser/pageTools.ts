import { app, BrowserWindow as Win, dialog, ipcMain, type BrowserWindow, type Session, type WebContents } from 'electron'
import { basename, extname, join } from 'node:path'
import { originOf, type BrowserHost, type Tab } from './tab'

/** A page's own tools: saved to disk, its site's data dropped, its localStorage read, its rulers. */

/** «Сохранить как…»: the page with its files (or one .mhtml), where the user says. */
export async function savePageAs(win: BrowserWindow, wc: WebContents, emit: (type: string, payload: unknown) => void): Promise<void> {
  const name = (wc.getTitle() || 'page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'page'
  const r = await dialog.showSaveDialog(win, {
    title: 'Сохранить страницу',
    defaultPath: join(app.getPath('downloads'), `${name}.html`),
    filters: [
      { name: 'Веб-страница полностью', extensions: ['html'] },
      { name: 'Веб-страница, один файл (MHTML)', extensions: ['mhtml'] },
    ],
  })
  if (r.canceled || !r.filePath) return
  try {
    await wc.savePage(r.filePath, extname(r.filePath).toLowerCase() === '.mhtml' ? 'MHTML' : 'HTMLComplete')
    emit('download', { name: basename(r.filePath), path: r.filePath, state: 'completed' })
  } catch {
    emit('download', { name: basename(r.filePath), path: r.filePath, state: 'interrupted' })
  }
}

/** Everything a site keeps (cache, cookies, storage, service workers) dropped. */
export async function clearSiteData(ses: Session, origin: string): Promise<void> {
  try {
    await ses.clearData({ origins: [origin] })
  } catch {
    await ses.clearStorageData({ origin })
    await ses.clearCache()
  }
}

type SiteStorage = { origin: string; localStorage: Array<{ name: string; value: string }> }
/**
 * What the sites keep in localStorage, as Playwright's storageState wants it: from an open tab of the site, else
 * from a hidden page of it (its robots.txt — any page of the origin sees its storage; nothing of the site runs).
 */
export async function readLocalStorage(ses: Session, tabs: Map<string, Tab>, origins: string[]): Promise<SiteStorage[]> {
  const out: SiteStorage[] = []
  const read = (wc: WebContents) => wc.executeJavaScript('Object.entries(localStorage).map(([name, value]) => ({ name, value }))', true) as Promise<Array<{ name: string; value: string }>>
  for (const origin of [...new Set(origins)]) {
    if (!/^https?:\/\//i.test(origin)) continue
    try {
      const tab = [...tabs.values()].find((t) => !t.asleep && originOf(t.view.webContents.getURL()) === origin)
      let items: Array<{ name: string; value: string }>
      if (tab) items = await read(tab.view.webContents)
      else {
        const w = new Win({ show: false, webPreferences: { session: ses, sandbox: true } })
        try {
          await Promise.race([w.loadURL(`${origin}/robots.txt`), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 10000))]).catch(() => undefined)
          items = await read(w.webContents)
        } finally {
          w.destroy()
        }
      }
      if (items.length) out.push({ origin, localStorage: items })
    } catch {
      // the site is not reachable now — the run goes without its storage
    }
  }
  return out
}

/** Rulers over the page: drawn by the page's preload, kept here across its navigations. */
export class PageRulers {
  constructor(private host: BrowserHost) {
    ipcMain.handle('qa:ruler-get', (e) => this.host.byContents(e.sender)?.ruler ?? null)
    ipcMain.on('qa:ruler-set', (e, g: { v?: number[]; h?: number[]; on?: boolean }) => {
      const t = this.host.byContents(e.sender)
      if (!t) return
      const clean = (a: unknown) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isFinite(n)).slice(0, 100) : [])
      t.ruler = { on: g.on ?? t.ruler.on, v: clean(g.v), h: clean(g.h) }
      t.t.ruler = t.ruler.on
      this.host.changed()
    })
  }
  set(id: string, on: boolean): void {
    const t = this.host.tabs.get(id)
    if (!t) return
    this.host.wake(t)
    t.ruler = { ...t.ruler, on }
    t.t.ruler = on
    t.view.webContents.send('qa:ruler', t.ruler)
    this.host.changed()
  }
}
