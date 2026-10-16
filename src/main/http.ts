import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { buildHeaders, buildUrl, DEFAULT_HTTP_SETTINGS, fill, findNode, sampleDoc, type HttpDoc, type HttpSettings, type HttpRequest, type HttpResponse, type HttpRunResult, type HttpRunStep } from '../shared/http'

/**
 * The HTTP section's backend: the collection (data/http.json, a test one made on the first start) and running a
 * request here — no browser limits (CORS), the scripts in a separate VM context with a time limit.
 */
export class HttpClient {
  private file: string
  constructor(root: string) {
    this.file = join(root, 'http.json')
  }

  load(): HttpDoc {
    if (!existsSync(this.file)) {
      const doc = sampleDoc()
      this.save(doc)
      return doc
    }
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as HttpDoc
      return { v: 1, items: Array.isArray(d.items) ? d.items : [], vars: Array.isArray(d.vars) ? d.vars : [], settings: { ...DEFAULT_HTTP_SETTINGS, ...d.settings } }
    } catch {
      return { v: 1, items: [], vars: [] }
    }
  }

  save(doc: HttpDoc): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(doc, null, 2))
    renameSync(tmp, this.file)
  }

  /** Runs a request (its pre requests and scripts first), with the collection's variables. */
  async run(req: HttpRequest, doc: HttpDoc): Promise<HttpRunResult> {
    const vars: Record<string, string> = {}
    for (const v of doc.vars) if (v.on && v.key) vars[v.key] = v.value
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
          const r = await this.send(p, vars, settings)
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
      out.response = await this.send(req, vars, settings)
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
    // the variables set by the scripts stay in the collection
    for (const [k, v] of Object.entries(vars)) {
      const row = doc.vars.find((x) => x.key === k)
      if (row) row.value = v
      else doc.vars.push({ on: true, key: k, value: v })
    }
    this.save(doc)
    return out
  }

  private async send(r: HttpRequest, vars: Record<string, string>, settings: HttpSettings): Promise<HttpResponse> {
    const url = buildUrl(r, vars)
    if (!/^https?:\/\//i.test(url)) throw new Error(`Адрес должен начинаться с http:// или https:// — «${url || 'пусто'}»`)
    const headers = buildHeaders(r, vars, settings)
    let body: string | FormData | undefined
    const b = r.body
    if (r.method !== 'GET' && r.method !== 'HEAD') {
      if (b.mode === 'json') {
        const text = fill(b.text, vars)
        try {
          JSON.parse(text || 'null')
        } catch (e) {
          throw new Error(`Тело — не JSON: ${msg(e)}`)
        }
        body = text
      } else if (b.mode === 'raw') body = fill(b.text, vars)
      else if (b.mode === 'urlencoded') body = new URLSearchParams(b.rows.filter((x) => x.on && x.key).map((x) => [fill(x.key, vars), fill(x.value, vars)])).toString()
      else if (b.mode === 'form') {
        const fd = new FormData()
        for (const x of b.rows.filter((x) => x.on && x.key)) fd.append(fill(x.key, vars), fill(x.value, vars))
        body = fd
        // fetch sets the multipart boundary itself
        for (let i = headers.length - 1; i >= 0; i--) if (headers[i][0].toLowerCase() === 'content-type') headers.splice(i, 1)
      }
    }
    const t0 = performance.now()
    const ctl = new AbortController()
    const limitSec = Math.max(1, Math.min(600, Number(settings.timeoutSec) || 60))
    const timer = setTimeout(() => ctl.abort(), limitSec * 1000)
    try {
      const res = await fetch(url, { method: r.method, headers, body, signal: ctl.signal, redirect: 'follow' })
      const buf = Buffer.from(await res.arrayBuffer())
      const time = Math.round(performance.now() - t0)
      // a big answer is cut (the window would choke on it)
      const LIMIT = 5 * 1024 * 1024
      const text = buf.subarray(0, LIMIT).toString('utf8') + (buf.length > LIMIT ? '\n…(обрезано)' : '')
      return { status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body: text, time, size: buf.length, url: res.url || url }
    } catch (e) {
      throw new Error(ctl.signal.aborted ? `Нет ответа за ${limitSec} с` : `Не удалось выполнить запрос: ${msg(e)}`)
    } finally {
      clearTimeout(timer)
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
