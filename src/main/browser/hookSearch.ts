import type { Hooks } from '../hooks'
import type { BrowserHost, Tab } from './tab'

/**
 * The hooks' search listens to the pages of their sites: the protocol on a page while some hook of its site looks
 * into its answers (off otherwise); each answer's body taken at once and offered to the search (its own process).
 */
export class HookSearch {
  constructor(
    private host: BrowserHost,
    private hooks: Hooks,
  ) {
    host.cdp.listen('hook', (tab, method, p) => this.onCdp(tab, method, p))
  }
  /** Every tab follows (a hook changed, the search paused or not). */
  syncAll(): void {
    for (const t of this.host.tabs.values()) this.sync(t)
  }
  /** The protocol on a page while some hook of its site looks into its answers; off otherwise. */
  sync(tab: Tab, url = tab.view.webContents.getURL()): void {
    if (tab.asleep) return
    const want = this.hooks.searching(url)
    const has = tab.dbg.has('hook')
    if (want && !has) {
      try {
        const d = this.host.cdp.use(tab, 'hook')
        tab.hookReq = new Map()
        void d.sendCommand('Network.enable', { maxTotalBufferSize: 200 * 1024 * 1024, maxResourceBufferSize: 100 * 1024 * 1024 }).catch(() => undefined)
      } catch {
        // DevTools of the page are open in another way — no search there
      }
    } else if (!want && has) {
      tab.hookReq = undefined
      if (!tab.rec && !tab.dbg.has('check') && tab.dbg.size > 1) void tab.view.webContents.debugger.sendCommand('Network.disable').catch(() => undefined)
      this.host.cdp.drop(tab, 'hook')
    }
  }
  private onCdp(tab: Tab, method: string, p: Record<string, any>): void {
    const reqs = tab.hookReq
    if (reqs && Object.hasOwn(this.cdpHandlers, method)) this.cdpHandlers[method](tab, reqs, p)
  }
  /** The network events the search follows: the method → what it does to the tab's known requests. */
  private readonly cdpHandlers: Record<string, (tab: Tab, reqs: NonNullable<Tab['hookReq']>, p: Record<string, any>) => void> = {
    'Network.requestWillBeSent': (_tab, reqs, p) => {
      if (reqs.size > 5000) reqs.clear()
      reqs.set(p.requestId, { url: p.request?.url, method: p.request?.method, type: p.type })
    },
    'Network.responseReceived': (tab, reqs, p) => {
      const r = reqs.get(p.requestId)
      if (r) Object.assign(r, { type: p.type ?? r.type, mime: p.response?.mimeType, status: p.response?.status })
      // its request went before the listening began: known by its answer
      else reqs.set(p.requestId, { url: p.response?.url, method: 'GET', type: p.type, mime: p.response?.mimeType, status: p.response?.status })
      if (p.type === 'Document') tab.hookDoc = p.requestId
    },
    'Network.loadingFinished': (tab, _reqs, p) => {
      if (tab.hookDoc === p.requestId) tab.hookDoc = undefined
      this.take(tab, p.requestId)
    },
    'Network.loadingFailed': (_tab, reqs, p) => reqs.delete(p.requestId),
  }
  /** The page has loaded: its own HTML (Chromium tells no «loadingFinished» for it) offered now. */
  pageLoaded(tab: Tab): void {
    const id = tab.hookDoc
    tab.hookDoc = undefined
    if (id && tab.dbg.has('hook')) this.take(tab, id)
  }
  /** An answer's body taken (at once — the page may forget it) and offered to the hooks' search. */
  private take(tab: Tab, requestId: string): void {
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
}
