import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { addCall, apiPath, endpointKey, opOf, wantsBody, type ApiCall, type ApiEndpoint } from '../shared/apiMap'

/**
 * «Карта API» kept: every endpoint the watched pages called (data/apimap.json — a restart loses nothing). Fed by
 * «Проверка»'s watcher; it asks for an answer's body only when the map wants one (the first ones, a new status, then
 * one in 25 — the protocol is not asked for every body).
 */
/** The app's own Trace Viewer's addresses (127.0.0.1:<port>/<secret>/trace/…). */
const OWN_VIEWER = /^https?:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{24}\/trace\//i
export class ApiMapStore {
  private map = new Map<string, ApiEndpoint>()
  private saveTimer?: ReturnType<typeof setTimeout>
  private emitTimer?: ReturnType<typeof setTimeout>

  constructor(
    private root: string,
    private emit: () => void,
  ) {
    const f = join(root, 'apimap.json')
    if (!existsSync(f)) return
    try {
      const list = JSON.parse(readFileSync(f, 'utf8')) as ApiEndpoint[]
      // (the Trace Viewer's own requests, kept before they were left out — dropped)
      if (Array.isArray(list)) for (const e of list) if (e?.key && !(/^127\.0\.0\.1:\d+$/.test(e.host) && /^\/:id\/trace\//.test(e.path))) this.map.set(e.key, e)
    } catch {
      // a broken file — a new map
    }
  }
  /** The answer's body is worth asking for. */
  wants(method: string, url: string, status: number, reqBody?: string): boolean {
    const { host, path } = apiPath(url)
    return wantsBody(this.map.get(endpointKey(method, host, path, opOf(path, reqBody))), status)
  }
  add(c: ApiCall): void {
    // (the app's own Trace Viewer, served on 127.0.0.1 under its secret path — not a site's API)
    if (OWN_VIEWER.test(c.url) || OWN_VIEWER.test(c.page)) return
    if (!addCall(this.map, c)) return
    this.changed()
  }
  list(host?: string): ApiEndpoint[] {
    const all = [...this.map.values()]
    return host ? all.filter((e) => e.host === host) : all
  }
  /** The sites in it: host → endpoints, calls. */
  hosts(): Array<{ host: string; endpoints: number; calls: number; last: number }> {
    const by = new Map<string, { host: string; endpoints: number; calls: number; last: number }>()
    for (const e of this.map.values()) {
      const h = by.get(e.host) ?? { host: e.host, endpoints: 0, calls: 0, last: 0 }
      h.endpoints++
      h.calls += e.count
      h.last = Math.max(h.last, e.last)
      by.set(e.host, h)
    }
    return [...by.values()].sort((a, b) => b.last - a.last)
  }
  clear(host?: string): void {
    if (!host) this.map.clear()
    else for (const [k, e] of this.map) if (e.host === host) this.map.delete(k)
    this.changed()
  }
  private changed(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      const f = join(this.root, 'apimap.json')
      writeFileSync(`${f}.tmp`, JSON.stringify([...this.map.values()]), 'utf8')
      renameSync(`${f}.tmp`, f)
    }, 2000)
    // the panel told at most once a second (a page may send dozens at once)
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = undefined
      this.emit()
    }, 1000)
  }
}
