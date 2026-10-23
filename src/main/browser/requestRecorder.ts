import { recSummary, type RecFull, type RecItem, type RecState } from '../../shared/browser'
import type { BrowserHost, Tab } from './tab'

const MAX_REC = 3000
const MAX_BODY = 1024 * 1024
/** All the answers' texts kept, at most — the oldest lose theirs first. */
const MAX_BODIES = 150 * 1024 * 1024

interface Pending {
  item: RecFull
  started: number
  hasPostData?: boolean
}

/**
 * The recording of the requests the pages send: it listens to them over the DevTools protocol — only XHR / fetch
 * (and, if asked, the documents), with the real headers (cookies too), the body and the answer. The list goes to the
 * window at most 5 times a second.
 */
export class RequestRecorder {
  private on = false
  private docs = false
  private items: RecFull[] = []
  private pending = new Map<string, Pending>()
  /** The real headers that came before their request. */
  private extras = new Map<string, Array<[string, string]>>()
  private seq = 0
  private bodyBytes = 0
  private timer?: NodeJS.Timeout

  constructor(private host: BrowserHost) {
    host.cdp.listen('rec', (tab, method, p) => this.onCdp(tab, method, p))
  }
  /** Recording now (every tab awake listens). */
  get recording(): boolean {
    return this.on
  }
  state(): RecState {
    return { on: this.on, documents: this.docs, count: this.items.length }
  }
  set(on: boolean, documents?: boolean): RecState {
    if (documents !== undefined) this.docs = documents
    if (on !== this.on) {
      this.on = on
      for (const t of this.host.tabs.values()) if (!t.asleep) void (on ? this.attach(t) : this.detach(t))
    }
    this.changed()
    return this.state()
  }
  clear(): void {
    this.items = []
    this.pending.clear()
    this.extras.clear()
    this.bodyBytes = 0
    this.seq = 0
    this.changed()
  }
  list(): RecItem[] {
    return this.items.map(recSummary)
  }
  full(ids: string[]): RecFull[] {
    return ids.map((id) => this.items.find((x) => x.id === id)).filter((x): x is RecFull => !!x)
  }
  /** A tab starts recording (its page's network listened to). */
  async attach(tab: Tab): Promise<void> {
    if (tab.rec) return
    try {
      const d = this.host.cdp.use(tab, 'rec')
      tab.rec = true
      await d.sendCommand('Network.enable', { maxPostDataSize: 1024 * 1024 })
    } catch (e) {
      tab.rec = false
      this.host.cdp.drop(tab, 'rec')
      this.host.emit('recError', `Вкладка «${tab.t.title}»: запись не включилась — ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  private detach(tab: Tab): void {
    if (!tab.rec) return
    tab.rec = false
    // the device mode stays: only the network goes quiet
    if (tab.dbg.size > 1 && !tab.dbg.has('hook') && !tab.dbg.has('check')) void tab.view.webContents.debugger.sendCommand('Network.disable').catch(() => undefined)
    this.host.cdp.drop(tab, 'rec')
  }
  private onCdp(tab: Tab, method: string, p: Record<string, unknown>): void {
    if (!this.on) return
    if (Object.hasOwn(this.cdpHandlers, method)) this.cdpHandlers[method](tab, `${tab.t.id}:${String(p.requestId)}`, p)
  }
  /** The network events the recording follows: the method → what it does (`id` — the tab's and the request's). */
  private readonly cdpHandlers: Record<string, (tab: Tab, id: string, p: Record<string, unknown>) => void> = {
    'Network.requestWillBeSent': (tab, id, p) => this.onRequest(tab, id, p),
    // the headers as really sent (cookies included) — may come before the request itself
    'Network.requestWillBeSentExtraInfo': (_tab, id, p) => {
      const headers = Object.entries((p.headers as Record<string, string>) ?? {})
      const pend = this.pending.get(id)
      if (pend) pend.item.reqHeaders = headers
      else {
        // (most belong to files — never asked for; the map is kept small)
        if (this.extras.size > 500) this.extras.clear()
        this.extras.set(id, headers)
      }
    },
    'Network.responseReceived': (_tab, id, p) => {
      const item = this.pending.get(id)?.item
      if (!item) return
      const r = p.response as { status: number; headers: Record<string, string>; mimeType: string }
      item.status = r.status
      item.resHeaders = Object.entries(r.headers ?? {})
      item.mimeType = r.mimeType
      this.changed()
    },
    'Network.loadingFinished': (tab, id, p) => this.ended(tab, id, p, true, (item) => (item.size = Number(p.encodedDataLength ?? 0))),
    'Network.loadingFailed': (tab, id, p) => this.ended(tab, id, p, false, (item) => (item.error = String(p.errorText ?? 'ошибка'))),
  }
  /** A request listed done (`loaded`) or failed: its time, what `fill` says; its bodies taken (the sent one — only when it loaded). */
  private ended(tab: Tab, id: string, p: Record<string, unknown>, loaded: boolean, fill: (item: RecFull) => void): void {
    const pend = this.pending.get(id)
    if (!pend) return
    const item = pend.item
    this.pending.delete(id)
    item.ms = Date.now() - pend.started
    fill(item)
    void this.takeBodies(tab, String(p.requestId), item, pend.hasPostData && loaded)
    this.changed()
  }
  /** A request sent: listed if it is one recorded (XHR / fetch, a document if asked; http only). */
  private onRequest(tab: Tab, id: string, p: Record<string, unknown>): void {
    const type = String(p.type ?? '')
    const req = p.request as { url: string; method: string; headers: Record<string, string>; postData?: string; hasPostData?: boolean }
    // a redirect of one already listed: the page asked for the first one
    if (this.pending.has(id) || this.items.some((x) => x.id === id)) return
    if (!(type === 'XHR' || type === 'Fetch' || (this.docs && type === 'Document'))) return
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
    // (a request that never ends — a long poll, server events — never leaves the map: the oldest go past a limit)
    if (this.pending.size > 2000) for (const k of [...this.pending.keys()].slice(0, 500)) this.pending.delete(k)
    this.pending.set(id, { item, started: Date.now(), hasPostData: req.hasPostData && req.postData === undefined })
    this.items.push(item)
    // the oldest go beyond the limit
    while (this.items.length > MAX_REC) {
      const old = this.items.shift()!
      this.bodyBytes -= old.resBody?.length ?? 0
    }
    this.changed()
  }
  /** The body sent (when the event did not carry it) and the answer's text (JSON, text — not files). */
  private async takeBodies(tab: Tab, reqId: string, item: RecFull, needPost?: boolean): Promise<void> {
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
      for (const old of this.items) {
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
  private changed(): void {
    // the list goes to the window at most 5 times a second
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      this.host.emit('rec', { state: this.state(), items: this.list() })
    }, 200)
  }
}
