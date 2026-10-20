import { utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isTextual, newHook, resType, siteMatch, type BrowserHook, type HookHit, type HookResType, type HookStatus } from '../shared/hooks'

/**
 * The Браузер's hooks: kept in data/browser-hooks.json (the hooks and what they found). A page of a hook's site
 * gets its CSS and its JS; with the search on, the page's answers of the chosen types are taken (as they come)
 * and looked into by a process of its own, one at a time — the queue, the current one, «Пропустить», «Стоп».
 */
const MAX_HITS = 500
const MAX_QUEUE_BYTES = 300 * 1024 * 1024
/** One answer longer than this is given up (a catastrophic regular expression). */
const ITEM_SEC = 30

interface Item {
  id: string
  hookId: string
  url: string
  method: string
  type: HookResType
  status?: number
  size: number
  body: string
}

export class Hooks {
  private file: string
  private data: { hooks: BrowserHook[]; hits: Record<string, HookHit[]> }
  private queue: Item[] = []
  private queuedBytes = 0
  private cur?: Item & { done: number; timer?: NodeJS.Timeout; skipTimer?: NodeJS.Timeout }
  private worker?: UtilityProcess
  private st = { paused: false, scanned: 0, skipped: 0, hits: 0, note: undefined as string | undefined }
  private saveTimer?: NodeJS.Timeout
  private statusTimer?: NodeJS.Timeout

  constructor(
    root: string,
    private workerPath: string,
    private emit: (type: string, payload: unknown) => void,
  ) {
    this.file = join(root, 'browser-hooks.json')
    try {
      const d = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Partial<typeof this.data>) : {}
      this.data = { hooks: Array.isArray(d.hooks) ? d.hooks : [], hits: d.hits && typeof d.hits === 'object' ? d.hits : {} }
    } catch {
      this.data = { hooks: [], hits: {} }
    }
  }
  private save(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data))
      renameSync(`${this.file}.tmp`, this.file)
    }, 500)
  }

  // ---------- the hooks ----------
  list(): BrowserHook[] {
    return this.data.hooks
  }
  /** Saved (a new one gets an id). */
  put(h: Partial<BrowserHook>): BrowserHook {
    const was = this.data.hooks.find((x) => x.id === h.id)
    const base = was ?? newHook(randomUUID(), String(h.site ?? ''))
    const next: BrowserHook = {
      ...base,
      ...h,
      id: base.id,
      name: String(h.name ?? base.name).slice(0, 200),
      site: String(h.site ?? base.site).trim().slice(0, 300),
      css: String(h.css ?? base.css).slice(0, 200_000),
      js: String(h.js ?? base.js).slice(0, 500_000),
      search: { ...base.search, ...(h.search ?? {}), maxMb: Math.min(200, Math.max(1, Number(h.search?.maxMb ?? base.search.maxMb) || 20)) },
    }
    if (was) this.data.hooks[this.data.hooks.indexOf(was)] = next
    else this.data.hooks.push(next)
    this.save()
    this.emit('hooks', this.data.hooks)
    return next
  }
  remove(id: string): void {
    this.data.hooks = this.data.hooks.filter((h) => h.id !== id)
    delete this.data.hits[id]
    this.queue = this.queue.filter((q) => q.hookId !== id)
    this.save()
    this.emit('hooks', this.data.hooks)
    this.status()
  }
  hits(id: string): HookHit[] {
    return this.data.hits[id] ?? []
  }
  clearHits(id: string): void {
    delete this.data.hits[id]
    this.save()
    this.emit('hookHits', { hookId: id, hits: [] })
  }
  /** The hooks of a page (on). */
  forUrl(url: string): BrowserHook[] {
    return this.data.hooks.filter((h) => h.on && siteMatch(h.site, url))
  }
  /** Some hook of this page looks into its answers. */
  searching(url: string): boolean {
    return !this.st.paused && this.forUrl(url).some((h) => h.search.on && !!h.search.query && h.search.types.length > 0)
  }

  /** A page of a hook's site is ready: its CSS, its JS (in the page itself, as its own script would). */
  apply(wc: WebContents): void {
    const url = wc.getURL()
    for (const h of this.forUrl(url)) {
      if (h.css.trim()) void wc.insertCSS(h.css).catch(() => undefined)
      if (h.js.trim()) {
        const code = `try { (function () {\n${h.js}\n})() } catch (e) { console.error('[хук «${h.name.replace(/['\\\n]/g, ' ')}»]', e) }`
        void wc.executeJavaScript(code, true).catch(() => undefined)
      }
    }
  }

  // ---------- the search ----------
  /** An answer came (its body taken already): queued for every searching hook of the page whose types it fits. */
  offer(pageUrl: string, r: { url: string; method: string; cdpType?: string; mime?: string; status?: number; body: string; base64: boolean }): void {
    if (this.st.paused || r.base64) return
    const type = resType(r.cdpType, r.mime)
    if (!isTextual(r.mime ?? '', type)) return
    for (const h of this.forUrl(pageUrl)) {
      const s = h.search
      if (!s.on || !s.query || !s.types.includes(type)) continue
      if (s.urlHas && !r.url.includes(s.urlHas)) continue
      const size = r.body.length
      if (size > s.maxMb * 1024 * 1024) {
        this.st.skipped++
        this.st.note = `Пропущен (больше ${s.maxMb} МБ): ${r.url}`
        continue
      }
      if (this.queuedBytes + size > MAX_QUEUE_BYTES) {
        this.st.skipped++
        this.st.note = 'Очередь переполнена — ответы пропускаются, пока она не разберётся'
        continue
      }
      this.queue.push({ id: randomUUID(), hookId: h.id, url: r.url, method: r.method, type, status: r.status, size, body: r.body })
      this.queuedBytes += size
    }
    this.status()
    this.next()
  }
  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker
    const w = utilityProcess.fork(this.workerPath, [], { serviceName: 'Qvarch Hooks', execArgv: ['--max-old-space-size=1024'] })
    w.on('message', (m: { type: string; id: string; done?: number; hits?: Array<{ line: number; col: number; snippet: string; mAt: number; mLen: number }>; skipped?: boolean; error?: string }) => {
      const c = this.cur
      if (!c || m.id !== c.id) return
      if (m.type === 'progress') {
        c.done = m.done ?? c.done
        this.status()
      } else if (m.type === 'done') this.finish(m.hits ?? [], m.skipped, m.error)
    })
    w.on('exit', () => {
      // an old one killed (skipped / stopped) — the new one stays
      if (this.worker !== w) return
      this.worker = undefined
      // it died on this one (memory): that one is skipped, the rest go on
      if (this.cur) this.finish([], true, 'процесс поиска перезапущен')
    })
    this.worker = w
    return w
  }
  private next(): void {
    if (this.cur || this.st.paused) return
    const it = this.queue.shift()
    if (!it) return this.status()
    this.queuedBytes -= it.size
    const h = this.data.hooks.find((x) => x.id === it.hookId)
    if (!h) return this.next()
    this.cur = { ...it, done: 0 }
    this.cur.timer = setTimeout(() => this.kill(`дольше ${ITEM_SEC} с — выражение слишком сложное или ответ огромный`), ITEM_SEC * 1000)
    this.ensureWorker().postMessage({ type: 'search', id: it.id, body: it.body, search: h.search, maxHits: 200 })
    // the body now lives in the worker
    this.cur.body = ''
    this.status()
  }
  private finish(found: Array<{ line: number; col: number; snippet: string; mAt: number; mLen: number }>, skipped?: boolean, error?: string): void {
    const c = this.cur
    if (!c) return
    clearTimeout(c.timer)
    clearTimeout(c.skipTimer)
    this.cur = undefined
    if (skipped) {
      this.st.skipped++
      this.st.note = `Пропущен${error ? ` (${error})` : ''}: ${c.url}`
    } else this.st.scanned++
    if (error && !skipped) this.st.note = error
    if (found.length) {
      const list = (this.data.hits[c.hookId] ??= [])
      const seen = new Set(list.map((x) => `${x.url}|${x.line}|${x.col}`))
      const fresh: HookHit[] = []
      for (const f of found) {
        const k = `${c.url}|${f.line}|${f.col}`
        if (seen.has(k)) continue
        seen.add(k)
        fresh.push({ id: randomUUID(), hookId: c.hookId, at: Date.now(), url: c.url, method: c.method, type: c.type, status: c.status, ...f })
      }
      if (fresh.length) {
        this.data.hits[c.hookId] = [...fresh, ...list].slice(0, MAX_HITS)
        this.st.hits += fresh.length
        this.save()
        this.emit('hookHits', { hookId: c.hookId, hits: this.data.hits[c.hookId] })
      }
    }
    this.status()
    this.next()
  }
  private kill(why: string): void {
    const w = this.worker
    this.worker = undefined
    const c = this.cur
    if (c) this.finish([], true, why)
    try {
      w?.kill()
    } catch {
      // gone
    }
  }
  /** «Пропустить»: the one being looked into is left. */
  skip(): void {
    const c = this.cur
    if (!c || !this.worker) return
    this.worker.postMessage({ type: 'skip', id: c.id })
    // no answer at once (a long regular expression is one step) — the process goes, a new one takes the rest
    c.skipTimer ??= setTimeout(() => this.kill('пропущен'), 1000)
  }
  /** «Стоп»: the queue dropped, the current one too; nothing is taken until «Продолжить». */
  pause(on: boolean): void {
    this.st.paused = on
    if (on) {
      this.queue = []
      this.queuedBytes = 0
      if (this.cur) this.kill('остановлено')
    } else this.next()
    this.status()
  }
  getStatus(): HookStatus {
    const c = this.cur
    return {
      paused: this.st.paused,
      ...(c ? { current: { hookId: c.hookId, url: c.url, type: c.type, size: c.size, done: c.done } } : {}),
      queued: this.queue.length,
      scanned: this.st.scanned,
      skipped: this.st.skipped,
      hits: this.st.hits,
      note: this.st.note,
    }
  }
  /** The status out — at most every 150 ms. */
  private status(): void {
    if (this.statusTimer) return
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined
      this.emit('hookStatus', this.getStatus())
    }, 150)
  }
  stop(): void {
    this.kill('выход')
  }
}
