/**
 * Requests the site sent (the API map's examples), written as the notebook's ready ```http blocks: the address with
 * its query laid out a parameter a line (`?a=1` / `&b=2` under the request line), the body (JSON laid out), its
 * Content-Type, the login of the site (its token headers, its cookies) — run as they are, from the note.
 */
import { isName } from '../notebook/domain/blockInfo'

/** A request header that carries a login (a token, a session, a CSRF guard, an API key, the cookies). */
export const AUTH_HEADER = /^(authorization|proxy-authorization|cookie|x-[\w-]*(token|auth|session|csrf|xsrf|api-?key)[\w-]*|api-?key)$/i

export interface HttpExample {
  method: string
  url: string
  body?: string
  /** The body's type as it was sent. */
  contentType?: string
  /** Headers of its own (a description's); the login comes apart. */
  headers?: Array<[string, string]>
}
/** A value of the query as one reads it (decoded), unless that would change its meaning (then as it was encoded). */
const qv = (s: string) => (/[&#%\s=?]/.test(s) || s === '' ? encodeURIComponent(s) : s)
/** The request's text (the .http format): its line, the query a parameter a line, the headers, the body. */
export function httpRequestText(x: HttpExample, auth: Array<[string, string]> = []): string {
  // the note's {{ values }} in it kept whole (an address taken apart would escape their braces)
  const keep: string[] = []
  const safe = x.url.replace(/\{\{[^{}]+\}\}/g, (m) => `__qv${keep.push(m) - 1}__`)
  const back = (s: string) => s.replace(/__qv(\d+)__/g, (_m, i: string) => keep[Number(i)])
  let base = x.url
  const query: string[] = []
  try {
    const u = new URL(safe)
    base = back(`${u.origin}${u.pathname}${u.hash}`)
    let first = true
    for (const [k, v] of u.searchParams) {
      query.push(back(`    ${first ? '?' : '&'}${qv(k)}=${qv(v)}`))
      first = false
    }
  } catch {
    // (not an address of its own — as it is)
  }
  let body = x.body ?? ''
  let json = false
  if (body && /^\s*[[{]/.test(body)) {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2)
      json = true
    } catch {
      // as it was
    }
  }
  const type = x.contentType || (json ? 'application/json' : /^[^=&\s]+=[^&]*(&|$)/.test(body) ? 'application/x-www-form-urlencoded' : body ? 'text/plain' : '')
  const own = (x.headers ?? []).filter(([k]) => k.toLowerCase() !== 'content-type' && !auth.some(([a]) => a.toLowerCase() === k.toLowerCase()))
  const headers: Array<[string, string]> = [...(body && type ? [['Content-Type', type] as [string, string]] : []), ...own, ...auth.filter(([k]) => k.toLowerCase() !== 'content-type')]
  return [`${x.method.toUpperCase()} ${base}`, ...query, ...headers.map(([k, v]) => `${k}: ${v}`), ...(body ? ['', body] : [])].join('\n')
}
/** A block's name for a request: its method and its address's last word (`get_items`), free among `taken`. */
export function requestName(method: string, url: string, taken: Set<string>): string {
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    // the text as it is
  }
  const word =
    path
      .split('/')
      .filter((s) => s && !/^\d+$|^[0-9a-f-]{16,}$/i.test(s))
      .pop()
      ?.replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'request'
  const stem = `${method.toLowerCase()}_${word}`.slice(0, 40)
  let name = isName(stem) ? stem : `req_${stem}`
  for (let i = 2; taken.has(name) || !isName(name); i++) name = `${isName(stem) ? stem : `req_${stem}`}_${i}`
  taken.add(name)
  return name
}
/** The block names a note already has (`name=…` of its fenced blocks). */
export const namesIn = (text: string) => new Set([...text.matchAll(/^(?:`{3,}|~{3,})[^\n]*\bname=([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]))
/** Requests as fenced ```http blocks (a fence longer than any ``` in a body), their names free in the note. */
export function httpBlocks(xs: HttpExample[], authOf: (url: string) => Array<[string, string]>, taken = new Set<string>()): string {
  return xs
    .map((x) => {
      const text = httpRequestText(x, authOf(x.url))
      const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)))
      return `${fence}http name=${requestName(x.method, x.url, taken)}\n${text}\n${fence}`
    })
    .join('\n\n')
}
