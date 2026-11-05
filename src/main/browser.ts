import { shell, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import type { ApiEndpoint } from '../shared/apiMap'
import type { ApiMapHost, Bookmark, BrowserApi, BrowserSettings, BrowserTab, CertInfo, DeviceMode, PasswordInfo, PwAnswer, PwRecState, RecFull, RecItem, RecState, Visit } from '../shared/browser'
import type { CheckProblem, CheckSettings, CheckState } from '../shared/check'
import type { BrowserHook, HookHit, HookStatus } from '../shared/hooks'
import { BrowserCore } from './browser/browserCore'
import type { Tab } from './browser/tab'
import { chooseMenu, folderMenu } from './browser/nativeMenus'
import { clearSiteData, readLocalStorage } from './browser/pageTools'
import { findSwagger, type SwaggerFound } from './browser/swaggerFind'
import { lookAtTab, takeLookReply } from './browser/pageLook'
import { pageLookText } from '../shared/browser/pageLook'
import { sameAddress } from '../shared/browser/scenarioAddress'
import { newBookmarksOnly, type ImportSource } from '../shared/browser/browserImport'
import { importSources, pickPasswordsCsv, readImportBookmarks } from './browser/browserImport'

/**
 * The Браузер section's pages: each tab a WebContentsView of its own over the main window (the renderer reports
 * where each visible one goes — the rest are hidden), one persistent profile apart from the app. The tabs live in
 * BrowserCore, the rest in ./browser/ — the data on disk, the recordings, the hooks' search, «Проверка», the device
 * mode, passwords, certificates; this class answers the window's calls by name (BrowserApi), each from its part.
 */
export class Browser extends BrowserCore implements BrowserApi {
  // ---------- a page for an AI agent ----------
  /** The tab the agent's looks open pages in (one, taken again — never a tab per look). */
  private lookTab = ''
  /**
   * What a page offers to act on: the address given — a tab open at it, else the agent's own tab taken there (made
   * once, never brought to the front); looked at when its loads settled (a sign-in passes through redirects of its
   * own — the page they end at is the page); none — the tab shown (or looked at) last.
   */
  async look(url?: string): Promise<string> {
    if (url) {
      const at = [...this.tabs.values()].find((x) => !x.asleep && sameAddress(x.view.webContents.getURL() || x.t.url, url))
      const own = at ? undefined : this.tabs.get(this.lookTab)
      const t = at ?? own ?? this.tabs.get(this.create(url).id)!
      if (!at) this.lookTab = t.t.id
      if (own) this.go(own.t.id, url)
      return pageLookText(await lookAtTab(t, true), url)
    }
    const t = [...this.tabs.values()].filter((x) => !x.asleep && !/^about:blank$/.test(x.t.url)).sort((a, b) => Number(this.pages.isShown(b.t.id)) - Number(this.pages.isShown(a.t.id)) || b.seen - a.seen)[0]
    if (!t) throw new Error('Во встроенном браузере нет открытой страницы — дай адрес (url)')
    return pageLookText(await lookAtTab(t, t.t.loading))
  }
  /** A page's answer to a look. */
  lookReply(from: WebContents, id: unknown, look: unknown): void {
    takeLookReply(from, id, look)
  }

  // ---------- a scenario run in the Браузер ----------
  /** Each note block's tab to run in (owner → tab id): kept for its next run. */
  private runTabs = new Map<string, string>()
  /**
   * The tab a block's scenario runs in, awake and made the shown one (a hidden page draws no frames — Playwright
   * waits for them before a click): a tab at the address the scenario starts at, if one is open; else the block's
   * own tab of its last run, taken there; else a new one at that address (a blank one — the scenario names none).
   */
  runTab(owner: string, url?: string): Tab {
    const at = url ? [...this.tabs.values()].find((x) => sameAddress(x.asleep ? x.t.url : x.view.webContents.getURL() || x.t.url, url)) : undefined
    const own = at ? undefined : this.tabs.get(this.runTabs.get(owner) ?? '')
    const t = at ?? own ?? this.tabs.get(this.create(url ?? 'about:blank').id)!
    this.runTabs.set(owner, t.t.id)
    this.wake(t)
    if (own && url) this.go(t.t.id, url)
    // (a blank tab is made without loading anything — its page would have no frame to drive)
    else if (!url && !t.view.webContents.getURL()) void t.view.webContents.loadURL('about:blank').catch(() => undefined)
    this.emit('activate', { id: t.t.id })
    return t
  }
  /** A tab closed: no block runs in it any more (its next run takes another). */
  override close(id: string): void {
    super.close(id)
    for (const [owner, tabId] of this.runTabs) if (tabId === id) this.runTabs.delete(owner)
  }
  /** A tab's device mode told to its page again (a run's window size undone over it). */
  deviceAgain(t: Tab): void {
    void this.devices.apply(t)
  }
  /** A scenario is being recorded in this page (a tab's or a note's browser's). */
  recordingIn(wc: WebContents): boolean {
    return this.scenario.recordsIn(wc)
  }

  // ---------- a tab's page ----------
  /** A bad certificate accepted: this host opens (until the app quits). */
  trust(id: string, host: string): void {
    this.certs.trust(host)
    this.nav(id, 'reload')
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
    await clearSiteData(this.ses, origin)
    t.t.error = undefined
    t.view.webContents.reloadIgnoringCache()
  }
  /** The site's connection: plain http, or its certificate (who, by whom, until when, fingerprints). */
  certInfo(id: string): CertInfo | undefined {
    const t = this.tabs.get(id)
    return this.certs.info(t?.view.webContents.getURL() || t?.t.url || '')
  }
  /** The site's Swagger / OpenAPI description (what the page shows, else the usual places on its server). */
  async swaggerFind(id: string): Promise<SwaggerFound> {
    const t = this.tabs.get(id)
    if (!t) return { error: 'Нет вкладки', tried: [] }
    this.wake(t)
    return findSwagger(t.view.webContents, (u, i) => this.ses.fetch(u, i))
  }
  /** A downloaded file shown in its folder. */
  reveal(path: string): void {
    if (existsSync(path)) shell.showItemInFolder(path)
  }
  /** What the sites keep in localStorage, as a Playwright run's storageState wants it. */
  localStorageOf(origins: string[]): ReturnType<typeof readLocalStorage> {
    return readLocalStorage(this.ses, this.tabs, origins)
  }
  /** The device mode (undefined — the tab as itself). */
  device(id: string, d?: DeviceMode): void {
    this.devices.set(id, d)
  }
  ruler(id: string, on: boolean): void {
    this.rulers.set(id, on)
  }

  // ---------- settings, bookmarks, the history ----------
  settings(): BrowserSettings {
    return { ...this.store.settings }
  }
  setSettings(patch: Partial<BrowserSettings>): BrowserSettings {
    const s = this.store.settings
    if (typeof patch.history === 'boolean') s.history = patch.history
    if (typeof patch.acceptBadCerts === 'boolean') s.acceptBadCerts = patch.acceptBadCerts
    if (typeof patch.sleepMin === 'number' && patch.sleepMin >= 0) s.sleepMin = Math.min(240, Math.round(patch.sleepMin))
    if (typeof patch.ua === 'string') {
      s.ua = patch.ua.replace(/[\r\n]+/g, ' ').trim().slice(0, 1000)
      const ua = this.applyUserAgent()
      // the open tabs too (a device mode keeps its own)
      for (const t of this.tabs.values()) {
        if (t.asleep) continue
        t.view.webContents.setUserAgent(ua)
        if (t.t.device) void this.devices.apply(t)
        else void this.chromeLike(t)
      }
    }
    this.store.save()
    this.emit('settings', this.settings())
    return this.settings()
  }
  /** The built-in User-Agent (what '' means). */
  defaultUa(): string {
    return this.uaDefault
  }
  bookmarks(): Bookmark[] {
    return this.store.bookmarks()
  }
  setBookmarks(list: Bookmark[]): void {
    this.store.setBookmarks(list)
  }
  suggest(q: string): Array<{ url: string; title: string; bookmark: boolean }> {
    return this.store.suggest(q)
  }
  visits(): Visit[] {
    return this.store.visits()
  }
  visitsDelete(what: string[] | { from: number; to: number }): void {
    this.store.visitsDelete(what)
  }
  clearHistory(): void {
    this.store.clearHistory()
  }
  /** A bookmark folder's contents as a native menu (it opens over the pages). Picks → the renderer. */
  folderMenu(id: string, x: number, y: number): void {
    folderMenu(this.store.bookmarks(), id, x, y, this.win, (url, newTab) => this.emit('open', { url, newTab }))
  }
  /** A native menu (over the pages): '-' — a line, '#…' — a heading, `checked` — the current one. */
  choose(items: Array<{ id: string; label: string; checked?: boolean }>, x: number, y: number): Promise<string | undefined> {
    return chooseMenu(items, x, y, this.win)
  }

  // ---------- the recordings: the requests, a Playwright scenario ----------
  recState(): RecState {
    return this.recorder.state()
  }
  rec(on: boolean, documents?: boolean): RecState {
    return this.recorder.set(on, documents)
  }
  recClear(): void {
    this.recorder.clear()
  }
  recList(): RecItem[] {
    return this.recorder.list()
  }
  recFull(ids: string[]): RecFull[] {
    return this.recorder.full(ids)
  }
  /** Files picked while recording a scenario → kept with the notebook (index.ts sets it). */
  set onRecordFiles(f: ((paths: string[]) => string[]) | undefined) {
    this.scenario.onRecordFiles = f
  }
  get onRecordFiles(): ((paths: string[]) => string[]) | undefined {
    return this.scenario.onRecordFiles
  }
  pwRecState(): PwRecState | undefined {
    return this.scenario.state()
  }
  pwRecStart(note: string, key: string, url: string, screen?: { w: number; h: number }): BrowserTab {
    return this.scenario.start(note, key, url, screen)
  }
  pwRecStop(cancel = false): Promise<{ note: string; key: string; url: string; lines: string[] } | undefined> {
    return this.scenario.stop(cancel)
  }

  // ---------- passwords ----------
  passwords(): PasswordInfo[] {
    return this.passwordVault.passwords()
  }
  pwAnswer(askId: string, answer: PwAnswer): void {
    this.passwordVault.answer(askId, answer)
  }
  pwReveal(id: string): string {
    return this.passwordVault.reveal(id)
  }
  pwDelete(id: string): void {
    this.passwordVault.remove(id)
  }
  pwFill(tabId: string, id: string): void {
    this.passwordVault.fill(tabId, id)
  }
  neverList(): string[] {
    return this.passwordVault.neverList()
  }
  neverRemove(origin: string): void {
    this.passwordVault.neverRemove(origin)
  }

  // ---------- moving in from another browser ----------
  importSources(): ImportSource[] {
    return importSources()
  }
  /** A profile's bookmarks added as a folder at the bar's end (the ones here already left out). */
  importBookmarks(sourceId: string): { added: number; skipped: number } {
    const f = readImportBookmarks(sourceId)
    if (!f) return { added: 0, skipped: 0 }
    const { folder, added, skipped } = newBookmarksOnly(f, this.store.bookmarks())
    if (folder) this.store.setBookmarks([...this.store.bookmarks(), folder])
    return { added, skipped }
  }
  /** A browser's exported passwords file picked and taken in (none picked — undefined). */
  async importPasswords(): Promise<{ added: number; updated: number; skipped: number } | undefined> {
    const r = await pickPasswordsCsv(this.window())
    if (!r) return undefined
    return { ...this.passwordVault.importLogins(r.logins), skipped: r.skipped }
  }

  // ---------- hooks ----------
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
    this.hookSearch.syncAll()
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

  // ---------- «Проверка», «Карта API» ----------
  checkState(): CheckState {
    return this.checkTabs.state()
  }
  checkList(): CheckProblem[] {
    return this.checkTabs.problems()
  }
  checkSet(patch: Partial<CheckSettings>): CheckState {
    return this.checkTabs.set(patch)
  }
  checkClear(ids?: string[]): void {
    this.checkTabs.check.clear(Array.isArray(ids) ? ids.map(String) : undefined)
  }
  checkMute(key: string, on = true): void {
    this.checkTabs.check.mute(String(key), on !== false)
  }
  checkNote(ids: string[], note: string): void {
    this.checkTabs.check.setNote(ids.map(String), String(note))
  }
  checkShow(tabId: string, sel: string): Promise<boolean> {
    return this.checkTabs.show(tabId, sel)
  }
  checkShot(tabId: string): Promise<Uint8Array | undefined> {
    return this.checkTabs.shot(tabId)
  }
  apiMapHosts(): ApiMapHost[] {
    return this.checkTabs.apiMap.hosts()
  }
  apiMapList(host?: string): ApiEndpoint[] {
    return this.checkTabs.apiMapList(host)
  }
  apiMapAuth(url: string): Promise<Array<[string, string]>> {
    return this.checkTabs.apiMapAuth(url)
  }
  apiMapClear(host?: string): void {
    this.checkTabs.apiMap.clear(host)
  }
}
