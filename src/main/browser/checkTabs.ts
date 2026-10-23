import type { ApiEndpoint } from '../../shared/apiMap'
import type { CheckProblem, CheckSettings, CheckState } from '../../shared/check'
import { CHECK_BINDING, CHECK_WORLD, checkPageScript, highlightScript, type PageFinding } from '../../shared/checkPage'
import { AUTH_HEADER } from '../../shared/httpBlock'
import { ApiMapStore } from '../apiMap'
import { CheckWatch } from '../check'
import type { BrowserHost, Tab } from './tab'

/** A request's failure in words: blocked, CORS, the network's error (cut off — said so). */
function failureText(p: Record<string, any>): string {
  return String(p.blockedReason ? `заблокирован: ${p.blockedReason}` : p.corsErrorStatus ? `CORS: ${p.corsErrorStatus.corsError}` : (p.errorText ?? 'ошибка')) + (p.canceled ? ' (canceled)' : '')
}

/**
 * «Проверка» on the tabs: while it is on, every tab awake is watched over the DevTools protocol — its network, its
 * console, its page (a watcher's script in a world of its own) — and what goes wrong goes to the findings; every
 * request of a site goes into its «Карта API». The login a site's requests carry is remembered in memory only.
 */
export class CheckTabs {
  /** «Проверка»: what the watched tabs show wrong. */
  readonly check: CheckWatch
  readonly apiMap: ApiMapStore
  /** Tabs where the watching could not start (their DevTools hold the protocol). */
  private blocked = new Set<string>()
  private timer?: NodeJS.Timeout
  /** The login headers each site's requests carried last (a token, a CSRF guard) — in memory only, never written. */
  private authByHost = new Map<string, Array<[string, string]>>()

  constructor(
    root: string,
    private host: BrowserHost,
  ) {
    this.apiMap = new ApiMapStore(root, () => this.host.emit('apimap', { hosts: this.apiMap.hosts() }))
    this.check = new CheckWatch(root, () => this.changed(), this.apiMap)
    host.cdp.listen('check', (tab, method, p) => this.onCdp(tab, method, p))
  }
  /** A tab closed: its findings' flights and its «could not watch» go. */
  forget(tabId: string): void {
    this.check.dropTab(tabId)
    this.blocked.delete(tabId)
  }
  /** The watching on a tab: on while «Проверка» is on (and the tab awake); its watcher's script as the settings say. */
  async sync(tab: Tab, renew = false): Promise<void> {
    const want = this.check.settings.on && !tab.asleep
    const has = tab.dbg.has('check')
    const d = tab.view.webContents.debugger
    if (!want) {
      if (!has) return
      try {
        if (tab.checkScript) await d.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: tab.checkScript }).catch(() => undefined)
        await d.sendCommand('Runtime.removeBinding', { name: CHECK_BINDING }).catch(() => undefined)
        if (!tab.rec && !tab.dbg.has('hook') && tab.dbg.size > 1) await d.sendCommand('Network.disable').catch(() => undefined)
      } finally {
        tab.checkScript = undefined
        this.host.cdp.drop(tab, 'check')
      }
      return
    }
    if (has && tab.checkScript && !renew) return
    try {
      this.host.cdp.use(tab, 'check')
      this.blocked.delete(tab.t.id)
    } catch {
      // the page's DevTools hold the protocol
      if (!this.blocked.has(tab.t.id)) {
        this.blocked.add(tab.t.id)
        this.changed()
      }
      return
    }
    try {
      await d.sendCommand('Network.enable', { maxTotalBufferSize: 100 * 1024 * 1024, maxResourceBufferSize: 20 * 1024 * 1024, maxPostDataSize: 1024 * 1024 })
      await d.sendCommand('Runtime.enable')
      await d.sendCommand('Page.enable')
      await d.sendCommand('Runtime.addBinding', { name: CHECK_BINDING, executionContextName: CHECK_WORLD })
      const st = this.check.settings
      const on = (k: string) => !st.off.includes(k as never)
      const source = checkPageScript({ loadingMs: st.loadingMs, kinds: { toast: on('toast'), dialog: on('unsaved'), loading: on('loading'), overflow: on('overflow'), hscroll: on('hscroll') } })
      if (tab.checkScript) await d.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: tab.checkScript }).catch(() => undefined)
      tab.checkScript = ((await d.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source, worldName: CHECK_WORLD })) as { identifier: string }).identifier
      // the page already open: its own world now
      const tree = (await d.sendCommand('Page.getFrameTree')) as { frameTree: { frame: { id: string; url: string } } }
      if (/^https?:/i.test(tree.frameTree.frame.url)) {
        const w = (await d.sendCommand('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: CHECK_WORLD })) as { executionContextId: number }
        await d.sendCommand('Runtime.evaluate', { expression: source, contextId: w.executionContextId })
      }
    } catch {
      // the page is going — the next page tries again
    }
  }
  private onCdp(tab: Tab, method: string, p: Record<string, any>): void {
    if (Object.hasOwn(this.cdpHandlers, method)) this.cdpHandlers[method](tab, tab.view.webContents.getURL(), p)
  }
  /** The DevTools events the check listens to: the method → what it does (the tab, its page's address, the event). */
  private readonly cdpHandlers: Record<string, (tab: Tab, page: string, p: Record<string, any>) => void> = {
    'Network.requestWillBeSent': (tab, page, p) => {
      const h = (p.request?.headers ?? {}) as Record<string, string>
      // (the login the page's requests carry — for a request copied into a note)
      const login = Object.entries(h).filter(([k]) => AUTH_HEADER.test(k) && k.toLowerCase() !== 'cookie')
      if (login.length)
        try {
          this.authByHost.set(new URL(String(p.request?.url ?? '')).host, login)
        } catch {
          // (no address)
        }
      this.check.started(tab.t.id, page, String(p.requestId), {
        method: String(p.request?.method ?? 'GET'),
        url: String(p.request?.url ?? ''),
        type: String(p.type ?? ''),
        start: Date.now(),
        postData: p.request?.postData,
        hasPostData: !!p.request?.hasPostData,
        reqType: h['Content-Type'] ?? h['content-type'],
        reqHeaders: h,
      })
    },
    'Network.responseReceived': (tab, _page, p) => this.check.answered(tab.t.id, String(p.requestId), Number(p.response?.status ?? 0), p.response?.mimeType, p.response?.headers),
    'Network.loadingFinished': (tab, page, p) => this.loaded(tab, page, String(p.requestId), undefined),
    'Network.loadingFailed': (tab, page, p) => this.loaded(tab, page, String(p.requestId), failureText(p)),
    'Runtime.executionContextCreated': (tab, _page, p) => {
      if (p.context?.name === CHECK_WORLD) (tab.checkCtx ??= new Set()).add(Number(p.context.id))
    },
    'Runtime.bindingCalled': (tab, page, p) => {
      if (p.name !== CHECK_BINDING) return
      try {
        this.check.page(tab.t.id, page, JSON.parse(String(p.payload)) as PageFinding)
      } catch {
        // not ours
      }
    },
    // (the page's own errors — not the check's script's)
    'Runtime.consoleAPICalled': (tab, page, p) => {
      if (p.type !== 'error' || tab.checkCtx?.has(Number(p.executionContextId))) return
      const text = ((p.args ?? []) as Array<{ value?: unknown; description?: string }>).map((a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description ?? ''))).join(' ')
      const f = p.stackTrace?.callFrames?.[0]
      this.check.console(tab.t.id, page, text, f ? `${f.url}:${f.lineNumber + 1}` : undefined)
    },
    'Runtime.exceptionThrown': (tab, page, p) => {
      if (tab.checkCtx?.has(Number(p.exceptionDetails?.executionContextId))) return
      const e = p.exceptionDetails ?? {}
      this.check.console(tab.t.id, page, String(e.exception?.description ?? e.text ?? 'Исключение'), e.url ? `${e.url}:${(e.lineNumber ?? 0) + 1}` : undefined)
    },
  }
  /** A request done (or failed): the check told, its bodies read from the page when it wants them. */
  private loaded(tab: Tab, page: string, reqId: string, failed: string | undefined): void {
    const d = tab.view.webContents.debugger
    void this.check.finished(tab.t.id, page, reqId, failed, async (needPost, needRes) => {
      const out: { post?: string; res?: string } = {}
      if (!d.isAttached()) return out
      if (needPost) out.post = ((await d.sendCommand('Network.getRequestPostData', { requestId: reqId }).catch(() => ({}))) as { postData?: string }).postData
      if (needRes) {
        const r = (await d.sendCommand('Network.getResponseBody', { requestId: reqId }).catch(() => undefined)) as { body: string; base64Encoded: boolean } | undefined
        if (r) out.res = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body
      }
      return out
    })
  }
  private changed(): void {
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      this.host.emit('check', { state: this.state(), problems: this.check.problems() })
    }, 250)
  }
  state(): CheckState {
    return { settings: this.check.settings, blocked: [...this.blocked] }
  }
  set(patch: Partial<CheckSettings>): CheckState {
    const before = JSON.stringify(this.check.settings)
    this.check.setSettings(patch)
    // on / off, or the page's watcher told other things — every tab follows
    if (JSON.stringify(this.check.settings) !== before) for (const t of this.host.tabs.values()) void this.sync(t, true)
    return this.state()
  }
  problems(): CheckProblem[] {
    return this.check.problems()
  }
  /** The element of a finding shown on its page (the tab made current by the window). */
  async show(tabId: string, sel: string): Promise<boolean> {
    const t = this.host.tabs.get(tabId)
    if (!t || t.asleep) return false
    return !!(await t.view.webContents.executeJavaScript(highlightScript(String(sel)), true).catch(() => false))
  }
  /** The tab's page as it is now (PNG). */
  async shot(tabId: string): Promise<Uint8Array | undefined> {
    const t = this.host.tabs.get(tabId)
    if (!t || t.asleep) return undefined
    const img = await t.view.webContents.capturePage()
    return img.isEmpty() ? undefined : new Uint8Array(img.toPNG())
  }

  // ---------- «Карта API» ----------
  apiMapList(host?: string): ApiEndpoint[] {
    return this.apiMap.list(host)
  }
  /** The site's login as its requests carried it (token headers — the latest seen) and the session's cookies for it. */
  async apiMapAuth(url: string): Promise<Array<[string, string]>> {
    let host = ''
    try {
      host = new URL(url).host
    } catch {
      return []
    }
    const out = [...(this.authByHost.get(host) ?? [])].filter(([k]) => k.toLowerCase() !== 'cookie')
    // the cookies the browser would send there now (the session's own)
    const cookies = await this.host.ses.cookies.get({ url }).catch(() => [])
    if (cookies.length) out.push(['Cookie', cookies.map((c) => `${c.name}=${c.value}`).join('; ')])
    return out
  }
}
