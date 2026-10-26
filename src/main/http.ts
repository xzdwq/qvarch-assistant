import { safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { importInto } from '../shared/httpCollection'
import { BODILESS_METHODS, BODY_MODES, buildHeaders, buildUrl, DEFAULT_HTTP_SETTINGS, findNode, emptyHttpDoc, stopReason, type HttpDoc, type HttpFolder, type HttpKV, type HttpSettings, type HttpRequest, type HttpResponse, type HttpRunResult, type HttpRunStep } from '../shared/http'

/**
 * The HTTP section's backend: the collection (data/http.json, empty at the first start) and running a
 * request here — no browser limits (CORS), the scripts in a separate VM context with a time limit.
 */
export class HttpClient {
  private file: string
  constructor(root: string) {
    this.file = join(root, 'http.json')
  }

  load(): HttpDoc {
    if (!existsSync(this.file)) {
      const doc = emptyHttpDoc()
      this.save(doc)
      return doc
    }
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as HttpDoc
      // secret variables are kept encrypted
      const vars = (Array.isArray(d.vars) ? d.vars : []).map((v: HttpKV & { enc?: string }) => {
        if (!v.enc) return v
        const { enc, ...rest } = v
        try {
          return { ...rest, value: safeStorage.decryptString(Buffer.from(enc, 'base64')) }
        } catch {
          return { ...rest, value: '' }
        }
      })
      return { v: 1, items: Array.isArray(d.items) ? d.items : [], vars, settings: { ...DEFAULT_HTTP_SETTINGS, ...d.settings } }
    } catch {
      return { v: 1, items: [], vars: [] }
    }
  }

  save(doc: HttpDoc): void {
    const tmp = `${this.file}.tmp`
    // a secret variable's value goes to disk encrypted (Windows DPAPI) — never as plain text
    const crypt = safeStorage.isEncryptionAvailable()
    const vars = doc.vars.map((v) => (v.secret && v.value && crypt ? { ...v, value: '', enc: safeStorage.encryptString(v.value).toString('base64') } : v))
    writeFileSync(tmp, JSON.stringify({ ...doc, vars }, null, 2))
    renameSync(tmp, this.file)
  }

  /**
   * A recorded chain comes in (from the browser): its folder on top, its variables set (secret ones stay secret).
   */
  import(folder: HttpFolder, vars: HttpKV[]): void {
    const doc = this.load()
    importInto(doc, folder, vars)
    this.save(doc)
  }

  /** Running requests (a single one or a chain) — each can be stopped. */
  private aborts = new Map<string, AbortController>()
  abort(runId: string): void {
    this.aborts.get(runId)?.abort()
  }

  /** Runs a request (its pre requests and scripts first), with the collection's variables. */
  async run(req: HttpRequest, doc: HttpDoc, runId?: string): Promise<HttpRunResult> {
    const vars: Record<string, string> = {}
    for (const v of doc.vars) if (v.on && v.key) vars[v.key] = v.value
    const ctl = new AbortController()
    if (runId) this.aborts.set(runId, ctl)
    try {
      const out = await this.exec(req, doc, vars, ctl.signal)
      // the variables set by the scripts stay in the collection
      for (const [k, v] of Object.entries(vars)) {
        const row = doc.vars.find((x) => x.key === k)
        if (row) row.value = v
        else doc.vars.push({ on: true, key: k, value: v })
      }
      this.save(doc)
      return out
    } finally {
      if (runId) this.aborts.delete(runId)
    }
  }

  /**
   * A folder's requests one after another, the variables passing on (a token, an id). Runs here, not in the
   * window — it goes on whatever the window shows; stops on what `stopOn` names, or when asked (abort).
   * Each step is reported as it ends; the variables go into the collection's file after each (only them —
   * the requests may be being edited meanwhile).
   */
  async chain(ids: string[], doc: HttpDoc, stopOn: string, runId: string, onStep: (i: number, id: string, out: HttpRunResult) => void): Promise<{ stopped?: string }> {
    const vars: Record<string, string> = {}
    for (const v of doc.vars) if (v.on && v.key) vars[v.key] = v.value
    const ctl = new AbortController()
    this.aborts.set(runId, ctl)
    try {
      for (let i = 0; i < ids.length; i++) {
        if (ctl.signal.aborted) return { stopped: 'Прервано' }
        const req = findNode(doc.items, ids[i])
        if (!req || req.type !== 'request') continue
        const out = await this.exec(req, doc, vars, ctl.signal)
        this.mergeVars(vars)
        onStep(i, req.id, out)
        if (ctl.signal.aborted) return { stopped: 'Прервано' }
        const why = stopReason(stopOn, out)
        if (why) return { stopped: `Остановлено на №${i + 1}: ${why}` }
      }
      return {}
    } finally {
      this.aborts.delete(runId)
    }
  }
  /** The variables a run set — into the file as they are now (nothing else of it touched). */
  private mergeVars(vars: Record<string, string>): void {
    const disk = this.load()
    for (const [k, v] of Object.entries(vars)) {
      const row = disk.vars.find((x) => x.key === k)
      if (row) row.value = v
      else disk.vars.push({ on: true, key: k, value: v })
    }
    this.save(disk)
  }

  private async exec(req: HttpRequest, doc: HttpDoc, vars: Record<string, string>, signal: AbortSignal): Promise<HttpRunResult> {
    const logs: string[] = []
    const chain: HttpRunStep[] = []
    const out: HttpRunResult = { logs, vars, chain, hasResult: false }
    const settings = { ...DEFAULT_HTTP_SETTINGS, ...doc.settings }
    try {
      // the requests to run before (each with its own scripts; not their own pre requests — no loops)
      for (const id of req.pre.requests) {
        const p = findNode(doc.items, id)
        if (!p || p.type !== 'request' || p.id === req.id) continue
        const step: HttpRunStep = { name: p.name, method: p.method, url: buildUrl(p, vars) }
        chain.push(step)
        try {
          if (p.pre.script.trim()) this.script(p.pre.script, { req: p, vars, logs, label: p.name })
          const r = await this.send(p, vars, settings, signal)
          step.status = r.status
          step.time = r.time
          if (p.post.trim()) this.script(p.post, { req: p, res: r, vars, logs, label: p.name })
        } catch (e) {
          step.error = msg(e)
          out.stage = 'chain'
          throw e
        }
      }
      if (req.pre.script.trim()) {
        out.stage = 'pre'
        this.script(req.pre.script, { req, vars, logs, label: 'перед запросом' })
      }
      out.stage = 'request'
      out.response = await this.send(req, vars, settings, signal)
      if (req.post.trim()) {
        out.stage = 'post'
        const r = this.script(req.post, { req, res: out.response, vars, logs, label: 'обработка' })
        out.result = r
        out.hasResult = r !== undefined
      }
      out.stage = undefined
    } catch (e) {
      out.error = msg(e)
    }
    return out
  }

  private async send(r: HttpRequest, vars: Record<string, string>, settings: HttpSettings, stop?: AbortSignal): Promise<HttpResponse> {
    if (stop?.aborted) throw new Error('Прервано')
    const url = buildUrl(r, vars)
    if (!/^https?:\/\//i.test(url)) throw new Error(`Адрес должен начинаться с http:// или https:// — «${url || 'пусто'}»`)
    const headers = buildHeaders(r, vars, settings)
    let body: string | FormData | undefined
    if (!BODILESS_METHODS.has(r.method)) {
      const mode = BODY_MODES[r.body.mode]
      body = mode.encode(r.body, vars)
      // fetch sets the multipart boundary itself
      if (mode.ownContentType) for (let i = headers.length - 1; i >= 0; i--) if (headers[i][0].toLowerCase() === 'content-type') headers.splice(i, 1)
    }
    const t0 = performance.now()
    const ctl = new AbortController()
    const limitSec = Math.max(1, Math.min(600, Number(settings.timeoutSec) || 60))
    const timer = setTimeout(() => ctl.abort(), limitSec * 1000)
    const onStop = () => ctl.abort()
    stop?.addEventListener('abort', onStop)
    try {
      const res = await fetch(url, { method: r.method, headers, body, signal: ctl.signal, redirect: 'follow' })
      const buf = Buffer.from(await res.arrayBuffer())
      const time = Math.round(performance.now() - t0)
      // a big answer is cut (the window would choke on it)
      const LIMIT = 5 * 1024 * 1024
      const text = buf.subarray(0, LIMIT).toString('utf8') + (buf.length > LIMIT ? '\n…(обрезано)' : '')
      return { status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body: text, time, size: buf.length, url: res.url || url }
    } catch (e) {
      throw new Error(stop?.aborted ? 'Прервано' : ctl.signal.aborted ? `Нет ответа за ${limitSec} с` : `Не удалось выполнить запрос: ${msg(e)}`)
    } finally {
      clearTimeout(timer)
      stop?.removeEventListener('abort', onStop)
    }
  }

  /**
   * A script: `qa.set / qa.get / qa.log`, `req` (the request), `res` (status, headers, body, json(), header()),
   * the usual JS. Its `return` value is the result. A separate context, 5 s at most.
   */
  private script(code: string, o: { req: HttpRequest; res?: HttpResponse; vars: Record<string, string>; logs: string[]; label: string }): unknown {
    const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
    const log = (...a: unknown[]) => o.logs.push(`[${o.label}] ${a.map(show).join(' ')}`)
    const res = o.res
      ? {
          status: o.res.status,
          statusText: o.res.statusText,
          headers: Object.fromEntries(o.res.headers),
          body: o.res.body,
          time: o.res.time,
          json: () => JSON.parse(o.res!.body),
          header: (name: string) => o.res!.headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1],
        }
      : undefined
    const qa = {
      set: (k: string, v: unknown) => (o.vars[String(k)] = typeof v === 'string' ? v : JSON.stringify(v)),
      get: (k: string) => o.vars[String(k)],
      log,
    }
    const ctx = vm.createContext({ qa, res, req: JSON.parse(JSON.stringify(o.req)), console: { log, warn: log, error: log } })
    try {
      const r = vm.runInContext(`(() => {\n${code}\n})()`, ctx, { timeout: 5000, filename: o.label })
      return r === undefined ? undefined : JSON.parse(JSON.stringify(r))
    } catch (e) {
      throw new Error(`Скрипт «${o.label}»: ${msg(e)}`)
    }
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
