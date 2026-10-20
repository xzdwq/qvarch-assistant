import { app, clipboard, dialog, ipcMain, Menu, safeStorage, session, shell, WebContentsView, type BrowserWindow, type MenuItemConstructorOptions, type Session, type WebContents } from 'electron'
import { createHash, X509Certificate } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { SOURCE_SCHEME, sourcePage } from './viewSource'
import { Hooks } from './hooks'
import type { BrowserHook, HookHit, HookStatus } from '../shared/hooks'
import { browserId, DEFAULT_BROWSER_SETTINGS, type PwRecState, type Bookmark, type BrowserSettings, type BrowserTab, type DeviceMode, type HistoryItem, type Visit, type CertInfo, type PasswordInfo, type RecFull, type RecItem, type RecState } from '../shared/browser'

/**
 * The Браузер section's pages: each tab a WebContentsView of its own over the main window (the renderer reports
 * where each visible one goes — the rest are hidden), one persistent profile apart from the app, bookmarks and
 * history in data/browser.json. The recording listens to the pages over the Chrome DevTools protocol: only XHR /
 * fetch (and, if asked, the documents), with the real headers (cookies too), the body and the answer.
 */
const PARTITION = 'persist:qa-browser'
const MAX_REC = 3000
const MAX_BODY = 1024 * 1024
/** All the answers' texts kept, at most — the oldest lose theirs first. */
const MAX_BODIES = 150 * 1024 * 1024
const MAX_HISTORY = 3000
/** The history by days: the last 90 days, at most this many openings. */
const MAX_VISITS = 30000
const VISITS_DAYS = 90

interface Tab {
  t: BrowserTab
  view: WebContentsView
  /** Recording: the protocol is attached. */
  rec: boolean
  /** The developer tools, docked under the page (a view of their own). */
  dev?: WebContentsView
  /** The rulers over the page: on, and the guides pulled out of them (px from the left / the top). */
  ruler: { on: boolean; v: number[]; h: number[] }
  /** Who keeps the protocol attached (the recording, the device mode, a hook's search). */
  dbg: Set<'rec' | 'device' | 'hook'>
  /** A hook's search: the page's requests so far (id → what it is). */
  hookReq?: Map<string, { url: string; method: string; type?: string; mime?: string; status?: number }>
  /** The page's own HTML (its request): Chromium tells no «loadingFinished» for it — taken when the page has loaded. */
  hookDoc?: string
  /** The device mode's scale as last told to the page. */
  devScale?: number
  /** This tab's last visit (its title comes later). */
  visit?: Visit
  /** Its page unloaded (the view closed) — made again when it is shown. */
  asleep?: boolean
  /** When it was last on the screen. */
  seen: number
}
interface Saved {
  id: string
  origin: string
  username: string
  password: string
  saved: number
  used?: number
}
interface Pending {
  item: RecFull
  started: number
  hasPostData?: boolean
}
type Box = { x: number; y: number; w: number; h: number }
type Rect = Box & { id: string; dev?: Box; scale?: number }

export class Browser {
  private tabs = new Map<string, Tab>()
  private win: BrowserWindow | undefined
  private ses: Session
  private file: string
  private data: { bookmarks: Bookmark[]; history: HistoryItem[]; settings: BrowserSettings }
  private visitsFile: string
  private visitList: Visit[] | undefined
  private visitsTimer?: NodeJS.Timeout
  private uaDefault: string
  private saveTimer?: NodeJS.Timeout
  private shown = new Set<string>()
  private covered = false
  private lastRects: Rect[] = []
  private certs = new Map<string, { pem: string; result: string; chain: string[] }>()
  /** Hosts whose bad certificate the user accepted (this run only). */
  private trusted = new Set<string>()
  private logins = new Map<string, (u?: string, p?: string) => void>()
  // the recording
  private recOn = false
  private recDocs = false
  private recItems: RecFull[] = []
  private pending = new Map<string, Pending>()
  /** The real headers that came before their request. */
  private extras = new Map<string, Array<[string, string]>>()
  private seq = 0
  private bodyBytes = 0
  private recTimer?: NodeJS.Timeout
  /** A Playwright scenario being recorded (one at a time). */
  private pwRec?: { note: string; key: string; tabId: string; url: string; lines: string[]; stopping?: boolean; at?: string }
  readonly hooks: Hooks

  constructor(
    root: string,
    private emit: (type: string, payload: unknown) => void,
  ) {
    this.file = join(root, 'browser.json')
    this.visitsFile = join(root, 'browser-history.json')
    this.data = this.read()
    this.pwInit(root)
    this.rulerInit()
    this.pwRecInit()
    this.hooks = new Hooks(root, join(__dirname, 'hookWorker.js'), (type, payload) => {
      this.emit(type, payload)
      // a hook changed / the search paused or not: the pages follow
      if (type === 'hooks' || type === 'hookPaused') for (const t of this.tabs.values()) this.hookSync(t)
    })
    this.ses = session.fromPartition(PARTITION)
    // a browser's User-Agent (not "Electron" / the app — some sites refuse those)
    this.uaDefault = this.ses.getUserAgent().replace(/\s+Electron\/\S+/i, '').replace(/\s+qvarch[-\w]*\/\S+/i, '')
    this.ses.setUserAgent(this.data.settings.ua || this.uaDefault)
    // each site's certificate as Chromium checked it — kept to show it (the check itself stays Chromium's: -3)
    this.ses.setCertificateVerifyProc((req, cb) => {
      const chain: string[] = []
      for (let c = req.certificate.issuerCert; c && chain.length < 6; c = c.issuerCert) chain.push(c.subject?.commonName || c.subjectName)
      this.certs.delete(req.hostname)
      this.certs.set(req.hostname, { pem: req.certificate.data, result: req.verificationResult, chain })
      if (this.certs.size > 300) this.certs.delete(this.certs.keys().next().value!)
      cb(-3)
    })
    // «Просмотр кода страницы»: our own viewer (qa-source:<address>), fetched with the site's cookies
    this.ses.protocol.handle(SOURCE_SCHEME, (req) => sourcePage(req.url.slice(SOURCE_SCHEME.length + 1), (u) => this.ses.fetch(u)))
    // the corporate sign-in (Windows auth) works as in Chrome
    this.ses.allowNTLMCredentialsForDomains('*')
    this.ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-sanitized-write', 'clipboard-read', 'notifications', 'media'].includes(perm)))
    this.ses.on('will-download', (_e, item) => {
      const dir = app.getPath('downloads')
      const name = item.getFilename() || 'download'
      let path = join(dir, name)
      for (let n = 1; existsSync(path); n++) path = join(dir, `${basename(name, extname(name))} (${n})${extname(name)}`)
      item.setSavePath(path)
      this.emit('download', { name: basename(path), path, state: 'progress' })
      item.once('done', (_ev, state) => this.emit('download', { name: basename(path), path, state }))
    })
    app.on('certificate-error', (e, wc, url, error, _cert, cb, isMainFrame) => {
      const tab = this.byContents(wc)
      if (!tab) return
      const host = safeHost(url)
      e.preventDefault()
      if (this.trusted.has(host)) return cb(true)
      // the setting: internal sites with their own / expired certificates open (the lock shows it red)
      if (this.data.settings.acceptBadCerts) {
        this.trusted.add(host)
        return cb(true)
      }
      cb(false)
      // a part of the page (a counter, an ad, a picture) is simply not loaded — the page stays
      if (!isMainFrame) return
      tab.t.error = { code: -200, desc: error, url, cert: true, host }
      this.changed()
    })
    // the tabs not looked at for a while fall asleep (each page is a process of its own: memory)
    setInterval(() => this.sleepIdle(), 60_000)
  }

  // ---------- the window ----------
  /** The main window (made again after it was closed for good): every page goes into it. */
  attach(win: BrowserWindow): void {
    if (this.win === win) return
    this.win = win
    for (const t of this.tabs.values()) {
      if (t.asleep) continue
      win.contentView.addChildView(t.view)
      t.view.setVisible(false)
      if (t.dev) {
        win.contentView.addChildView(t.dev)
        t.dev.setVisible(false)
      }
    }
    this.shown.clear()
  }
  /** Where the visible pages go (the renderer's rectangles); every other page hides. */
  layout(rects: Rect[]): void {
    this.lastRects = rects
    if (this.covered) return
    const want = new Set(rects.map((r) => r.id))
    const put = (v: WebContentsView, b: Box) => v.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h) })
    for (const [id, t] of this.tabs) {
      const r = rects.find((x) => x.id === id)
      if (r && r.w > 1 && r.h > 1) {
        t.seen = Date.now()
        if (t.asleep) this.wake(t)
        put(t.view, r)
        // the device mode: the page drawn smaller to fit the pane
        if (t.t.device && r.scale && r.scale !== t.devScale) {
          t.devScale = r.scale
          void this.deviceApply(t, true)
        }
        if (!this.shown.has(id)) t.view.setVisible(true)
      } else if (this.shown.has(id) && !t.asleep) t.view.setVisible(false)
      if (t.dev) {
        if (r?.dev && r.dev.w > 1 && r.dev.h > 1) {
          put(t.dev, r.dev)
          t.dev.setVisible(true)
        } else t.dev.setVisible(false)
      }
    }
    this.shown = new Set([...want].filter((id) => this.tabs.has(id)))
  }
  /**
   * Something of the app opens over the pages (a menu, a dialog): the pages hide — the renderer shows their
   * pictures in their place meanwhile — and come back after.
   */
  async cover(on: boolean): Promise<Record<string, string>> {
    if (on === this.covered) return {}
    const shots: Record<string, string> = {}
    if (on) {
      for (const id of this.shown) {
        const t = this.tabs.get(id)
        if (!t) continue
        try {
          let img = await t.view.webContents.capturePage()
          // the device mode: the picture is the device's whole size, the page drawn smaller in its corner
          if (t.t.device && t.devScale && t.devScale < 1) {
            const sz = img.getSize()
            img = img.crop({ x: 0, y: 0, width: Math.max(1, Math.round(sz.width * t.devScale)), height: Math.max(1, Math.round(sz.height * t.devScale)) })
          }
          shots[id] = img.toJPEG(82).toString('base64')
          if (t.dev?.getVisible()) shots[`${id}:dev`] = (await t.dev.webContents.capturePage()).toJPEG(82).toString('base64')
        } catch {
          // not drawn yet
        }
      }
      this.covered = true
      for (const id of this.shown) {
        this.tabs.get(id)?.view.setVisible(false)
        this.tabs.get(id)?.dev?.setVisible(false)
      }
    } else {
      this.covered = false
      for (const id of this.shown) this.tabs.get(id)?.view.setVisible(true)
      this.layout(this.lastRects)
    }
    return shots
  }

  // ---------- tabs ----------
  list(): BrowserTab[] {
    return [...this.tabs.values()].map((t) => t.t)
  }
  private makeView(): WebContentsView {
    // the preload only sees sign-in forms (to offer saving / filling a password) — the page cannot reach it
    const view = new WebContentsView({ webPreferences: { session: this.ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, preload: join(__dirname, '../preload/browser.js') } })
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    return view
  }
  // ---------- tabs asleep ----------
  /** Tabs not shown for the set minutes fall asleep — not one recording, with the tools open, as a device, loading or playing sound. */
  private sleepIdle(): void {
    const min = this.data.settings.sleepMin
    if (!min || this.recOn) return
    const old = Date.now() - min * 60_000
    for (const [id, t] of this.tabs) {
      if (t.asleep || this.shown.has(id) || t.seen > old || t.dev || t.t.device || t.t.loading || t.rec) continue
      try {
        if (t.view.webContents.isCurrentlyAudible() || /^about:blank$/.test(t.t.url)) continue
        this.win?.contentView.removeChildView(t.view)
        t.view.webContents.close()
      } catch {
        // gone already
      }
      t.asleep = true
      t.t.asleep = true
      t.t.loading = false
    }
    this.changed()
  }
  /** A tab asleep made again: its page loads at the address it had (the zoom kept). */
  private wake(t: Tab): void {
    if (!t.asleep) return
    t.view = this.makeView()
    t.asleep = false
    t.t.asleep = false
    t.dbg = new Set()
    t.rec = false
    this.win?.contentView.addChildView(t.view)
    this.wire(t)
    if (this.recOn) void this.recAttach(t)
    t.view.webContents.setZoomFactor((t.t.zoom || 100) / 100)
    const ua = this.data.settings.ua
    if (ua) t.view.webContents.setUserAgent(ua)
    void t.view.webContents.loadURL(t.t.url).catch(() => undefined)
    this.changed()
  }
  // ---------- recording a Playwright scenario ----------
  private pwRecInit(): void {
    // a page of the recording tab (each new one asks): recording or not, how many lines so far
    ipcMain.handle('qa:pwrec-get', (e) => {
      const t = this.byContents(e.sender)
      return t && this.pwRec?.tabId === t.t.id ? { on: true, count: this.pwRec.lines.length } : null
    })
    ipcMain.on('qa:pwrec-act', (e, a: { code?: unknown; replace?: unknown }) => {
      const t = this.byContents(e.sender)
      const r = this.pwRec
      if (!t || !r || r.tabId !== t.t.id || typeof a?.code !== 'string' || a.code.length > 2000) return
      // a double click: the clicks it was made of go
      if (typeof a.replace === 'string') for (let i = 0; i < 2 && r.lines[r.lines.length - 1] === a.replace; i++) r.lines.pop()
      // the same line twice in a row (a click caught twice) — once
      else if (r.lines[r.lines.length - 1] === a.code) return
      r.lines.push(a.code)
      r.at ??= t.view.webContents.getURL()
      this.emit('pwrec', this.pwRecState())
    })
  }
  pwRecState(): PwRecState | undefined {
    const r = this.pwRec
    return r ? { note: r.note, key: r.key, tabId: r.tabId, count: r.lines.length, last: r.lines[r.lines.length - 1] } : undefined
  }
  pwRecStart(note: string, key: string, url: string): BrowserTab {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('Адрес должен начинаться с http:// или https://')
    if (this.pwRec) void this.pwRecStop(true)
    // the recording tab is the one shown — the clicks go there: a tab at this very address already (as it is
    // now, not reloaded), else a new one
    const same = (a: string) => a.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
    const open = [...this.tabs.values()].find((x) => same(x.asleep ? x.t.url : x.view.webContents.getURL() || x.t.url) === same(url))
    let t: BrowserTab
    if (open) {
      this.wake(open)
      t = open.t
      this.emit('activate', { id: t.id })
    } else t = this.open(url)
    this.pwRec = { note: String(note), key: String(key), tabId: t.id, url, lines: [`await page.goto('${url.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`] }
    // a page already loaded asks no more: it is told
    if (open && !open.asleep && !open.view.webContents.isLoading()) open.view.webContents.send('qa:pwrec', true)
    this.emit('pwrec', this.pwRecState())
    return t
  }
  async pwRecStop(cancel = false): Promise<{ note: string; key: string; url: string; lines: string[] } | undefined> {
    const r = this.pwRec
    if (!r || r.stopping) return undefined
    const t = this.tabs.get(r.tabId)
    // the page writes down what it has not yet (typing, a click still being looked at) — a moment for it
    if (!cancel && t && !t.asleep) {
      r.stopping = true
      t.view.webContents.send('qa:pwrec-flush')
      await new Promise((ok) => setTimeout(ok, 800))
    }
    this.pwRec = undefined
    if (t && !t.asleep) t.view.webContents.send('qa:pwrec', false)
    this.emit('pwrec', undefined)
    return cancel ? undefined : { note: r.note, key: r.key, url: r.url, lines: r.lines }
  }
  /** The recording tab went to another address after an action: the scenario waits for it there too. */
  private pwRecNav(tab: Tab, url: string): void {
    const r = this.pwRec
    if (!r || r.tabId !== tab.t.id || r.stopping || !/^https?:/i.test(url)) return
    const last = r.lines[r.lines.length - 1] ?? ''
    // after a goto (its redirects, a sign-in) — nothing; after a click / typing — a wait
    if (!/\.(click|dblclick|press|fill|check|uncheck|selectOption)\(/.test(last)) return
    const prev = r.at ?? r.url
    r.at = url
    let u: URL
    let p: URL
    try {
      u = new URL(url)
      p = new URL(prev)
    } catch {
      return
    }
    if (u.href === p.href) return
    const esc = (x: string) => x.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    // the path changed — waited for by it; the same path, other parameters (a card of a list) — by the whole address
    if (u.pathname !== p.pathname && u.pathname !== '/') r.lines.push(`await page.waitForURL('**${esc(u.pathname)}**')`)
    else r.lines.push(`await page.waitForURL((url) => url.href.includes('${esc(u.pathname + u.search + u.hash)}'))`)
    this.emit('pwrec', this.pwRecState())
  }

/** A tab opened by the app itself (a recording, a link, a trace): made the shown one of its pane. */
  open(url: string): BrowserTab {
    const t = this.create(url)
    this.emit('activate', { id: t.id })
    return t
  }
  create(url = 'about:blank', opener?: string): BrowserTab {
    const id = browserId()
    const view = this.makeView()
    const tab: Tab = { t: { id, url, title: url === 'about:blank' ? 'Новая вкладка' : url, loading: false, canBack: false, canFwd: false, zoom: 100 }, view, rec: false, ruler: { on: false, v: [], h: [] }, dbg: new Set(), seen: Date.now() }
    this.tabs.set(id, tab)
    this.win?.contentView.addChildView(view)
    this.wire(tab)
    if (this.recOn) void this.recAttach(tab)
    this.hookSync(tab, url)
    if (url !== 'about:blank') void view.webContents.loadURL(url).catch(() => undefined)
    this.changed()
    if (opener) this.emit('opened', { id, opener })
    return tab.t
  }
  close(id: string): void {
    const t = this.tabs.get(id)
    if (!t) return
    // the recording tab closed: the recording stays (stopped from the bar) — its lines are kept
    this.tabs.delete(id)
    this.shown.delete(id)
    this.devClose(t)
    try {
      if (!t.asleep) {
        this.win?.contentView.removeChildView(t.view)
        t.view.webContents.close()
      }
    } catch {
      // already gone
    }
    this.changed()
  }
  go(id: string, url0: string): void {
    const t = this.tabs.get(id)
    if (!t) return
    this.wake(t)
    // view-source: typed — our source viewer
    const url = url0.replace(/^view-source:/i, `${SOURCE_SCHEME}:`)
    t.t.error = undefined
    t.t.url = url
    // an address typed in the recording tab: a line of its own
    if (this.pwRec?.tabId === id && /^https?:/i.test(url)) {
      this.pwRec.lines.push(`await page.goto('${url.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`)
      this.emit('pwrec', this.pwRecState())
    }
    void t.view.webContents.loadURL(url).catch(() => undefined)
    this.changed()
  }
  nav(id: string, action: 'back' | 'fwd' | 'reload' | 'hard' | 'stop' | 'devtools'): void {
    const t = this.tabs.get(id)
    if (!t) return
    this.wake(t)
    const wc = t.view.webContents
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (action === 'fwd' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (action === 'reload') {
      t.t.error = undefined
      wc.reload()
    } else if (action === 'hard') wc.reloadIgnoringCache()
    else if (action === 'stop') wc.stop()
    else if (action === 'devtools') this.devToggle(t)
  }
  zoom(id: string, percent: number): void {
    const t = this.tabs.get(id)
    if (!t) return
    this.wake(t)
    const p = Math.min(300, Math.max(25, Math.round(percent)))
    t.view.webContents.setZoomFactor(p / 100)
    t.t.zoom = p
    this.changed()
  }
  /** A bad certificate accepted: this host opens (until the app quits). */
  trust(id: string, host: string): void {
    this.trusted.add(host)
    this.nav(id, 'reload')
  }
  loginReply(reqId: string, user?: string, pass?: string): void {
    const cb = this.logins.get(reqId)
    this.logins.delete(reqId)
    cb?.(user, pass)
  }
  // ---------- the developer tools, docked under the page ----------
  private devOpen(t: Tab): void {
    if (t.dev) return
    const dev = new WebContentsView()
    dev.setVisible(false)
    t.dev = dev
    this.win?.contentView.addChildView(dev)
    const wc = t.view.webContents
    // the tools draw into our view (the window's own docking does not exist for a view)
    dev.webContents.on('zoom-changed', (_e, dir) => {
      const z = dev.webContents.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5)
      dev.webContents.setZoomLevel(Math.min(4, Math.max(-3, z)))
    })
    // Ctrl+Shift+M in the tools: our device mode (theirs has no place in a docked view)
    dev.webContents.on('before-input-event', (e, i) => {
      if (i.type === 'keyDown' && (i.control || i.meta) && i.shift && i.key.toLowerCase() === 'm') {
        e.preventDefault()
        this.emit('key', { id: t.t.id, key: 'device' })
      }
    })
    wc.setDevToolsWebContents(dev.webContents)
    wc.openDevTools({ mode: 'detach', activate: false })
    wc.once('devtools-closed', () => this.devClose(t))
    t.t.devtools = true
    this.changed()
  }
  private devClose(t: Tab): void {
    const dev = t.dev
    if (!dev) return
    t.dev = undefined
    t.t.devtools = false
    try {
      if (t.view.webContents.isDevToolsOpened()) t.view.webContents.closeDevTools()
    } catch {
      // the page is gone
    }
    try {
      this.win?.contentView.removeChildView(dev)
      dev.webContents.close()
    } catch {
      // gone
    }
    this.changed()
  }
  private devToggle(t: Tab): void {
    if (t.dev) this.devClose(t)
    else this.devOpen(t)
  }
  /** Everything the site keeps (cache, cookies, storage, service workers) dropped, then a reload without the cache. */
  async resetSite(id: string): Promise<void> {
    const t = this.tabs.get(id)
    if (!t) return
    this.wake(t)
    let origin = ''
    try {
      origin = new URL(t.view.webContents.getURL() || t.t.url).origin
    } catch {
      return
    }
    if (!/^https?:/.test(origin)) return
    try {
      await this.ses.clearData({ origins: [origin] })
    } catch {
      await this.ses.clearStorageData({ origin })
      await this.ses.clearCache()
    }
    t.t.error = undefined
    t.view.webContents.reloadIgnoringCache()
  }

  // ---------- saved passwords (encrypted by Windows, this user only) ----------
  private pwFile = ''
  private pw: { list: Saved[]; never: string[] } = { list: [], never: [] }
  private pwAsks = new Map<string, { origin: string; username: string; password: string }>()
  private pwLast = ''
  private pwInit(root: string): void {
    this.pwFile = join(root, 'browser-passwords.bin')
    try {
      if (existsSync(this.pwFile) && safeStorage.isEncryptionAvailable()) this.pw = JSON.parse(safeStorage.decryptString(readFileSync(this.pwFile))) as typeof this.pw
    } catch {
      this.pw = { list: [], never: [] }
    }
    // a page's sign-in form was sent: offer to keep it (the origin is the page's own, never what it says)
    ipcMain.on('qa:bpw-submit', (e, c: { username?: string; password?: string }) => {
      const t = this.byContents(e.sender)
      const origin = originOf(e.sender.getURL())
      const password = String(c?.password ?? '')
      const username = String(c?.username ?? '').slice(0, 200)
      if (!t || !origin || !password || password.length > 500 || this.pw.never.includes(origin)) return
      // the same form sent twice (submit + click) — once
      const key = `${origin}|${username}|${password}`
      if (key === this.pwLast) return
      this.pwLast = key
      const has = this.pw.list.find((x) => x.origin === origin && x.username === username)
      if (has?.password === password) return
      const askId = browserId()
      this.pwAsks.set(askId, { origin, username, password })
      this.emit('pwAsk', { askId, origin, username, update: !!has })
    })
    // a sign-in form on a page: its saved login, if any (the newest used)
    ipcMain.handle('qa:bpw-get', (e) => {
      if (!this.byContents(e.sender)) return null
      const origin = originOf(e.sender.getURL())
      const hit = this.pw.list.filter((x) => x.origin === origin).sort((a, b) => (b.used ?? b.saved) - (a.used ?? a.saved))[0]
      if (!hit) return null
      hit.used = Date.now()
      return { username: hit.username, password: hit.password }
    })
  }
  private pwSave(): void {
    if (!safeStorage.isEncryptionAvailable()) return
    const tmp = `${this.pwFile}.tmp`
    writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(this.pw)))
    renameSync(tmp, this.pwFile)
    this.emit('passwords', this.passwords())
  }
  /** The saved logins — without the passwords (those come one by one: pwReveal). */
  passwords(): PasswordInfo[] {
    return this.pw.list.map((x) => ({ id: x.id, origin: x.origin, username: x.username, saved: x.saved, used: x.used }))
  }
  pwAnswer(askId: string, answer: 'save' | 'no' | 'never'): void {
    const a = this.pwAsks.get(askId)
    this.pwAsks.delete(askId)
    if (!a || answer === 'no') return
    if (answer === 'never') {
      if (!this.pw.never.includes(a.origin)) this.pw.never.push(a.origin)
    } else {
      const has = this.pw.list.find((x) => x.origin === a.origin && x.username === a.username)
      if (has) Object.assign(has, { password: a.password, saved: Date.now() })
      else this.pw.list.push({ id: browserId(), ...a, saved: Date.now() })
    }
    this.pwSave()
  }
  pwReveal(id: string): string {
    return this.pw.list.find((x) => x.id === id)?.password ?? ''
  }
  pwDelete(id: string): void {
    this.pw.list = this.pw.list.filter((x) => x.id !== id)
    this.pwSave()
  }
  /** A saved login typed into the tab's sign-in form (the page must be that site). */
  pwFill(tabId: string, id: string): void {
    const t = this.tabs.get(tabId)
    const s = this.pw.list.find((x) => x.id === id)
    if (!t || !s || originOf(t.view.webContents.getURL()) !== s.origin) return
    s.used = Date.now()
    t.view.webContents.send('qa:bpw-fill', { username: s.username, password: s.password })
  }
  neverList(): string[] {
    return this.pw.never
  }
  neverRemove(origin: string): void {
    this.pw.never = this.pw.never.filter((x) => x !== origin)
    this.pwSave()
  }

  /** The site's connection: plain http, or its certificate (who, by whom, until when, fingerprints). */
  certInfo(id: string): CertInfo | undefined {
    const t = this.tabs.get(id)
    let u: URL
    try {
      u = new URL(t?.view.webContents.getURL() || t?.t.url || '')
    } catch {
      return undefined
    }
    if (u.protocol === 'http:') return { host: u.host, secure: false }
    if (u.protocol !== 'https:') return undefined
    const c = this.certs.get(u.hostname)
    if (!c) return { host: u.host, secure: true, trusted: this.trusted.has(u.host) }
    const names = (s: string) => Object.fromEntries(s.split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]))
    try {
      const x = new X509Certificate(c.pem)
      return {
        host: u.host,
        secure: true,
        ok: c.result === 'net::OK',
        result: c.result,
        trusted: this.trusted.has(u.host),
        subject: names(x.subject),
        issuer: names(x.issuer),
        validFrom: Date.parse(x.validFrom),
        validTo: Date.parse(x.validTo),
        san: (x.subjectAltName ?? '').split(/,\s*/).map((s) => s.replace(/^DNS:/, '')).filter(Boolean).slice(0, 30),
        serial: x.serialNumber,
        sha256: createHash('sha256').update(x.raw).digest('hex'),
        keySha256: createHash('sha256').update(x.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
        chain: c.chain,
      }
    } catch {
      return { host: u.host, secure: true, result: c.result }
    }
  }

  // ---------- rulers over the page (drawn by the page's preload, kept here across navigations) ----------
  private rulerInit(): void {
    ipcMain.handle('qa:ruler-get', (e) => this.byContents(e.sender)?.ruler ?? null)
    ipcMain.on('qa:ruler-set', (e, g: { v?: number[]; h?: number[]; on?: boolean }) => {
      const t = this.byContents(e.sender)
      if (!t) return
      const clean = (a: unknown) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isFinite(n)).slice(0, 100) : [])
      t.ruler = { on: g.on ?? t.ruler.on, v: clean(g.v), h: clean(g.h) }
      t.t.ruler = t.ruler.on
      this.changed()
    })
  }
  ruler(id: string, on: boolean): void {
    const t = this.tabs.get(id)
    if (!t) return
    this.wake(t)
    t.ruler = { ...t.ruler, on }
    t.t.ruler = on
    t.view.webContents.send('qa:ruler', t.ruler)
    this.changed()
  }

  /**
   * The site's Swagger / OpenAPI description: what the page itself shows (Swagger UI, Redoc), else the usual
   * places on its server (Spring, NestJS, FastAPI, ASP.NET, Go…). Fetched with the site's cookies (as the page).
   */
  async swaggerFind(id: string): Promise<{ url: string; text: string } | { error: string; tried: string[] }> {
    const t = this.tabs.get(id)
    if (!t) return { error: 'Нет вкладки', tried: [] }
    this.wake(t)
    const page = t.view.webContents.getURL()
    let origin: string
    try {
      origin = new URL(page).origin
    } catch {
      return { error: 'Откройте сайт во вкладке', tried: [] }
    }
    if (!/^https?:/.test(origin)) return { error: 'Откройте сайт во вкладке', tried: [] }
    const tried: string[] = []
    const looks = (s: string) => /"(openapi|swagger)"\s*:\s*"/.test(s.slice(0, 4000)) || /^\s*(openapi|swagger)\s*:/m.test(s.slice(0, 4000))
    const get = async (url: string): Promise<string | undefined> => {
      tried.push(url)
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 7000)
        const r = await this.ses.fetch(url, { signal: ctl.signal, headers: { accept: 'application/json, application/yaml, text/yaml, */*' } })
        clearTimeout(timer)
        if (!r.ok) return undefined
        const text = await r.text()
        return text.length > 30 * 1024 * 1024 ? undefined : text
      } catch {
        return undefined
      }
    }
    // 1. the page and every frame in it (Swagger UI is often inside an iframe): Swagger UI knows its spec — the
    //    definition picked in «Select a definition» — or already holds it; Redoc names it
    const LOOK = `(() => {
      try {
        const ui = window.ui
        if (ui) {
          const sel = ui.specSelectors || {}
          const spec = sel.specJson && sel.specJson()
          const js = spec && spec.toJS ? spec.toJS() : null
          const c = ui.getConfigs ? ui.getConfigs() : {}
          const cur = (sel.url && sel.url()) || c.url || null
          const named = c.urls && (c.urls.find((u) => u.name === c['urls.primaryName']) || c.urls[0])
          return { spec: js && (js.openapi || js.swagger) ? JSON.stringify(js) : null, url: cur || (named && named.url) || null, here: location.href }
        }
      } catch (e) {}
      const r = document.querySelector('redoc[spec-url]')
      return { spec: null, url: r ? r.getAttribute('spec-url') : null, here: location.href, scripts: [...document.scripts].map((s) => s.src).filter(Boolean) }
    })()`
    type Found = { spec: string | null; url: string | null; here: string; scripts?: string[] }
    const frames = [t.view.webContents.mainFrame, ...t.view.webContents.mainFrame.framesInSubtree.filter((f) => f !== t.view.webContents.mainFrame)]
    const scripts: Array<{ src: string; base: string }> = []
    for (const frame of frames) {
      let found: Found | undefined
      try {
        found = (await frame.executeJavaScript(LOOK, true)) as Found
      } catch {
        continue
      }
      if (!found) continue
      if (found.spec) return { url: found.url ? new URL(found.url, found.here).href : found.here, text: found.spec }
      if (found.url) {
        const u = new URL(found.url, found.here).href
        const text = await get(u)
        if (text && looks(text)) return { url: u, text }
      }
      for (const s of found.scripts ?? []) if (/swagger|initializer/i.test(s)) scripts.push({ src: s, base: found.here })
    }
    // a swagger-initializer.js names it
    for (const s of scripts.slice(0, 4)) {
      const js = await get(s.src)
      const m = js?.match(/url\s*:\s*["'`]([^"'`]+)["'`]/)
      if (m) {
        const u = new URL(m[1], s.base).href
        const text = await get(u)
        if (text && looks(text)) return { url: u, text }
      }
    }
    // 2. the usual places: near the page, then from the root
    const path = new URL(page).pathname.replace(/\/+$/, '')
    const near = path && path !== '/' ? [`${path}-json`, `${path}/swagger.json`, `${path}/openapi.json`, `${path}/v3/api-docs`, `${path.replace(/\/[^/]*$/, '')}/swagger.json`] : []
    const roots = ['/v3/api-docs', '/v2/api-docs', '/openapi.json', '/swagger.json', '/swagger/v1/swagger.json', '/api-json', '/api-docs', '/api-docs.json', '/api/swagger.json', '/api/openapi.json', '/api/v1/swagger.json', '/api/v1/openapi.json', '/api/v3/api-docs', '/swagger/doc.json', '/docs/openapi.json', '/openapi.yaml', '/swagger.yaml', '/api/swagger/v1/swagger.json']
    for (const p of [...new Set([...near, ...roots])]) {
      const u = origin + p
      const text = await get(u)
      if (text && looks(text)) return { url: u, text }
    }
    // Springfox: the list of its groups
    const res = await get(`${origin}/swagger-resources`)
    if (res) {
      try {
        const first = (JSON.parse(res) as Array<{ url?: string; location?: string }>)[0]
        const u = new URL(first?.url ?? first?.location ?? '', origin).href
        const text = await get(u)
        if (text && looks(text)) return { url: u, text }
      } catch {
        // not that
      }
    }
    return { error: 'Swagger / OpenAPI не найден', tried }
  }

  /** «Сохранить как…»: the page with its files (or one .mhtml), where the user says. */
  async savePage(id: string): Promise<void> {
    const t = this.tabs.get(id)
    if (!t || !this.win) return
    this.wake(t)
    const wc = t.view.webContents
    const name = (wc.getTitle() || 'page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 100) || 'page'
    const r = await dialog.showSaveDialog(this.win, {
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
      this.emit('download', { name: basename(r.filePath), path: r.filePath, state: 'completed' })
    } catch {
      this.emit('download', { name: basename(r.filePath), path: r.filePath, state: 'interrupted' })
    }
  }
  /** «Просмотр кода страницы»: its source in a tab of its own. */
  viewSource(id: string): void {
    const url = this.tabs.get(id)?.view.webContents.getURL()
    if (url && /^(https?|file):/.test(url)) this.create(`${SOURCE_SCHEME}:${url}`, id)
  }

  reveal(path: string): void {
    if (existsSync(path)) shell.showItemInFolder(path)
  }
  closeAll(): void {
    for (const id of [...this.tabs.keys()]) this.close(id)
    // what waits to be written goes now (the app quits)
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

  private byContents(wc: WebContents): Tab | undefined {
    for (const t of this.tabs.values()) if (!t.asleep && t.view.webContents === wc) return t
    return undefined
  }
  private wire(tab: Tab): void {
    const wc = tab.view.webContents
    const t = tab.t
    const sync = () => {
      t.url = wc.getURL() || t.url
      t.canBack = wc.navigationHistory.canGoBack()
      t.canFwd = wc.navigationHistory.canGoForward()
      this.changed()
    }
    wc.on('did-start-loading', () => ((t.loading = true), this.changed()))
    wc.on('did-stop-loading', () => ((t.loading = false), sync()))
    wc.on('did-start-navigation', (d) => {
      // a hook's search listens from the start of the page (its HTML too)
      if (d.isMainFrame && !d.isSameDocument) this.hookSync(tab, d.url)
      if (d.isMainFrame && !d.isSameDocument) t.error = undefined
    })
    wc.on('dom-ready', () => this.hooks.apply(wc))
    // the page's HTML for a hook's search (no «loadingFinished» comes for it)
    wc.on('did-finish-load', () => {
      const id = tab.hookDoc
      tab.hookDoc = undefined
      if (id && tab.dbg.has('hook')) this.hookTake(tab, id)
    })
    // the recording tab: each page of it records (not only the one that asked), the address changes are waited for
    wc.on('dom-ready', () => this.pwRec?.tabId === t.id && !this.pwRec.stopping && wc.send('qa:pwrec', true))
    wc.on('did-navigate', (_e, url) => {
      this.pwRecNav(tab, url)
      this.hookSync(tab, url)
      t.url = url
      t.favicon = undefined
      // its title comes later (the old one is the previous page's)
      this.visit(tab, url, '', true)
      sync()
    })
    wc.on('did-navigate-in-page', (_e, url, isMain) => {
      if (!isMain) return
      this.pwRecNav(tab, url)
      t.url = url
      // a single-page site's own pages count as openings too
      this.visit(tab, url, t.title, true)
      sync()
    })
    wc.on('will-navigate', (e) => {
      if (e.url.startsWith('file:') && !wc.getURL().startsWith('file:') && !e.url.startsWith(SOURCE_SCHEME)) {
        e.preventDefault()
        this.create(e.url, t.id)
      }
    })
    wc.on('page-title-updated', (_e, title) => {
      t.title = title
      this.visit(tab, t.url, title, false)
      this.changed()
    })
    // the window's rules allow no remote pictures: the icon comes over as data (small ones only)
    wc.on('page-favicon-updated', (_e, icons) => {
      const src = icons[0]
      if (!src) return
      if (src.startsWith('data:')) return void ((t.favicon = src), this.changed())
      void this.ses
        .fetch(src)
        .then(async (r) => {
          if (!r.ok) return
          const buf = Buffer.from(await r.arrayBuffer())
          if (buf.length > 64 * 1024) return
          t.favicon = `data:${r.headers.get('content-type') || 'image/x-icon'};base64,${buf.toString('base64')}`
          this.changed()
        })
        .catch(() => undefined)
    })
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      // -3: a navigation cut off by another one — no error
      if (!isMain || code === -3 || t.error?.cert) return
      t.error = { code, desc, url }
      t.loading = false
      this.changed()
    })
    wc.on('zoom-changed', (_e, dir) => this.zoom(t.id, t.zoom + (dir === 'in' ? 10 : -10)))
    // window.open / target=_blank: a new tab next to this one
    wc.setWindowOpenHandler(({ url }) => {
      this.create(url, t.id)
      return { action: 'deny' }
    })
    wc.on('login', (e, _details, info, cb) => {
      e.preventDefault()
      const reqId = browserId()
      this.logins.set(reqId, (u, p) => (u === undefined ? cb() : cb(u, p ?? '')))
      this.emit('login', { reqId, tabId: t.id, host: info.host, realm: info.realm })
    })
    wc.on('before-input-event', (e, i) => {
      if (i.type !== 'keyDown') return
      const ctrl = i.control || i.meta
      const k = i.key.toLowerCase()
      const send = (key: string) => (e.preventDefault(), this.emit('key', { id: t.id, key }))
      // F5 / Ctrl+R — reload; Ctrl+F5 / Ctrl+Shift+R — without the cache
      if (i.key === 'F5' || (ctrl && k === 'r')) return e.preventDefault(), this.nav(t.id, (i.key === 'F5' && ctrl) || (k === 'r' && i.shift) ? 'hard' : 'reload')
      if (i.key === 'F12') return e.preventDefault(), this.nav(t.id, 'devtools')
      if (i.alt && i.key === 'ArrowLeft') return e.preventDefault(), this.nav(t.id, 'back')
      if (i.alt && i.key === 'ArrowRight') return e.preventDefault(), this.nav(t.id, 'fwd')
      if (ctrl && (k === '=' || k === '+')) return e.preventDefault(), this.zoom(t.id, t.zoom + 10)
      if (ctrl && k === '-') return e.preventDefault(), this.zoom(t.id, t.zoom - 10)
      if (ctrl && k === '0') return e.preventDefault(), this.zoom(t.id, 100)
      if (ctrl && k === 't') return send('newTab')
      if (ctrl && k === 'w') return send('closeTab')
      if (ctrl && k === 'l') return send('focusUrl')
      if (ctrl && k === 'd') return send('bookmark')
      if (ctrl && k === 's') return e.preventDefault(), void this.savePage(t.id)
      if (ctrl && k === 'u') return e.preventDefault(), this.viewSource(t.id)
      if (ctrl && k === 'p') return e.preventDefault(), wc.print()
      if (ctrl && i.shift && k === 'i') return e.preventDefault(), this.nav(t.id, 'devtools')
      if (ctrl && i.shift && k === 'm') return send('device')
      if (ctrl && k === 'h') return send('history')
    })
    wc.on('context-menu', (_e, p) => {
      const items: MenuItemConstructorOptions[] = []
      if (p.linkURL) {
        items.push({ label: 'Открыть в новой вкладке', click: () => this.create(p.linkURL, t.id) })
        items.push({ label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) })
        items.push({ type: 'separator' })
      }
      if (p.isEditable) {
        items.push({ label: 'Вырезать', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Копировать', role: 'copy', enabled: p.editFlags.canCopy }, { label: 'Вставить', role: 'paste', enabled: p.editFlags.canPaste }, { label: 'Выделить всё', role: 'selectAll' })
        items.push({ type: 'separator' })
      } else if (p.selectionText) {
        items.push({ label: 'Копировать', role: 'copy' }, { type: 'separator' })
      }
      if (p.srcURL && p.mediaType === 'image') items.push({ label: 'Открыть картинку в новой вкладке', click: () => this.create(p.srcURL, t.id) })
      if (p.srcURL && p.mediaType === 'image') items.push({ label: 'Сохранить картинку как…', click: () => wc.downloadURL(p.srcURL) }, { label: 'Копировать картинку', click: () => wc.copyImageAt(p.x, p.y) }, { type: 'separator' })
      items.push(
        { label: 'Назад', accelerator: 'Alt+Left', enabled: wc.navigationHistory.canGoBack(), click: () => this.nav(t.id, 'back') },
        { label: 'Вперёд', accelerator: 'Alt+Right', enabled: wc.navigationHistory.canGoForward(), click: () => this.nav(t.id, 'fwd') },
        { label: 'Обновить', accelerator: 'F5', click: () => this.nav(t.id, 'reload') },
        { type: 'separator' },
        { label: 'Сохранить как…', accelerator: 'Ctrl+S', click: () => void this.savePage(t.id) },
        { label: 'Печать…', accelerator: 'Ctrl+P', click: () => wc.print() },
        { type: 'separator' },
        { label: 'Копировать адрес страницы', click: () => clipboard.writeText(wc.getURL()) },
        { label: 'Открыть в системном браузере', click: () => void shell.openExternal(wc.getURL()) },
        { type: 'separator' },
        { label: 'Просмотр кода страницы', accelerator: 'Ctrl+U', click: () => this.viewSource(t.id) },
        { label: 'Посмотреть код', accelerator: 'Ctrl+Shift+I', click: () => (this.devOpen(tab), wc.inspectElement(p.x, p.y)) },
      )
      Menu.buildFromTemplate(items).popup({ window: this.win })
    })
  }
  private changed(): void {
    this.emit('tabs', this.list())
  }

  // ---------- bookmarks, history ----------
  private read(): { bookmarks: Bookmark[]; history: HistoryItem[]; settings: BrowserSettings } {
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<{ bookmarks: Bookmark[]; history: HistoryItem[]; settings: Partial<BrowserSettings> }>
      const st = d.settings ?? {}
      return {
        bookmarks: Array.isArray(d.bookmarks) ? d.bookmarks : [],
        history: Array.isArray(d.history) ? d.history : [],
        settings: {
          history: typeof st.history === 'boolean' ? st.history : DEFAULT_BROWSER_SETTINGS.history,
          ua: typeof st.ua === 'string' ? st.ua : DEFAULT_BROWSER_SETTINGS.ua,
          acceptBadCerts: typeof st.acceptBadCerts === 'boolean' ? st.acceptBadCerts : DEFAULT_BROWSER_SETTINGS.acceptBadCerts,
          sleepMin: typeof st.sleepMin === 'number' && st.sleepMin >= 0 ? Math.min(240, Math.round(st.sleepMin)) : DEFAULT_BROWSER_SETTINGS.sleepMin,
        },
      }
    } catch {
      return { bookmarks: [], history: [], settings: { ...DEFAULT_BROWSER_SETTINGS } }
    }
  }
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
    for (const t of this.tabs.values()) if (t.visit && out(t.visit)) t.visit = undefined
    this.saveVisits()
    this.save()
    this.emit('history', null)
  }
  settings(): BrowserSettings {
    return { ...this.data.settings }
  }
  setSettings(patch: Partial<BrowserSettings>): BrowserSettings {
    const s = this.data.settings
    if (typeof patch.history === 'boolean') s.history = patch.history
    if (typeof patch.acceptBadCerts === 'boolean') s.acceptBadCerts = patch.acceptBadCerts
    if (typeof patch.sleepMin === 'number' && patch.sleepMin >= 0) s.sleepMin = Math.min(240, Math.round(patch.sleepMin))
    if (typeof patch.ua === 'string') {
      s.ua = patch.ua.replace(/[\r\n]+/g, ' ').trim().slice(0, 1000)
      const ua = s.ua || this.uaDefault
      this.ses.setUserAgent(ua)
      // the open tabs too (a device mode keeps its own)
      for (const t of this.tabs.values()) {
        if (t.asleep) continue
        t.view.webContents.setUserAgent(ua)
        if (t.t.device) void this.deviceApply(t)
      }
    }
    this.save()
    this.emit('settings', this.settings())
    return this.settings()
  }
  defaultUa(): string {
    return this.uaDefault
  }
  private save(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      renameSync(tmp, this.file)
    }, 500)
  }
  bookmarks(): Bookmark[] {
    return this.data.bookmarks
  }
  setBookmarks(list: Bookmark[]): void {
    this.data.bookmarks = list
    this.save()
    this.emit('bookmarks', list)
  }
  /** A page opened (`fresh` — a navigation, not its title coming): kept, unless the history is off. */
  private visit(tab: Tab, url: string, title: string, fresh: boolean): void {
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
  clearHistory(): void {
    this.data.history = []
    this.visitList = []
    for (const t of this.tabs.values()) t.visit = undefined
    this.saveVisits()
    this.save()
    this.emit('history', null)
  }
  /** A bookmark folder's contents as a native menu (it opens over the pages). Picks → the renderer. */
  folderMenu(id: string, x: number, y: number): void {
    const find = (list: Bookmark[]): Bookmark | undefined => {
      for (const b of list) {
        if (b.id === id) return b
        const f = b.children && find(b.children)
        if (f) return f
      }
      return undefined
    }
    const folder = find(this.data.bookmarks)
    if (!folder?.children) return
    const toItems = (list: Bookmark[]): MenuItemConstructorOptions[] =>
      list.length
        ? list.map((b) => (b.children ? { label: b.title, submenu: toItems(b.children) } : { label: b.title || b.url!, click: (_m, _w, ev) => this.emit('open', { url: b.url, newTab: !!(ev.ctrlKey || ev.metaKey) }) }))
        : [{ label: '(пусто)', enabled: false }]
    Menu.buildFromTemplate(toItems(folder.children)).popup({ window: this.win, x: Math.round(x), y: Math.round(y) })
  }
  /** A native menu of choices (a bookmark's actions): the picked id, or nothing. */
  /** A native menu (over the pages): '-' — a line, '#…' — a heading, `checked` — the current one. */
  choose(items: Array<{ id: string; label: string; checked?: boolean }>, x: number, y: number): Promise<string | undefined> {
    return new Promise((res) => {
      let picked: string | undefined
      Menu.buildFromTemplate(
        items.map((i): MenuItemConstructorOptions =>
          i.id === '-' ? { type: 'separator' } : i.id.startsWith('#') ? { label: i.label, enabled: false } : { label: i.label, type: i.checked === undefined ? 'normal' : 'checkbox', checked: !!i.checked, click: () => (picked = i.id) },
        ),
      ).popup({
        window: this.win,
        x: Math.round(x),
        y: Math.round(y),
        // the click comes before the close
        callback: () => setTimeout(() => res(picked), 0),
      })
    })
  }

  // ---------- the recording ----------
  recState(): RecState {
    return { on: this.recOn, documents: this.recDocs, count: this.recItems.length }
  }
  rec(on: boolean, documents?: boolean): RecState {
    if (documents !== undefined) this.recDocs = documents
    if (on !== this.recOn) {
      this.recOn = on
      for (const t of this.tabs.values()) if (!t.asleep) void (on ? this.recAttach(t) : this.recDetach(t))
    }
    this.recChanged()
    return this.recState()
  }
  recClear(): void {
    this.recItems = []
    this.pending.clear()
    this.extras.clear()
    this.bodyBytes = 0
    this.seq = 0
    this.recChanged()
  }
  recList(): RecItem[] {
    return this.recItems.map(summary)
  }
  recFull(ids: string[]): RecFull[] {
    return ids.map((id) => this.recItems.find((x) => x.id === id)).filter((x): x is RecFull => !!x)
  }
  /**
   * The protocol (Chrome DevTools) on a page: shared by the recording and the device mode — attached while
   * either needs it. Detached from outside (the page gone): both stop.
   */
  private dbgUse(tab: Tab, who: 'rec' | 'device' | 'hook'): Electron.Debugger {
    const d = tab.view.webContents.debugger
    if (!d.isAttached()) {
      d.attach('1.3')
      d.removeAllListeners('message')
      d.removeAllListeners('detach')
      d.on('message', (_e, method, params) => {
        if (tab.rec) this.onCdp(tab, method, params as Record<string, unknown>)
        if (tab.dbg.has('hook')) this.hookCdp(tab, method, params as Record<string, unknown>)
      })
      d.on('detach', () => {
        tab.rec = false
        tab.dbg.clear()
        tab.devScale = undefined
        if (tab.t.device) {
          tab.t.device = undefined
          this.changed()
        }
      })
    }
    tab.dbg.add(who)
    return d
  }
  private dbgDrop(tab: Tab, who: 'rec' | 'device' | 'hook'): void {
    tab.dbg.delete(who)
    if (tab.dbg.size) return
    const d = tab.view.webContents.debugger
    try {
      d.removeAllListeners('message')
      d.removeAllListeners('detach')
      if (d.isAttached()) d.detach()
    } catch {
      // gone
    }
  }
  private async recAttach(tab: Tab): Promise<void> {
    if (tab.rec) return
    try {
      const d = this.dbgUse(tab, 'rec')
      tab.rec = true
      await d.sendCommand('Network.enable', { maxPostDataSize: 1024 * 1024 })
    } catch (e) {
      tab.rec = false
      this.dbgDrop(tab, 'rec')
      this.emit('recError', `Вкладка «${tab.t.title}»: запись не включилась — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  private recDetach(tab: Tab): void {
    if (!tab.rec) return
    tab.rec = false
    // the device mode stays: only the network goes quiet
    if (tab.dbg.size > 1 && !tab.dbg.has('hook')) void tab.view.webContents.debugger.sendCommand('Network.disable').catch(() => undefined)
    this.dbgDrop(tab, 'rec')
  }
  // ---------- hooks: their search listens to the pages of their sites ----------
  /** The protocol on a page while some hook of its site looks into its answers; off otherwise. */
  private hookSync(tab: Tab, url = tab.view.webContents.getURL()): void {
    if (tab.asleep) return
    const want = this.hooks.searching(url)
    const has = tab.dbg.has('hook')
    if (want && !has) {
      try {
        const d = this.dbgUse(tab, 'hook')
        tab.hookReq = new Map()
        void d.sendCommand('Network.enable', { maxTotalBufferSize: 200 * 1024 * 1024, maxResourceBufferSize: 100 * 1024 * 1024 }).catch(() => undefined)
      } catch {
        // DevTools of the page are open in another way — no search there
      }
    } else if (!want && has) {
      tab.hookReq = undefined
      if (!tab.rec && tab.dbg.size > 1) void tab.view.webContents.debugger.sendCommand('Network.disable').catch(() => undefined)
      this.dbgDrop(tab, 'hook')
    }
  }
  private hookCdp(tab: Tab, method: string, p: Record<string, any>): void {
    const reqs = tab.hookReq
    if (!reqs) return
    if (method === 'Network.requestWillBeSent') {
      if (reqs.size > 5000) reqs.clear()
      reqs.set(p.requestId, { url: p.request?.url, method: p.request?.method, type: p.type })
    } else if (method === 'Network.responseReceived') {
      const r = reqs.get(p.requestId)
      if (r) Object.assign(r, { type: p.type ?? r.type, mime: p.response?.mimeType, status: p.response?.status })
      // its request went before the listening began: known by its answer
      else reqs.set(p.requestId, { url: p.response?.url, method: 'GET', type: p.type, mime: p.response?.mimeType, status: p.response?.status })
      if (p.type === 'Document') tab.hookDoc = p.requestId
    } else if (method === 'Network.loadingFinished') {
      if (tab.hookDoc === p.requestId) tab.hookDoc = undefined
      this.hookTake(tab, p.requestId)
    } else if (method === 'Network.loadingFailed') reqs.delete(p.requestId)
  }
  /** An answer's body taken (at once — the page may forget it) and offered to the hooks' search. */
  private hookTake(tab: Tab, requestId: string): void {
    const reqs = tab.hookReq
    if (!reqs) return
    const r = reqs.get(requestId)
    reqs.delete(requestId)
    const page = tab.view.webContents.getURL()
    if (!r?.url || !this.hooks.searching(page)) return
    // the body at once (the page may forget it) — the search itself goes to its own process
    void tab.view.webContents.debugger
      .sendCommand('Network.getResponseBody', { requestId })
      .then((b: { body: string; base64Encoded: boolean }) => this.hooks.offer(page, { url: r.url, method: r.method, cdpType: r.type, mime: r.mime, status: r.status, body: b.body, base64: b.base64Encoded }))
      .catch(() => {
        // the page's own HTML asked for before the listening began is not kept: the page as it is now
        if (r.type !== 'Document') return
        void tab.view.webContents
          .executeJavaScript('document.documentElement.outerHTML', true)
          .then((html: string) => this.hooks.offer(page, { url: r.url, method: r.method, cdpType: 'Document', mime: 'text/html', status: r.status, body: String(html), base64: false }))
          .catch(() => undefined)
      })
  }
  hooksList(): BrowserHook[] {
    return this.hooks.list()
  }
  hookPut(h: Partial<BrowserHook>): BrowserHook {
    return this.hooks.put(h)
  }
  hookRemove(id: string): void {
    this.hooks.remove(String(id))
  }
  hookHits(id: string): HookHit[] {
    return this.hooks.hits(String(id))
  }
  hookClearHits(id: string): void {
    this.hooks.clearHits(String(id))
  }
  hookSkip(): void {
    this.hooks.skip()
  }
  hookPause(on: boolean): HookStatus {
    this.hooks.pause(!!on)
    for (const t of this.tabs.values()) this.hookSync(t)
    return this.hooks.getStatus()
  }
  hookStatus(): HookStatus {
    return this.hooks.getStatus()
  }
  /** The hooks of the open tab now (its CSS / JS again — after an edit). */
  hookReapply(id: string): void {
    const t = this.tabs.get(id)
    if (t && !t.asleep) t.view.webContents.reload()
  }

  // ---------- the device mode ----------
  device(id: string, d?: DeviceMode): void {
    const t = this.tabs.get(id)
    if (!t) return
    this.wake(t)
    const before = t.t.device
    if (!d) {
      if (!before) return
      t.t.device = undefined
      t.devScale = undefined
      const dbg = t.view.webContents.debugger
      const wasMobileUa = !!before.ua
      void (async () => {
        try {
          if (dbg.isAttached()) {
            await dbg.sendCommand('Emulation.clearDeviceMetricsOverride')
            await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false })
            await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: false })
            await dbg.sendCommand('Emulation.setUserAgentOverride', { userAgent: this.data.settings.ua || this.uaDefault })
          }
        } catch {
          // the page is going
        }
        this.dbgDrop(t, 'device')
        // the site saw a phone: it is asked again as itself
        if (wasMobileUa) t.view.webContents.reload()
      })()
      this.changed()
      return
    }
    const w = Math.round(Math.min(4000, Math.max(50, d.w)))
    const h = Math.round(Math.min(4000, Math.max(50, d.h)))
    const dpr = Math.min(5, Math.max(0.5, d.dpr || 1))
    t.t.device = { name: String(d.name ?? ''), w, h, dpr, mobile: !!d.mobile, ua: d.ua || undefined }
    const uaChanged = (before?.ua ?? '') !== (t.t.device.ua ?? '')
    this.changed()
    void this.deviceApply(t).then(() => uaChanged && t.view.webContents.getURL() && !t.view.webContents.getURL().startsWith('about:') && t.view.webContents.reload())
  }
  /** The device mode told to the page: its size, scale (to fit the pane), touch, User-Agent. */
  private async deviceApply(t: Tab, sizeOnly = false): Promise<void> {
    const dv = t.t.device
    if (!dv) return
    try {
      const d = this.dbgUse(t, 'device')
      const scale = t.devScale ?? 1
      await d.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: dv.w,
        height: dv.h,
        // (Chromium honours its own density for a mobile device only; a computer keeps the screen's)
        deviceScaleFactor: dv.mobile ? dv.dpr : 0,
        mobile: dv.mobile,
        scale,
        screenWidth: dv.w,
        screenHeight: dv.h,
        screenOrientation: dv.w > dv.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
      })
      if (sizeOnly) return
      await d.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: dv.mobile, maxTouchPoints: dv.mobile ? 5 : 1 })
      await d.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: dv.mobile, configuration: dv.mobile ? 'mobile' : 'desktop' })
      await d.sendCommand('Emulation.setUserAgentOverride', { userAgent: dv.ua || this.data.settings.ua || this.uaDefault })
    } catch (e) {
      this.emit('recError', `Режим устройства не включился: ${e instanceof Error ? e.message : String(e)}`)
      t.t.device = undefined
      this.dbgDrop(t, 'device')
      this.changed()
    }
  }
  private onCdp(tab: Tab, method: string, p: Record<string, unknown>): void {
    if (!this.recOn) return
    const id = `${tab.t.id}:${String(p.requestId)}`
    if (method === 'Network.requestWillBeSent') {
      const type = String(p.type ?? '')
      const req = p.request as { url: string; method: string; headers: Record<string, string>; postData?: string; hasPostData?: boolean }
      // a redirect of one already listed: the page asked for the first one
      if (this.pending.has(id) || this.recItems.some((x) => x.id === id)) return
      if (!(type === 'XHR' || type === 'Fetch' || (this.recDocs && type === 'Document'))) return
      if (!/^https?:/i.test(req.url)) return
      const extra = this.extras.get(id)
      this.extras.delete(id)
      const item: RecFull = {
        id,
        seq: ++this.seq,
        tabId: tab.t.id,
        at: Math.round(Number(p.wallTime ?? Date.now() / 1000) * 1000),
        method: req.method,
        url: req.url,
        type,
        reqHeaders: extra ?? Object.entries(req.headers),
        postData: req.postData,
      }
      this.pending.set(id, { item, started: Date.now(), hasPostData: req.hasPostData && req.postData === undefined })
      this.recItems.push(item)
      // the oldest go beyond the limit
      while (this.recItems.length > MAX_REC) {
        const old = this.recItems.shift()!
        this.bodyBytes -= old.resBody?.length ?? 0
      }
      this.recChanged()
      return
    }
    if (method === 'Network.requestWillBeSentExtraInfo') {
      // the headers as really sent (cookies included) — may come before the request itself
      const headers = Object.entries((p.headers as Record<string, string>) ?? {})
      const pend = this.pending.get(id)
      if (pend) pend.item.reqHeaders = headers
      else {
        // (most belong to files — never asked for; the map is kept small)
        if (this.extras.size > 500) this.extras.clear()
        this.extras.set(id, headers)
      }
      return
    }
    const pend = this.pending.get(id)
    if (!pend) return
    const item = pend.item
    if (method === 'Network.responseReceived') {
      const r = p.response as { status: number; headers: Record<string, string>; mimeType: string }
      item.status = r.status
      item.resHeaders = Object.entries(r.headers ?? {})
      item.mimeType = r.mimeType
      this.recChanged()
    } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      this.pending.delete(id)
      item.ms = Date.now() - pend.started
      if (method === 'Network.loadingFailed') item.error = String(p.errorText ?? 'ошибка')
      else item.size = Number(p.encodedDataLength ?? 0)
      void this.recBodies(tab, String(p.requestId), item, pend.hasPostData && method === 'Network.loadingFinished')
      this.recChanged()
    }
  }
  /** The body sent (when the event did not carry it) and the answer's text (JSON, text — not files). */
  private async recBodies(tab: Tab, reqId: string, item: RecFull, needPost?: boolean): Promise<void> {
    const d = tab.view.webContents.debugger
    if (!d.isAttached()) return
    try {
      if (needPost) item.postData = ((await d.sendCommand('Network.getRequestPostData', { requestId: reqId })) as { postData: string }).postData
    } catch {
      // a file upload — not kept
    }
    if (item.error || !/json|text|xml|javascript|html|graphql|x-www-form-urlencoded/i.test(item.mimeType ?? '')) return
    if ((item.size ?? 0) > MAX_BODY * 4) return
    try {
      const r = (await d.sendCommand('Network.getResponseBody', { requestId: reqId })) as { body: string; base64Encoded: boolean }
      const text = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body
      item.resBody = text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text
      this.bodyBytes += item.resBody.length
      // too much kept: the oldest answers lose their texts
      for (const old of this.recItems) {
        if (this.bodyBytes <= MAX_BODIES) break
        if (old.resBody && old !== item) {
          this.bodyBytes -= old.resBody.length
          old.resBody = undefined
        }
      }
    } catch {
      // the page threw the answer away already
    }
  }
  private recChanged(): void {
    // the list goes to the window at most 5 times a second
    this.recTimer ??= setTimeout(() => {
      this.recTimer = undefined
      this.emit('rec', { state: this.recState(), items: this.recList() })
    }, 200)
  }
}

function originOf(url: string): string {
  try {
    const o = new URL(url).origin
    return /^https?:/.test(o) ? o : ''
  } catch {
    return ''
  }
}
const summary = (x: RecFull): RecItem => ({ id: x.id, seq: x.seq, tabId: x.tabId, at: x.at, method: x.method, url: x.url, type: x.type, status: x.status, ms: x.ms, error: x.error, size: x.size })
function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
