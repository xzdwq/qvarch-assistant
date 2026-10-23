import { ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { apiPath } from '../../shared/apiMap'
import type { BrowserTab, DeviceMode, PwRecState } from '../../shared/browser'
import type { BrowserHost, Tab } from './tab'

/** A JS string literal in single quotes (an address in a scenario's line). */
const quoted = (x: string) => x.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
/** A line's code without its step's words (the same click described twice is the same click). */
const bare = (x?: string) => (x ?? '').replace(/\s*\/\/ шаг: .*$/, '')

interface Recording {
  note: string
  key: string
  tabId: string
  url: string
  lines: string[]
  stopping?: boolean
  at?: string
  device?: boolean
  /** Files just picked: the request that carries them is looked for in the tab's traffic (its line gets the binding). */
  uploads?: Array<{ line: string; names: string[]; heads: Buffer[]; at: number }>
}

/**
 * A Playwright scenario recorded in a tab (one at a time, for a note's block): the page's preload says what was
 * clicked and typed, this keeps the lines — the address typed, the waits after a navigation, the files picked (kept
 * with the notebook, their upload's request found in the tab's traffic).
 */
export class ScenarioRecorder {
  private r?: Recording
  /** Files picked while recording → kept with the notebook; their «Набор/файл» back (index.ts sets it). */
  onRecordFiles?: (paths: string[]) => string[]

  constructor(
    private host: BrowserHost,
    /** The tab as a device (undefined — as itself). */
    private device: (id: string, d?: DeviceMode) => void,
  ) {
    host.cdp.listen('pw', (tab, method, p) => this.onCdp(tab, method, p))
    // a page of the recording tab (each new one asks): recording or not, how many lines so far
    ipcMain.handle('qa:pwrec-get', (e) => {
      const t = this.host.byContents(e.sender)
      return t && this.r?.tabId === t.t.id ? { on: true, count: this.r.lines.length } : null
    })
    ipcMain.on('qa:pwrec-act', (e, a: { code?: unknown; replace?: unknown; files?: { how?: unknown; loc?: unknown; paths?: unknown; where?: unknown; opener?: unknown } }) => {
      const t = this.host.byContents(e.sender)
      const r = this.r
      if (!t || !r || r.tabId !== t.t.id || typeof a?.code !== 'string' || a.code.length > 2000) return
      // files picked / dropped: kept with the notebook, the line names them there (a replay needs no window of the system's)
      if (a.files && typeof a.files.loc === 'string' && Array.isArray(a.files.paths) && a.files.paths.length) return this.onFiles(r, a.files as { how?: unknown; loc: string; paths: unknown[]; where?: unknown; opener?: unknown })
      // a double click: the clicks it was made of go
      if (typeof a.replace === 'string') for (let i = 0; i < 2 && bare(r.lines[r.lines.length - 1]) === bare(a.replace); i++) r.lines.pop()
      // the same line twice in a row (a click caught twice) — once
      else if (bare(r.lines[r.lines.length - 1]) === bare(a.code)) return
      r.lines.push(a.code)
      r.at ??= t.view.webContents.getURL()
      this.told()
    })
  }
  private told(): void {
    this.host.emit('pwrec', this.state())
  }
  /** Files picked / dropped while recording: kept with the notebook, their line names them there. */
  private onFiles(r: Recording, f: { how?: unknown; loc: string; paths: unknown[]; where?: unknown; opener?: unknown }): void {
    const rels = this.onRecordFiles?.(f.paths.map(String)) ?? []
    if (!rels.length) return
    const arg = rels.length === 1 ? `qa.file('${rels[0]}')` : `[${rels.map((x) => `qa.file('${x}')`).join(', ')}]`
    const names = rels.map((x) => `«${x.split('/').pop()}»`).join(', ')
    // (a hidden file field has no words of its own — «поле редактирования» says nothing)
    const where = /^(поле( редактирования| без подписи)?|область загрузки)$/i.test(String(f.where ?? '').trim()) ? '' : String(f.where ?? '').slice(0, 80)
    // the click that opened the system's window — it is what the files replace
    if (f.opener && /\.click\(\)/.test(r.lines[r.lines.length - 1] ?? '')) r.lines.pop()
    const heads = f.paths.map((p) => {
      try {
        return readFileSync(String(p)).subarray(0, 64)
      } catch {
        return Buffer.alloc(0)
      }
    })
    const what = rels.length > 1 ? 'файлы' : 'файл'
    const upLine = f.how === 'drop' ? `await qa.dropFiles(${f.loc}, ${arg}) // шаг: Перетащить ${what} ${names} в ${where}` : `await ${f.loc}.setInputFiles(${arg}) // шаг: Загрузить ${what} ${names}${where ? ` в ${where}` : ''}`
    r.lines.push(upLine)
    ;(r.uploads ??= []).push({ line: upLine, names: f.paths.map((p) => basename(String(p))), heads, at: Date.now() })
    this.told()
  }
  /** The recording tab's requests watched: an upload's request is known by the file it carries. */
  private watchNet(id: string): void {
    const tab = this.host.tabs.get(id)
    if (!tab || tab.asleep) return
    try {
      void this.host.cdp.use(tab, 'pw').sendCommand('Network.enable', { maxPostDataSize: 4 * 1024 * 1024 }).catch(() => undefined)
    } catch {
      // the page's DevTools hold the protocol: no binding, the run finds the request by the file's content
    }
  }
  /**
   * A request of the recording tab: one carrying a file just picked (its name in a multipart part, or its first
   * bytes) — the upload's request; its endpoint goes under the upload's line («// загрузка → POST /api/…»), so a run
   * knows which request its result rests on.
   */
  private onCdp(tab: Tab, method: string, p: Record<string, any>): void {
    const r = this.r
    if (method !== 'Network.requestWillBeSent' || !r || r.tabId !== tab.t.id || !r.uploads?.length) return
    const req = p.request as { method?: string; url?: string; postData?: string; hasPostData?: boolean } | undefined
    if (!req?.method || !/^(POST|PUT|PATCH)$/i.test(req.method) || !req.url) return
    const look = (body: string | undefined) => {
      if (!body || !r.uploads?.length) return
      const bytes = Buffer.from(body, 'latin1')
      const utf = Buffer.from(body, 'utf8')
      const u = r.uploads.find((x) => Date.now() - x.at < 120_000 && (x.names.some((n) => body.includes(`filename="${n}"`)) || x.heads.some((h) => h.length >= 16 && (bytes.includes(h) || utf.includes(h)))))
      if (!u) return
      r.uploads = r.uploads.filter((x) => x !== u)
      const at = r.lines.lastIndexOf(u.line)
      if (at < 0) return
      r.lines.splice(at + 1, 0, `// загрузка → ${req.method!.toUpperCase()} ${apiPath(req.url!).path}`)
      this.told()
    }
    if (req.postData !== undefined) look(req.postData)
    else if (req.hasPostData) void tab.view.webContents.debugger.sendCommand('Network.getRequestPostData', { requestId: p.requestId }).then((x: { postData?: string }) => look(x.postData), () => undefined)
  }
  state(): PwRecState | undefined {
    const r = this.r
    return r ? { note: r.note, key: r.key, tabId: r.tabId, count: r.lines.length, last: r.lines[r.lines.length - 1] } : undefined
  }
  /** The tab being recorded in (none — no recording). */
  get tabId(): string | undefined {
    return this.r?.tabId
  }
  /** The recording tab's page tells its preload to record (not while the recording stops). */
  recordsIn(tabId: string): boolean {
    return this.r?.tabId === tabId && !this.r.stopping
  }
  start(note: string, key: string, url: string, screen?: { w: number; h: number }): BrowserTab {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('Адрес должен начинаться с http:// или https://')
    if (this.r) void this.stop(true)
    // the recording tab is the one shown — the clicks go there: a tab at this very address already (as it is
    // now, not reloaded), else a new one
    const same = (a: string) => a.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
    const open = [...this.host.tabs.values()].find((x) => same(x.asleep ? x.t.url : x.view.webContents.getURL() || x.t.url) === same(url))
    let t: BrowserTab
    if (open) {
      this.host.wake(open)
      t = open.t
      this.host.emit('activate', { id: t.id })
    } else t = this.host.open(url)
    this.watchNet(t.id)
    this.r = { note: String(note), key: String(key), tabId: t.id, url, lines: [`await page.goto('${quoted(url)}')`] }
    // the page is laid out by its window's size in CSS px (the zoom changes it: 80% — a wider page): the scenario
    // gets the same window, else another layout and its elements elsewhere
    const rec = this.r
    const tab = this.host.tabs.get(t.id)
    // a scenario for a screen of its own: the tab in the device mode of that size, the window line from it
    if (screen && screen.w > 0 && screen.h > 0) {
      const w = Math.round(screen.w)
      const h = Math.round(screen.h)
      this.device(t.id, { name: `${w} px`, w, h, dpr: 1, mobile: false })
      rec.device = true
      rec.lines.unshift(`await qa.window({ width: ${w}, height: ${h}, dpr: 1 }) // шаг: Окно браузера ${w}×${h} (экран ${w} px)`)
    } else if (tab && !tab.asleep)
      void tab.view.webContents
        .executeJavaScript('[innerWidth, innerHeight, devicePixelRatio]', true)
        .then(([w, h, dpr]: [number, number, number]) => {
          if (this.r !== rec || !(w > 0 && h > 0)) return
          const d = Math.round((dpr || 1) * 100) / 100
          rec.lines.unshift(`await qa.window({ width: ${Math.round(w)}, height: ${Math.round(h)}, dpr: ${d} }) // шаг: Окно браузера ${Math.round(w)}×${Math.round(h)}, масштаб при записи ${tab.t.zoom || 100}%`)
          this.told()
        })
        .catch(() => undefined)
    // a page already loaded asks no more: it is told
    if (open && !open.asleep && !open.view.webContents.isLoading()) open.view.webContents.send('qa:pwrec', true)
    this.told()
    return t
  }
  async stop(cancel = false): Promise<{ note: string; key: string; url: string; lines: string[] } | undefined> {
    const r = this.r
    if (!r || r.stopping) return undefined
    const t = this.host.tabs.get(r.tabId)
    // the page writes down what it has not yet (typing, a click still being looked at) — a moment for it
    if (!cancel && t && !t.asleep) {
      r.stopping = true
      t.view.webContents.send('qa:pwrec-flush')
      await new Promise((ok) => setTimeout(ok, 800))
    }
    this.r = undefined
    if (t && !t.asleep) t.view.webContents.send('qa:pwrec', false)
    if (t && !t.asleep) this.host.cdp.drop(t, 'pw')
    // the screen it was recorded for: the tab back to itself
    if (r.device && t) this.device(t.t.id)
    this.host.emit('pwrec', undefined)
    return cancel ? undefined : { note: r.note, key: r.key, url: r.url, lines: r.lines }
  }
  /** An address typed in the recording tab: a line of its own. */
  onAddressTyped(tabId: string, url: string): void {
    if (this.r?.tabId !== tabId || !/^https?:/i.test(url)) return
    this.r.lines.push(`await page.goto('${quoted(url)}')`)
    this.told()
  }
  /** The recording tab went to another address after an action: the scenario waits for it there too. */
  onNavigated(tab: Tab, url: string): void {
    const r = this.r
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
    // the path changed — waited for by it; the same path, other parameters (a card of a list) — by the whole address
    if (u.pathname !== p.pathname && u.pathname !== '/') r.lines.push(`await page.waitForURL('**${quoted(u.pathname)}**')`)
    else r.lines.push(`await page.waitForURL((url) => url.href.includes('${quoted(u.pathname + u.search + u.hash)}'))`)
    this.told()
  }
}
