import { ipcMain, webContents, type WebContents } from 'electron'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { apiPath } from '../../shared/apiMap'
import { sameAddress } from '../../shared/browser/scenarioAddress'
import type { BrowserTab, DeviceMode, PwRecState } from '../../shared/browser'
import { guestSurface, tabSurface, type RecSurface } from './recSurface'
import type { BrowserHost } from './tab'

/** A JS string literal in single quotes (an address in a scenario's line). */
const quoted = (x: string) => x.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
/** A line's code without its step's words (the same click described twice is the same click). */
const bare = (x?: string) => (x ?? '').replace(/\s*\/\/ шаг: .*$/, '')

interface Recording {
  note: string
  key: string
  where: RecSurface
  url: string
  lines: string[]
  stopping?: boolean
  at?: string
  device?: boolean
  /** Files just picked: the request that carries them is looked for in the page's traffic (its line gets the binding). */
  uploads?: Array<{ line: string; names: string[]; heads: Buffer[]; at: number }>
}

/**
 * A Playwright scenario recorded (one at a time, for a note's block) in a tab of the Браузер or in a browser of a
 * note: the page's preload says what was clicked and typed, this keeps the lines — the address typed, the waits
 * after a navigation, the files picked (kept with the notebook, their upload's request found in the page's traffic).
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
    // a page recorded in (each new one asks): recording or not, how many lines so far
    ipcMain.handle('qa:pwrec-get', (e) => (this.recordsIn(e.sender) ? { on: true, count: this.r!.lines.length } : null))
    ipcMain.on('qa:pwrec-act', (e, a: { code?: unknown; replace?: unknown; files?: { how?: unknown; loc?: unknown; paths?: unknown; where?: unknown; opener?: unknown } }) => {
      const r = this.r
      if (!r || r.where.contents() !== e.sender || typeof a?.code !== 'string' || a.code.length > 2000) return
      // files picked / dropped: kept with the notebook, the line names them there (a replay needs no window of the system's)
      if (a.files && typeof a.files.loc === 'string' && Array.isArray(a.files.paths) && a.files.paths.length) return this.onFiles(r, a.files as { how?: unknown; loc: string; paths: unknown[]; where?: unknown; opener?: unknown })
      // a double click: the clicks it was made of go
      if (typeof a.replace === 'string') for (let i = 0; i < 2 && bare(r.lines[r.lines.length - 1]) === bare(a.replace); i++) r.lines.pop()
      // the same line twice in a row (a click caught twice) — once
      else if (bare(r.lines[r.lines.length - 1]) === bare(a.code)) return
      r.lines.push(a.code)
      r.at ??= e.sender.getURL()
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
  /**
   * A request of the page recorded in: one carrying a file just picked (its name in a multipart part, or its first
   * bytes) — the upload's request; its endpoint goes under the upload's line («// загрузка → POST /api/…»), so a run
   * knows which request its result rests on.
   */
  private onNet(r: Recording, method: string, p: Record<string, any>): void {
    if (method !== 'Network.requestWillBeSent' || this.r !== r || !r.uploads?.length) return
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
    else if (req.hasPostData) void r.where.send('Network.getRequestPostData', { requestId: p.requestId }).then((x) => look((x as { postData?: string }).postData), () => undefined)
  }
  state(): PwRecState | undefined {
    const r = this.r
    return r ? { note: r.note, key: r.key, tabId: r.where.tabId, in: r.where.name, count: r.lines.length, last: r.lines[r.lines.length - 1] } : undefined
  }
  /** The tab being recorded in (none — no recording, or one in a note's browser). */
  get tabId(): string | undefined {
    return this.r?.where.tabId
  }
  /** This page records (not while the recording stops). */
  recordsIn(wc: WebContents): boolean {
    return !!this.r && !this.r.stopping && this.r.where.contents() === wc
  }
  /** A page of the place recorded in is ready: it is told to record (each page of it records, not only the first). */
  onDomReady(wc: WebContents): void {
    if (this.recordsIn(wc)) wc.send('qa:pwrec', true)
  }
  /** Recording in a tab of the Браузер: at this address (a tab there already — as it is now, else a new one). */
  start(note: string, key: string, url: string, screen?: { w: number; h: number }): BrowserTab {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('Адрес должен начинаться с http:// или https://')
    if (this.r) void this.stop(true)
    // the recording tab is the one shown — the clicks go there: a tab at this very address already (as it is
    // now, not reloaded), else a new one
    const open = [...this.host.tabs.values()].find((x) => sameAddress(x.asleep ? x.t.url : x.view.webContents.getURL() || x.t.url, url))
    let t: BrowserTab
    if (open) {
      this.host.wake(open)
      t = open.t
      this.host.emit('activate', { id: t.id })
    } else t = this.host.open(url)
    const rec = this.begin(note, key, url, tabSurface(this.host, t.id))
    // a scenario for a screen of its own: the tab in the device mode of that size, the window line from it
    if (screen && screen.w > 0 && screen.h > 0) {
      const w = Math.round(screen.w)
      const h = Math.round(screen.h)
      this.device(t.id, { name: `${w} px`, w, h, dpr: 1, mobile: false })
      rec.device = true
      rec.lines.unshift(`await qa.window({ width: ${w}, height: ${h}, dpr: 1 }) // шаг: Окно браузера ${w}×${h} (экран ${w} px)`)
    } else this.windowLine(rec, `масштаб при записи ${this.host.tabs.get(t.id)?.t.zoom || 100}%`)
    // a page already loaded asks no more: it is told
    if (open && !open.asleep && !open.view.webContents.isLoading()) open.view.webContents.send('qa:pwrec', true)
    this.told()
    return t
  }
  /**
   * Recording in a browser of a note (its tab shown, `wcId` — a webview of the window that asks): from the page it
   * is at now, as it is.
   */
  startIn(sender: WebContents, note: string, key: string, wcId: number, name: string): void {
    const g = webContents.fromId(Number(wcId))
    if (!g || g.isDestroyed() || g.getType() !== 'webview' || g.hostWebContents !== sender) throw new Error(`Браузер «${name}» в заметке не найден — он должен быть открыт на экране`)
    const url = g.getURL()
    if (!/^https?:\/\//i.test(url)) throw new Error(`В браузере «${name}» не открыт сайт — откройте страницу, с которой начать`)
    if (this.r) void this.stop(true)
    const rec = this.begin(note, key, url, guestSurface(g, String(name)))
    this.windowLine(rec, 'браузер в заметке')
    if (!g.isLoading()) g.send('qa:pwrec', true)
    this.told()
  }
  private begin(note: string, key: string, url: string, where: RecSurface): Recording {
    const rec: Recording = { note: String(note), key: String(key), where, url, lines: [`await page.goto('${quoted(url)}')`] }
    this.r = rec
    where.watchNet((method, p) => this.onNet(rec, method, p))
    return rec
  }
  /**
   * The window's line: the page is laid out by its window's size in CSS px (the zoom changes it: 80% — a wider
   * page) — the scenario gets the same window, else another layout and its elements elsewhere.
   */
  private windowLine(rec: Recording, how: string): void {
    void rec.where
      .contents()
      ?.executeJavaScript('[innerWidth, innerHeight, devicePixelRatio]', true)
      .then(([w, h, dpr]: [number, number, number]) => {
        if (this.r !== rec || !(w > 0 && h > 0)) return
        const d = Math.round((dpr || 1) * 100) / 100
        rec.lines.unshift(`await qa.window({ width: ${Math.round(w)}, height: ${Math.round(h)}, dpr: ${d} }) // шаг: Окно браузера ${Math.round(w)}×${Math.round(h)}, ${how}`)
        this.told()
      })
      .catch(() => undefined)
  }
  async stop(cancel = false): Promise<{ note: string; key: string; url: string; lines: string[] } | undefined> {
    const r = this.r
    if (!r || r.stopping) return undefined
    const wc = r.where.contents()
    // the page writes down what it has not yet (typing, a click still being looked at) — a moment for it
    if (!cancel && wc) {
      r.stopping = true
      wc.send('qa:pwrec-flush')
      await new Promise((ok) => setTimeout(ok, 800))
    }
    this.r = undefined
    if (wc && !wc.isDestroyed()) wc.send('qa:pwrec', false)
    r.where.end()
    // the screen it was recorded for: the tab back to itself
    if (r.device && r.where.tabId) this.device(r.where.tabId)
    this.host.emit('pwrec', undefined)
    return cancel ? undefined : { note: r.note, key: r.key, url: r.url, lines: r.lines }
  }
  /** An address typed in the recording tab: a line of its own. */
  onAddressTyped(tabId: string, url: string): void {
    if (!this.r || this.r.where.tabId !== tabId || !/^https?:/i.test(url)) return
    this.r.lines.push(`await page.goto('${quoted(url)}')`)
    this.told()
  }
  /** The page recorded in went to another address after an action: the scenario waits for it there too. */
  onNavigated(wc: WebContents, url: string): void {
    const r = this.r
    if (!r || r.stopping || r.where.contents() !== wc || !/^https?:/i.test(url)) return
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
