import { app, WebContentsView, type BrowserWindow, type Session, type WebContents } from 'electron'
import { release } from 'node:os'
import { chromeMetadata, identityHeaders, windowsPlatformVersion, type UaMetadata, type UaSystem } from '../../shared/browser/chromeIdentity'
import { tellIdentity } from './pageIdentity'
import { browserId, type BrowserEmit, type BrowserTab, type ClosedPlace, type NavAction } from '../../shared/browser'
import { Hooks } from '../hooks'
import { browserSession, guardPermissions, keepDownloads } from './profileSession'
import { SOURCE_SCHEME, sourcePage } from '../viewSource'
import { BrowserStore } from './browserStore'
import { CheckTabs } from './checkTabs'
import { DeviceEmulation } from './deviceEmulation'
import { DockedDevTools } from './dockedDevTools'
import { HookSearch } from './hookSearch'
import { InspectMode } from './inspect/inspectMode'
import { TechDetector } from './inspect/techDetector'
import { LinkStatus } from './linkStatus'
import { PageLayout } from './pageLayout'
import { PageZoom } from './pageZoom'
import { clearSiteCaches, wirePageLife } from './pageLife'
import { mayOpenExternal } from './externalApps'
import { PageRulers, savePageAs } from './pageTools'
import { PasswordVault } from './passwordVault'
import { RequestRecorder } from './requestRecorder'
import { ScenarioRecorder } from './scenarioRecorder'
import { SiteCertificates } from './siteCertificates'
import { KEEPS_AWAKE, safeHost, type Rect, type Tab } from './tab'
import { TabCdp } from './tabCdp'
import { wireTab, type TabEventsHost } from './tabEvents'

/** The built files the browser runs (paths from the app's build folder — ctx.mainDir). */
export interface BrowserFiles {
  /** Its pages' preload (sign-in forms, rulers, a scenario's recorder). */
  preload: string
  /** The hooks' search process. */
  hookWorker: string
  /** The inspector's technologies process. */
  inspectWorker: string
}

/**
 * The browser's core: the tabs (each a WebContentsView of its own over the main window), one persistent profile apart
 * from the app, and its parts made and wired — what they share (BrowserHost) and the tabs' life: made, asleep and
 * woken, navigated, closed. The window's calls by name are answered by Browser (../browser.ts) on top of it.
 */
export class BrowserCore implements TabEventsHost {
  readonly tabs = new Map<string, Tab>()
  readonly ses: Session
  readonly cdp: TabCdp
  readonly store: BrowserStore
  readonly hooks: Hooks
  readonly hookSearch: HookSearch
  readonly checkTabs: CheckTabs
  readonly scenario: ScenarioRecorder
  readonly devTools: DockedDevTools
  readonly pageZoom: PageZoom
  readonly linkStatus: LinkStatus
  readonly inspector: InspectMode
  protected win: BrowserWindow | undefined
  protected uaDefault = ''
  protected pages: PageLayout
  protected recorder: RequestRecorder
  protected devices: DeviceEmulation
  readonly passwordVault: PasswordVault
  readonly rulers: PageRulers
  protected certs = new SiteCertificates()
  /** The sign-in questions asked (one shown at a time): their tab and Chromium's callback. */
  private logins = new Map<string, { tabId: string; cb: (u?: string, p?: string) => void }>()

  constructor(
    root: string,
    readonly files: BrowserFiles,
    private emitEvent: BrowserEmit,
  ) {
    this.ses = browserSession()
    this.store = new BrowserStore(root, () => this.tabs.values(), this.emit)
    this.cdp = new TabCdp((tab) => {
      tab.rec = false
      tab.dbg.clear()
      tab.devScale = undefined
      if (tab.t.device) {
        tab.t.device = undefined
        this.changed()
      }
    })
    // (the parts that listen to the pages' protocol, in the order they hear it)
    this.recorder = new RequestRecorder(this)
    this.hooks = new Hooks(root, files.hookWorker, (type, payload) => {
      this.emit(type, payload)
      // a hook changed: the pages follow (a pause is followed by its caller — Browser.hookPause)
      if (type === 'hooks') this.hookSearch.syncAll()
    })
    this.hookSearch = new HookSearch(this, this.hooks)
    this.checkTabs = new CheckTabs(root, this)
    this.devices = new DeviceEmulation(this)
    this.scenario = new ScenarioRecorder(this, (id, d) => this.devices.set(id, d))
    this.passwordVault = new PasswordVault(root, this)
    this.rulers = new PageRulers(this)
    this.devTools = new DockedDevTools(this, { level: () => this.store.devtoolsZoom(), set: (z) => this.store.setDevtoolsZoom(z) })
    this.pageZoom = new PageZoom(this, this.store)
    this.pages = new PageLayout(this, (t) => void this.devices.apply(t, true))
    this.linkStatus = new LinkStatus({ window: () => this.win, pageBox: (id) => this.pages.boxOf(id) })
    this.inspector = new InspectMode(this, new TechDetector(files.inspectWorker), (tab, x, y) => (this.devTools.open(tab), tab.view.webContents.inspectElement(x, y)), () => this.store.settings.inspectFrame)
    this.setupSession()
    // the tabs not looked at for a while fall asleep (each page is a process of its own: memory)
    setInterval(() => this.sleepIdle(), 60_000)
  }
  /**
   * The browser's User-Agent put everywhere a page's parts read it: the profile's session (its pages, its requests)
   * and the process's own (`app.userAgentFallback` — a site's shared and service workers take theirs from it). One
   * string in all of them: a check (Cloudflare's) that meets two in one page takes it for a fake and fails.
   */
  protected applyUserAgent(): string {
    const ua = this.userAgent()
    this.ses.setUserAgent(ua)
    app.userAgentFallback = ua
    return ua
  }
  /** The profile's session: a browser's User-Agent, certificates, the source viewer, permissions, downloads. */
  private setupSession(): void {
    // a browser's User-Agent (not "Electron" / the app — some sites refuse those)
    this.uaDefault = this.ses.getUserAgent().replace(/\s+Electron\/\S+/i, '').replace(/\s+qvarch[-\w]*\/\S+/i, '')
    this.applyUserAgent()
    // every request as Chrome's: its Client Hints say Chrome too (each page is also told so — chromeLike; this covers
    // what the protocol does not reach: workers, a page's very first request, the notes' browsers)
    this.ses.webRequest.onBeforeSendHeaders((d, cb) => {
      const o = this.uaOverride()
      cb({ requestHeaders: identityHeaders(d.requestHeaders, d.url, o.userAgent, o.userAgentMetadata) })
    })
    // each site's certificate as Chromium checked it — kept to show it (the check itself stays Chromium's: -3)
    this.ses.setCertificateVerifyProc((req, cb) => {
      this.certs.remember(req)
      cb(-3)
    })
    // «Просмотр кода страницы»: our own viewer (qa-source:<address>), fetched with the site's cookies
    this.ses.protocol.handle(SOURCE_SCHEME, (req) => sourcePage(req.url.slice(SOURCE_SCHEME.length + 1), (u) => this.ses.fetch(u)))
    // the corporate sign-in (Windows auth) works as in Chrome
    this.ses.allowNTLMCredentialsForDomains('*')
    guardPermissions(this.ses, () => this.store.settings.sitePermissions, (page, url) => mayOpenExternal(this, page, url))
    keepDownloads(this.ses, this.emit)
    app.on('certificate-error', (e, wc, url, error, _cert, cb, isMainFrame) => {
      const tab = this.byContents(wc)
      if (!tab) return
      const host = safeHost(url)
      e.preventDefault()
      if (this.certs.isTrusted(host)) return cb(true)
      // the setting: internal sites with their own / expired certificates open (the lock shows it red)
      if (this.store.settings.acceptBadCerts) {
        this.certs.trust(host)
        return cb(true)
      }
      cb(false)
      // a part of the page (a counter, an ad, a picture) is simply not loaded — the page stays
      if (!isMainFrame) return
      tab.t.error = { code: -200, desc: error, url, cert: true, host }
      this.changed()
    })
  }

  // ---------- what the parts share ----------
  /** The browser's news to the window (bound: the parts take it as a function). */
  readonly emit: BrowserEmit = (type, payload) => this.emitEvent(type, payload)
  window(): BrowserWindow | undefined {
    return this.win
  }
  changed(): void {
    this.emit('tabs', this.list())
  }
  byContents(wc: WebContents): Tab | undefined {
    for (const t of this.tabs.values()) if (!t.asleep && t.view.webContents === wc) return t
    return undefined
  }
  userAgent(): string {
    return this.store.settings.ua || this.uaDefault
  }
  /** This computer as Chrome reports it (its Windows' version, its processor). */
  private readonly uaSystem: UaSystem = { platformVersion: windowsPlatformVersion(release()), architecture: process.arch.startsWith('arm') ? 'arm' : 'x86', bitness: process.arch.endsWith('64') ? '64' : '32' }
  uaOverride(ua = this.userAgent(), mobile = false): { userAgent: string; userAgentMetadata?: UaMetadata } {
    const meta = chromeMetadata(ua, this.uaSystem, mobile)
    return { userAgent: ua, ...(meta ? { userAgentMetadata: meta } : {}) }
  }
  /**
   * A tab's page told it is Chrome — its Client Hints and navigator.userAgentData, as Chrome's (a device mode — its
   * own). Its DevTools holding the page — the User-Agent alone (the session's headers still say Chrome).
   */
  async chromeLike(t: Tab, url = t.view.webContents.getURL()): Promise<void> {
    if (t.t.device || t.asleep) return
    try {
      await tellIdentity(t.view.webContents, this.cdp.use(t, 'chrome'), url, () => this.uaOverride())
    } catch {
      // (the page's DevTools hold it, the page going, no document yet — told at its navigation's start)
    }
  }
  /**
   * A tab kept telling its pages what browser they are in (Chrome; a sign-in host — Firefox): at every main-frame
   * navigation's start (told before a page has a document, Chromium drops it — the first blank page gives way).
   */
  private keepChromeLike(t: Tab): void {
    t.view.webContents.on('did-start-navigation', (d) => d.isMainFrame && !d.isSameDocument && void this.chromeLike(t, d.url))
  }
  askLogin(tab: Tab, info: { host: string; realm: string }, cb: (user?: string, pass?: string) => void): void {
    // the window shows the newest question only: the ones before are cancelled (else their requests hang for ever)
    this.cancelLogins()
    const reqId = browserId()
    this.logins.set(reqId, { tabId: tab.t.id, cb })
    this.emit('login', { reqId, tabId: tab.t.id, host: info.host, realm: info.realm })
  }
  loginReply(reqId: string, user?: string, pass?: string): void {
    const ask = this.logins.get(reqId)
    this.logins.delete(reqId)
    ask?.cb(user, pass)
  }
  /** The sign-in questions not answered (of a tab — closed, its page made anew; none — all) cancelled. */
  protected cancelLogins(tabId?: string): void {
    for (const [id, a] of [...this.logins])
      if (tabId === undefined || a.tabId === tabId) {
        this.logins.delete(id)
        a.cb()
      }
  }

  // ---------- the window ----------
  /** The main window (made again after it was closed for good): every page goes into it. */
  attach(win: BrowserWindow): void {
    if (this.win === win) return
    this.win = win
    this.pages.attach(win)
  }
  layout(rects: Rect[]): void {
    this.pages.layout(rects)
    this.linkStatus.follow()
  }
  shots(): Promise<Record<string, string>> {
    return this.pages.shots()
  }
  cover(on: boolean): void {
    this.pages.cover(on)
    this.linkStatus.follow()
  }

  // ---------- tabs ----------
  list(): BrowserTab[] {
    return [...this.tabs.values()].map((t) => t.t)
  }
  private makeView(): WebContentsView {
    // the preload only sees sign-in forms (to offer saving / filling a password) — the page cannot reach it
    const view = new WebContentsView({ webPreferences: { session: this.ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, preload: this.files.preload } })
    // (the window's dark canvas while a page has nothing to draw yet; its document there — white under it, as browsers
    // give a page that sets no background of its own)
    const dark = this.win?.getBackgroundColor() ?? '#0a0d12'
    view.setBackgroundColor(dark)
    const wc = view.webContents
    wc.on('did-start-navigation', (d) => d.isMainFrame && !d.isSameDocument && !wc.isDestroyed() && view.setBackgroundColor(dark))
    wc.on('dom-ready', () => !wc.isDestroyed() && view.setBackgroundColor('#ffffff'))
    view.setVisible(false)
    return view
  }
  /** Tabs not shown for the set minutes fall asleep — not one recording, running a scenario, with the tools open, as a device, loading or playing sound. */
  private sleepIdle(): void {
    const min = this.store.settings.sleepMin
    if (!min || this.recorder.recording) return
    const old = Date.now() - min * 60_000
    let slept = false
    for (const [id, t] of this.tabs) {
      if (t.asleep || this.pages.isShown(id) || t.seen > old || t.dev || t.t.device || t.t.loading || t.rec || KEEPS_AWAKE.some((o) => t.dbg.has(o))) continue
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
      slept = true
    }
    // (the tabs' list told only when one went to sleep)
    if (slept) this.changed()
  }
  /** A tab asleep made again: its page loads at the address it had (zoomed as its site — when it is there). */
  wake(t: Tab): void {
    if (!t.asleep) return
    t.view = this.makeView()
    t.asleep = false
    t.t.asleep = false
    // (a page whose process was gone or hung — a process of its own now)
    if (t.t.error?.gone) t.t.error = undefined
    t.dbg = new Set()
    t.rec = false
    this.win?.contentView.addChildView(t.view)
    wireTab(this, t)
    wirePageLife(this, t)
    this.keepChromeLike(t)
    if (this.recorder.recording) void this.recorder.attach(t)
    t.checkScript = undefined
    void this.checkTabs.sync(t)
    void this.inspector.sync(t, true)
    t.t.zoom = this.store.siteZoom(t.t.url)
    const ua = this.store.settings.ua
    if (ua) t.view.webContents.setUserAgent(ua)
    void t.view.webContents.loadURL(t.t.url).catch(() => undefined)
    this.changed()
  }
  /**
   * A tab's page started again at its address — its process crashed or does not answer («Перезапустить»): the view
   * closed (its process not answering keeps no one waiting), the site's caches cleared (a broken cached script or
   * compiled code, a service worker would crash it again on every start; its cookies and storage stay — the person
   * stays signed in), and made anew, as a tab waking up.
   */
  private async restartPage(t: Tab): Promise<void> {
    if (!t.asleep) {
      this.devTools.close(t)
      this.cancelLogins(t.t.id)
      try {
        this.win?.contentView.removeChildView(t.view)
        t.view.webContents.close()
      } catch {
        // gone already
      }
      t.asleep = true
      this.pages.forget(t.t.id)
    }
    t.t.error = undefined
    // (loading while the caches go: not put to sleep; opened meanwhile — it wakes as usual, this wake then does nothing)
    t.t.loading = true
    this.changed()
    await clearSiteCaches(this.ses, t.t.url)
    if (!this.tabs.has(t.t.id)) return
    this.wake(t)
    this.pages.relayout()
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
    const tab: Tab = { t: { id, url, title: url === 'about:blank' ? 'Новая вкладка' : url, loading: false, canBack: false, canFwd: false, zoom: this.store.siteZoom(url) }, view, rec: false, ruler: { on: false, v: [], h: [] }, dbg: new Set(), seen: Date.now() }
    this.tabs.set(id, tab)
    this.win?.contentView.addChildView(view)
    wireTab(this, tab)
    wirePageLife(this, tab)
    this.keepChromeLike(tab)
    if (this.recorder.recording) void this.recorder.attach(tab)
    this.hookSearch.sync(tab, url)
    void this.checkTabs.sync(tab)
    if (url !== 'about:blank') void view.webContents.loadURL(url).catch(() => undefined)
    this.changed()
    if (opener) this.emit('opened', { id, opener })
    return tab.t
  }
  /** A tab closed; `place` — the person closed it there: kept in «Недавно закрытые» (a blank page is not). */
  close(id: string, place?: ClosedPlace): void {
    const t = this.tabs.get(id)
    if (!t) return
    if (place && t.t.url !== 'about:blank') this.store.addClosed({ id: browserId(), url: t.t.url, title: t.t.title, at: Date.now(), ...place, ...(t.t.favicon ? { favicon: t.t.favicon } : {}) })
    // the recording tab closed: the recording stays (stopped from the bar) — its lines are kept
    this.tabs.delete(id)
    this.pages.forget(id)
    this.checkTabs.forget(id)
    this.cancelLogins(id)
    this.devTools.close(t)
    this.linkStatus.forget(id)
    this.inspector.forget(id)
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
    // (its process gone or not answering: made anew — at the address typed)
    const gone = !!t.t.error?.gone
    t.t.error = undefined
    t.t.url = url
    // (the address is the new page's from now on — the icon shown is the old one's: none known yet)
    t.t.favicon = undefined
    // an address typed in the recording tab: a line of its own
    this.scenario.onAddressTyped(id, url)
    if (gone) void this.restartPage(t)
    else void t.view.webContents.loadURL(url).catch(() => undefined)
    this.changed()
  }
  nav(id: string, action: NavAction): void {
    const t = this.tabs.get(id)
    if (!t) return
    this.wake(t)
    // (its process gone or not answering: a reload is its start anew)
    if ((action === 'reload' || action === 'hard') && t.t.error?.gone) return void this.restartPage(t)
    const wc = t.view.webContents
    const h = wc.navigationHistory
    const NAV: Record<NavAction, () => void> = {
      back: () => h.canGoBack() && h.goBack(),
      fwd: () => h.canGoForward() && h.goForward(),
      reload: () => ((t.t.error = undefined), wc.reload()),
      hard: () => ((t.t.error = undefined), wc.reloadIgnoringCache()),
      stop: () => wc.stop(),
      devtools: () => this.devTools.toggle(t),
    }
    NAV[action]?.()
  }
  /** A tab's zoom: its site's (every tab there goes with it), remembered between runs. */
  zoom(id: string, percent: number): void {
    const t = this.tabs.get(id)
    if (!t) return
    this.wake(t)
    this.pageZoom.set(t, percent)
  }
  /** «Сохранить как…»: the page with its files (or one .mhtml), where the user says. */
  async savePage(id: string): Promise<void> {
    const t = this.tabs.get(id)
    if (!t || !this.win) return
    this.wake(t)
    await savePageAs(this.win, t.view.webContents, this.emit)
  }
  /** «Просмотр кода страницы»: its source in a tab of its own. */
  viewSource(id: string): void {
    const url = this.tabs.get(id)?.view.webContents.getURL()
    if (url && /^(https?|file):/.test(url)) this.create(`${SOURCE_SCHEME}:${url}`, id)
  }
  closeAll(): void {
    for (const id of [...this.tabs.keys()]) this.close(id)
    // what waits to be written goes now (the app quits)
    this.store.flush()
  }
}
