import { parseHttpText } from '../../blocks/http/httpText'

/**
 * The addresses a note works with, made comparable: `{{base}}/orders/{{id}}`, `https://x.test/orders/42?a=1` and
 * `/orders/:id` are one endpoint — `/orders/{}` (a template, a number, an id — a parameter; the query dropped).
 */
export interface Endpoint {
  /** The path's key (`/orders/{}`); '' — the address has none (a site's root). */
  path: string
  /** Its site (a literal host, lower case); none — a template stands there. */
  host?: string
  method?: string
}

const PARAM_PART = /^(\{\{.*\}\}|\{[^}]*\}|:[\w-]+|\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,})$/i

/** A path made comparable: its parameters `{}`, lower case, no trailing slash. */
export function pathKey(path: string): string {
  const parts = path
    .split(/[?#]/)[0]
    .split('/')
    .filter(Boolean)
    .map((p) => (PARAM_PART.test(p) ? '{}' : p.toLowerCase()))
  return parts.length ? `/${parts.join('/')}` : ''
}

/** An address read: a full one (its host and path), or one after a template base / a bare path. */
export function endpointOf(url: string, method?: string): Endpoint | undefined {
  const u = url.trim()
  if (!u) return undefined
  // a template base: `{{base}}/orders` — the path only
  const base = /^\{\{[^}]*\}\}/.exec(u)
  if (base) return { path: pathKey(u.slice(base[0].length)), method }
  if (u.startsWith('/')) return { path: pathKey(u), method }
  try {
    // templates inside a full address do not break it
    const p = new URL(u.replace(/\{\{[^}]*\}\}/g, 'x'))
    if (!/^https?:$/.test(p.protocol)) return undefined
    const host = /\{\{/.test(u.split('/')[2] ?? '') ? undefined : p.hostname.toLowerCase()
    const path = pathKey(u.replace(/^[a-z]+:\/\/[^/]*/i, ''))
    return { path, method, ...(host ? { host } : {}) }
  } catch {
    return undefined
  }
}

/** The requests of an .http block (several — split by `###`), each with its line (0-based, in the body). */
export function httpEndpoints(body: string): Array<Endpoint & { line: number }> {
  const out: Array<Endpoint & { line: number }> = []
  let line = 0
  for (const part of body.split(/^###.*$/m)) {
    const r = parseHttpText(part)
    const e = r.url ? endpointOf(r.url, r.method) : undefined
    const at = part.split('\n').findIndex((l) => l.includes(r.url.split(/\s/)[0] || '\0'))
    if (e) out.push({ ...e, line: line + Math.max(0, at) })
    // (a part ends on the `###` line, the next starts on it)
    line += part.split('\n').length - 1
  }
  return out
}

/** The full addresses a text has (code, a browser's tabs): each once, with its line. */
export function urlsIn(text: string): Array<Endpoint & { line: number }> {
  const out: Array<Endpoint & { line: number }> = []
  const seen = new Set<string>()
  text.split('\n').forEach((l, line) => {
    for (const m of l.matchAll(/https?:\/\/[^\s'"`)<>\]]+/g)) {
      const e = endpointOf(m[0])
      const key = e && `${e.host ?? ''}${e.path}`
      if (!e || !key || seen.has(key)) continue
      seen.add(key)
      out.push({ ...e, line })
    }
  })
  return out
}
