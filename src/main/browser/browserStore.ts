import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserId, DEFAULT_BROWSER_SETTINGS, type Bookmark, type BrowserSettings, type HistoryItem, type Visit } from '../../shared/browser'
import type { Tab } from './tab'

const MAX_HISTORY = 3000
/** The history by days: the last 90 days, at most this many openings. */
const MAX_VISITS = 30000
const VISITS_DAYS = 90

type BrowserData = { bookmarks: Bookmark[]; history: HistoryItem[]; settings: BrowserSettings }

/** The settings as written (anything missing or wrong — the default). */
function readSettings(st: Partial<BrowserSettings>): BrowserSettings {
  return {
    history: typeof st.history === 'boolean' ? st.history : DEFAULT_BROWSER_SETTINGS.history,
    ua: typeof st.ua === 'string' ? st.ua : DEFAULT_BROWSER_SETTINGS.ua,
    acceptBadCerts: typeof st.acceptBadCerts === 'boolean' ? st.acceptBadCerts : DEFAULT_BROWSER_SETTINGS.acceptBadCerts,
    sleepMin: typeof st.sleepMin === 'number' && st.sleepMin >= 0 ? Math.min(240, Math.round(st.sleepMin)) : DEFAULT_BROWSER_SETTINGS.sleepMin,
  }
}

/**
 * The browser's own data on disk: bookmarks, the pages opened (for the address line's suggestions) and the settings
 * in data/browser.json; every opening by days in data/browser-history.json (read when first needed). Written a moment
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
    private emit: (type: string, payload: unknown) => void,
  ) {
    this.file = join(root, 'browser.json')
    this.visitsFile = join(root, 'browser-history.json')
    this.data = this.read()
  }
  get settings(): BrowserSettings {
    return this.data.settings
  }
  private read(): BrowserData {
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<{ bookmarks: Bookmark[]; history: HistoryItem[]; settings: Partial<BrowserSettings> }>
      return {
        bookmarks: Array.isArray(d.bookmarks) ? d.bookmarks : [],
        history: Array.isArray(d.history) ? d.history : [],
        settings: readSettings(d.settings ?? {}),
      }
    } catch {
      return { bookmarks: [], history: [], settings: { ...DEFAULT_BROWSER_SETTINGS } }
    }
  }
  save(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      renameSync(tmp, this.file)
    }, 500)
  }
  /** What waits to be written goes now (the app quits). */
  flush(): void {
    try {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer)
        writeFileSync(this.file, JSON.stringify(this.data, null, 2))
      }
      if (this.visitsTimer && this.visitList) {
        clearTimeout(this.visitsTimer)
        writeFileSync(this.visitsFile, JSON.stringify({ visits: this.visitList }))
      }
    } catch {
      // the disk refused — nothing more to do on the way out
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
    try {
      const d = JSON.parse(readFileSync(this.visitsFile, 'utf8')) as { visits?: Visit[] }
      if (Array.isArray(d.visits)) list = d.visits.filter((v) => v && typeof v.url === 'string' && typeof v.at === 'number')
    } catch {
      // none yet
    }
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
      if (!this.visitList) return
      const tmp = `${this.visitsFile}.tmp`
      writeFileSync(tmp, JSON.stringify({ visits: this.visitList }))
      renameSync(tmp, this.visitsFile)
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
    this.save()
    this.emit('history', null)
  }
  /** A page opened (`fresh` — a navigation, not its title coming): kept, unless the history is off. */
  visit(tab: Tab, url: string, title: string, fresh: boolean): void {
    if (!/^https?:/i.test(url) || !this.data.settings.history) return
    const list = this.visitsAll()
    const last = tab.visit
    if (fresh && !(last && last.url === url)) {
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
      h.unshift({ ...x, title: title || x.title, last: Date.now(), count: x.count + (title === x.title ? 0 : 1) })
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
