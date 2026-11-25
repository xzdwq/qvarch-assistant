import { join } from 'node:path'
import { readJsonFile, writeJsonQuietly } from '../fsAtomic'
import { browserId, cleanSession, DEFAULT_BROWSER_SETTINGS, type Bookmark, type BrowserSession, type BrowserEmit, type BrowserSettings, type HistoryItem, type Visit } from '../../shared/browser'
import { cleanZoomMemory, clampDevtoolsZoom, siteZoom, withSiteZoom, type ZoomMemory } from '../../shared/browser/zoom'
import { cleanClosed, takeClosed, withClosed, type ClosedTab } from '../../shared/browser/closedTabs'
import { cleanExternalMemory, externalAllowed, withExternalAllowed, type ExternalMemory } from '../../shared/browser/externalLinks'
import type { Tab } from './tab'

const MAX_HISTORY = 3000
/** The history by days: the last 90 days, at most this many openings. */
const MAX_VISITS = 30000
const VISITS_DAYS = 90

type BrowserData = {
  bookmarks: Bookmark[]
  history: HistoryItem[]
  settings: BrowserSettings
  session?: BrowserSession
  zoom: ZoomMemory
  /** The tabs the person closed, newest first («Недавно закрытые», Ctrl+Shift+T). */
  closed: ClosedTab[]
  /** The sites let open an application's links without asking (site → schemes). */
  external: ExternalMemory
}

/** The settings as written (anything missing or wrong — the default). */
function readSettings(st: Partial<BrowserSettings>): BrowserSettings {
  return {
    history: typeof st.history === 'boolean' ? st.history : DEFAULT_BROWSER_SETTINGS.history,
    ua: typeof st.ua === 'string' ? st.ua : DEFAULT_BROWSER_SETTINGS.ua,
    acceptBadCerts: typeof st.acceptBadCerts === 'boolean' ? st.acceptBadCerts : DEFAULT_BROWSER_SETTINGS.acceptBadCerts,
    sleepMin: typeof st.sleepMin === 'number' && st.sleepMin >= 0 ? Math.min(240, Math.round(st.sleepMin)) : DEFAULT_BROWSER_SETTINGS.sleepMin,
    sitePermissions: typeof st.sitePermissions === 'boolean' ? st.sitePermissions : DEFAULT_BROWSER_SETTINGS.sitePermissions,
    inspectFrame: typeof st.inspectFrame === 'boolean' ? st.inspectFrame : DEFAULT_BROWSER_SETTINGS.inspectFrame,
  }
}

/**
 * The browser's own data on disk: bookmarks, the pages opened (for the address line's suggestions), the settings and
 * the open tabs in data/browser.json; every opening by days in data/browser-history.json (read when first needed). Written a moment
 * after a change, at once on the way out.
 */
export class BrowserStore {
  readonly data: BrowserData
  private file: string
  private visitsFile: string
  private visitList: Visit[] | undefined
  private visitsTimer?: NodeJS.Timeout
  private saveTimer?: NodeJS.Timeout

  constructor(
    root: string,
    private tabs: () => Iterable<Tab>,
    private emit: BrowserEmit,
  ) {
    this.file = join(root, 'browser.json')
    this.visitsFile = join(root, 'browser-history.json')
    this.data = this.read()
  }
  get settings(): BrowserSettings {
    return this.data.settings
  }
  private read(): BrowserData {
    // a broken file is set aside — the bookmarks in it are not overwritten by the first save
    const d = readJsonFile<Partial<{ bookmarks: Bookmark[]; history: HistoryItem[]; settings: Partial<BrowserSettings>; session: unknown; zoom: unknown; closed: unknown; external: unknown }>>(this.file) ?? {}
    return {
      bookmarks: Array.isArray(d.bookmarks) ? d.bookmarks : [],
      history: Array.isArray(d.history) ? d.history : [],
      settings: readSettings(d.settings ?? {}),
      session: cleanSession(d.session),
      zoom: cleanZoomMemory(d.zoom),
      closed: cleanClosed(d.closed),
      external: cleanExternalMemory(d.external),
    }
  }

  // ---------- the tabs the person closed ----------
  closedTabs(): ClosedTab[] {
    return this.data.closed
  }
  addClosed(tab: ClosedTab): void {
    this.setClosed(withClosed(this.data.closed, tab))
  }
  /** One taken to open again (none named — the last closed). */
  takeClosed(id?: string): ClosedTab | undefined {
    const { tab, rest } = takeClosed(this.data.closed, id)
    if (tab) this.setClosed(rest)
    return tab
  }
  private setClosed(list: ClosedTab[]): void {
    this.data.closed = list
    this.save()
    this.emit('closed', list)
  }

  // ---------- an application's links (mailto:…) let through without asking ----------
  externalAllowed(site: string, scheme: string): boolean {
    return externalAllowed(this.data.external, site, scheme)
  }
  allowExternal(site: string, scheme: string): void {
    const next = withExternalAllowed(this.data.external, site, scheme)
    if (next === this.data.external) return
    this.data.external = next
    this.save()
  }

  // ---------- the zoom (each site's, the DevTools') ----------
  /** The zoom a page at this address opens with, %. */
  siteZoom(url: string): number {
    return siteZoom(this.data.zoom, url)
  }
  setSiteZoom(url: string, percent: number): void {
    const sites = withSiteZoom(this.data.zoom.sites, url, percent)
    if (sites === this.data.zoom.sites) return
    this.data.zoom = { ...this.data.zoom, sites }
    this.save()
  }
  /** The docked DevTools' zoom level (0 — 100 %). */
  devtoolsZoom(): number {
    return this.data.zoom.devtools
  }
  setDevtoolsZoom(level: number): void {
    const devtools = clampDevtoolsZoom(level)
    if (devtools === this.data.zoom.devtools) return
    this.data.zoom = { ...this.data.zoom, devtools }
    this.save()
  }

  // ---------- the open tabs (opened again on the next run) ----------
  session(): BrowserSession | undefined {
    return this.data.session
  }
  setSession(s: BrowserSession | undefined): void {
    if (JSON.stringify(s) === JSON.stringify(this.data.session)) return
    this.data.session = s
    this.save()
  }
  save(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => writeJsonQuietly(this.file, this.data, 2), 500)
  }
  /** What waits to be written goes now (the app quits). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      writeJsonQuietly(this.file, this.data, 2)
    }
    if (this.visitsTimer && this.visitList) {
      clearTimeout(this.visitsTimer)
      writeJsonQuietly(this.visitsFile, { visits: this.visitList })
    }
  }

  // ---------- bookmarks ----------
  bookmarks(): Bookmark[] {
    return this.data.bookmarks
  }
  setBookmarks(list: Bookmark[]): void {
    this.data.bookmarks = list
    this.save()
    this.emit('bookmarks', list)
  }

  // ---------- the history ----------
  /** The history by days — read when first needed (the older history: one opening per page, its last). */
  private visitsAll(): Visit[] {
    if (this.visitList) return this.visitList
    let list: Visit[] | undefined
    const d = readJsonFile<{ visits?: Visit[] }>(this.visitsFile)
    if (Array.isArray(d?.visits)) list = d.visits.filter((v) => v && typeof v.url === 'string' && typeof v.at === 'number')
    list ??= this.data.history.map((h) => ({ id: browserId(), url: h.url, title: h.title, at: h.last })).sort((a, b) => b.at - a.at)
    this.visitList = list
    this.trimVisits()
    return list
  }
  private trimVisits(): void {
    const l = this.visitList
    if (!l) return
    const old = Date.now() - VISITS_DAYS * 864e5
    let n = Math.min(l.length, MAX_VISITS)
    while (n > 0 && l[n - 1].at < old) n--
    l.length = n
  }
  private saveVisits(): void {
    clearTimeout(this.visitsTimer)
    this.visitsTimer = setTimeout(() => {
      if (this.visitList) writeJsonQuietly(this.visitsFile, { visits: this.visitList })
    }, 1500)
  }
  visits(): Visit[] {
    return this.visitsAll()
  }
  visitsDelete(what: string[] | { from: number; to: number }): void {
    const all = this.visitsAll()
    const gone = Array.isArray(what) ? new Set(what) : undefined
    const out = (v: Visit) => (gone ? gone.has(v.id) : !Array.isArray(what) && v.at >= what.from && v.at < what.to)
    const left = all.filter((v) => !out(v))
    const removed = all.filter(out)
    this.visitList = left
    // a page with no openings left goes from the suggestions too
    const still = new Set(left.map((v) => v.url))
    const urls = new Set(removed.map((v) => v.url).filter((u) => !still.has(u)))
    if (urls.size) this.data.history = this.data.history.filter((h) => !urls.has(h.url))
    for (const t of this.tabs()) if (t.visit && out(t.visit)) t.visit = undefined
    this.saveVisits()
    this.save()
    this.emit('history', null)
  }
  clearHistory(): void {
    this.data.history = []
    this.visitList = []
    for (const t of this.tabs()) t.visit = undefined
    this.saveVisits()
    // (the tabs closed are part of the history: forgotten with it)
    this.setClosed([])
    this.emit('history', null)
  }
  /** A page opened (`fresh` — a navigation, not its title coming): kept, unless the history is off. */
  visit(tab: Tab, url: string, title: string, fresh: boolean): void {
    if (!/^https?:/i.test(url) || !this.data.settings.history) return
    const list = this.visitsAll()
    const last = tab.visit
    // a new opening of the page (not its title coming, not the same page told again)
    const opened = fresh && !(last && last.url === url)
    if (opened) {
      tab.visit = { id: browserId(), url, title, at: Date.now() }
      list.unshift(tab.visit)
      if (list.length > MAX_VISITS + 500) this.trimVisits()
      this.saveVisits()
    } else if (last && last.url === url && title && last.title !== title) {
      last.title = title
      this.saveVisits()
    }
    const h = this.data.history
    const i = h.findIndex((x) => x.url === url)
    if (i >= 0) {
      const [x] = h.splice(i, 1)
      h.unshift({ ...x, title: title || x.title, last: Date.now(), count: x.count + (opened ? 1 : 0) })
    } else h.unshift({ url, title, last: Date.now(), count: 1 })
    if (h.length > MAX_HISTORY) h.length = MAX_HISTORY
    this.save()
  }
  /** The address line's suggestions: bookmarks and history matching the words. */
  suggest(q: string): Array<{ url: string; title: string; bookmark: boolean }> {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (s: string) => words.every((w) => s.toLowerCase().includes(w))
    const out: Array<{ url: string; title: string; bookmark: boolean }> = []
    const walk = (list: Bookmark[]) => {
      for (const b of list) {
        if (b.url && hit(`${b.title} ${b.url}`)) out.push({ url: b.url, title: b.title, bookmark: true })
        if (b.children) walk(b.children)
      }
    }
    walk(this.data.bookmarks)
    for (const h of [...this.data.history].sort((a, b) => b.count - a.count || b.last - a.last)) {
      if (out.length >= 10) break
      if (hit(`${h.title} ${h.url}`) && !out.some((x) => x.url === h.url)) out.push({ url: h.url, title: h.title, bookmark: false })
    }
    return out.slice(0, 10)
  }
}
