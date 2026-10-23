/**
 * «Карта API»: what the site's pages really call, gathered from the traffic while «Проверка» watches — each
 * endpoint (method + path with its ids as :id) with how often, its answers, its time, the pages that call it, the
 * fields it was sent and answered (their types, how often there, null seen, an example), one request and one
 * answer to look at. A Swagger, when the site has one, only adds to it: what is not in it, what was never called.
 */
import type { ApiOp } from './openapi'
import { httpBlocks } from './httpBlock'

export interface FieldStat {
  /** string / number / boolean / null / object / array. */
  types: string[]
  /** In how many bodies it was. */
  n: number
  /** How many times it was null. */
  nulls: number
  /** A value seen (secrets hidden, long text cut). */
  ex?: string
  /** A string's look: uuid, date-time, date, email, url, число-строкой. */
  fmt?: string
}
export interface Shape {
  /** The bodies looked at. */
  bodies: number
  /** path (a.b[].c; ids among the keys as :id) → what was seen. */
  fields: Record<string, FieldStat>
}
export interface ApiSample {
  at: number
  url: string
  status: number
  contentType?: string
  reqBody?: string
  resBody?: string
  /** The headers sent and answered, as they were (see `headerList`). */
  reqHeaders?: Array<[string, string]>
  resHeaders?: Array<[string, string]>
}
export interface ApiEndpoint {
  /** `${method} ${host}${path}` (and ` · ${op}`) — the same endpoint whatever the ids. */
  key: string
  method: string
  host: string
  path: string
  /** GraphQL / JSON-RPC: the operation (one address, many of them). */
  op?: string
  count: number
  first: number
  last: number
  /** Answer → times ('0' — the request did not get through). */
  statuses: Record<string, number>
  msSum: number
  msMax: number
  /** The query's keys seen. */
  query: string[]
  /** The pages (their path, ids as :id) that called it → times. */
  pages: Record<string, number>
  req: Shape
  res: Shape
  /** The last good call and the last failed one. */
  sample?: ApiSample
  errSample?: ApiSample
}
/** One request done, as the map takes it. */
export interface ApiCall {
  method: string
  url: string
  page: string
  status: number
  ms: number
  at: number
  contentType?: string
  reqBody?: string
  resBody?: string
  reqHeaders?: Record<string, string>
  resHeaders?: Record<string, string>
}

export const API_MAX_ENDPOINTS = 3000
const MAX_FIELDS = 400
const ARRAY_ITEMS = 10
// (a request's and an answer's example each: thousands of endpoints are kept, and written to the disk)
const SAMPLE_MAX = 8_000

// ---------- the endpoint ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A path's segment that is an id: a uuid, a number, a long hex, a code with digits (PRD-000123), a long token. */
export function isIdSeg(s: string): boolean {
  const d = (s.match(/\d/g) ?? []).length
  return UUID.test(s) || /^\d+$/.test(s) || /^[0-9a-f]{16,}$/i.test(s) || (d >= 3 && s.length >= 5 && /^[\w.~-]+$/.test(s)) || (s.length >= 24 && /^[\w-]+$/.test(s) && d > 0)
}
/** The address's host, its path with ids as :id, its query's keys. */
export function apiPath(url: string): { host: string; path: string; query: string[] } {
  try {
    const u = new URL(url)
    const path = u.pathname
      .split('/')
      .map((s) => (s && isIdSeg(decodeURIComponent(s)) ? ':id' : s))
      .join('/')
    return { host: u.host, path: path || '/', query: [...new Set(u.searchParams.keys())].sort() }
  } catch {
    return { host: '', path: url, query: [] }
  }
}
const parseJson = (s?: string): unknown => {
  if (!s || !/^\s*[[{]/.test(s)) return undefined
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
/** The operation of a GraphQL / JSON-RPC call (the same address for all of them). */
export function opOf(path: string, body?: string): string | undefined {
  const j = parseJson(body) as Record<string, unknown> | undefined
  if (!j || Array.isArray(j)) return undefined
  if (typeof j.query === 'string' && (/graphql/i.test(path) || 'operationName' in j)) {
    if (typeof j.operationName === 'string' && j.operationName) return j.operationName
    const m = /^\s*(query|mutation|subscription)\s+(\w+)/.exec(j.query)
    return m ? m[2] : /^\s*mutation\b/.test(j.query) ? 'mutation' : 'query'
  }
  if (j.jsonrpc && typeof j.method === 'string') return j.method
  return undefined
}
export const endpointKey = (method: string, host: string, path: string, op?: string) => `${method.toUpperCase()} ${host}${path}${op ? ` · ${op}` : ''}`

// ---------- secrets ----------
const SECRET = /pass(word)?|pwd|token|secret|authori[sz]ation|api[-_]?key|otp|^pin$|pincode|cvv|cookie|session/i
/** The secrets of a body hidden (a JSON — by its keys; a form — key=value). */
export function maskBody(body?: string): string | undefined {
  if (body === undefined) return undefined
  const j = parseJson(body)
  if (j !== undefined) {
    const hide = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(hide) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) && (typeof x !== 'object' || x === null) ? '•••' : hide(x)])) : v
    return JSON.stringify(hide(j), null, 2)
  }
  return body.replace(/(^|&)([^=&]+)=([^&]*)/g, (all, a: string, k: string) => (SECRET.test(decodeURIComponent(k)) ? `${a}${k}=•••` : all))
}
export function maskUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const k of [...u.searchParams.keys()]) if (SECRET.test(k)) u.searchParams.set(k, '•••')
    return u.toString()
  } catch {
    return url
  }
}
/**
 * Headers as the map keeps them: names as sent, sorted, values whole — a token too (taken from here into a request of
 * the notebook); the protocol's own (:authority…) left out; a huge value and the count of them limited.
 */
export function headerList(h?: Record<string, string>): Array<[string, string]> | undefined {
  if (!h) return undefined
  const out = Object.entries(h)
    .filter(([k]) => k && !k.startsWith(':'))
    .map(([k, v]): [string, string] => {
      const s = String(v)
      return [k, s.length > 16_000 ? `${s.slice(0, 16_000)}…` : s]
    })
    .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
    .slice(0, 80)
  return out.length ? out : undefined
}
const cut = (s: string | undefined, n = SAMPLE_MAX) => (s === undefined ? undefined : s.length > n ? `${s.slice(0, n)}\n… (обрезано, всего ${s.length} символов)` : s)

// ---------- the fields ----------
const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)
function fmtOf(s: string): string | undefined {
  if (UUID.test(s)) return 'uuid'
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return 'date-time'
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'date'
  if (/^[^@\s]+@[^@\s]+\.\w+$/.test(s)) return 'email'
  if (/^https?:\/\//.test(s)) return 'url'
  if (/^-?\d+([.,]\d+)?$/.test(s)) return 'число строкой'
  return undefined
}
/** A body's fields put into a shape: every node by its path, an array's items as [] (its first ones), ids among keys as :id. */
export function shapeAdd(shape: Shape, body: unknown): void {
  shape.bodies++
  const seen = new Set<string>()
  const put = (path: string, v: unknown, key: string) => {
    let f = shape.fields[path]
    if (!f) {
      if (Object.keys(shape.fields).length >= MAX_FIELDS) return false
      f = shape.fields[path] = { types: [], n: 0, nulls: 0 }
    }
    const t = typeOf(v)
    if (!f.types.includes(t)) f.types.push(t)
    if (!seen.has(path)) {
      seen.add(path)
      f.n++
    }
    if (v === null) f.nulls++
    if (t !== 'object' && t !== 'array' && v !== null && f.ex === undefined) f.ex = SECRET.test(key) ? '•••' : String(v).slice(0, 60)
    if (typeof v === 'string' && !SECRET.test(key)) {
      const k = fmtOf(v)
      if (k && (f.fmt === undefined || f.fmt === k)) f.fmt = k
      else if (f.fmt !== undefined && f.fmt !== k) f.fmt = ''
    }
    return true
  }
  const walk = (v: unknown, path: string, key: string) => {
    if (path && !put(path, v, key)) return
    if (Array.isArray(v)) v.slice(0, ARRAY_ITEMS).forEach((x) => walk(x, `${path}[]`, key))
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        const name = isIdSeg(k) ? ':id' : k
        walk(x, path ? `${path}.${name}` : name, k)
      }
  }
  // the body itself an array / a value: its path is «(тело)»
  if (Array.isArray(body) || !body || typeof body !== 'object') {
    put('(тело)', body, '')
    if (Array.isArray(body)) body.slice(0, ARRAY_ITEMS).forEach((x) => walk(x, '(тело)[]', ''))
  } else walk(body, '', '')
}
export const emptyShape = (): Shape => ({ bodies: 0, fields: {} })

// ---------- taking a call in ----------
/** Its answer's body is wanted: the first few calls, then one in 25, and an answer not seen yet. */
export function wantsBody(e: ApiEndpoint | undefined, status: number): boolean {
  if (!e) return true
  return e.res.bodies < 5 || e.count % 25 === 0 || !e.statuses[String(status)]
}
/** A call into the map (a new endpoint — unless the map is full). */
export function addCall(map: Map<string, ApiEndpoint>, c: ApiCall): ApiEndpoint | undefined {
  const { host, path, query } = apiPath(c.url)
  const method = c.method.toUpperCase()
  const op = opOf(path, c.reqBody)
  const key = endpointKey(method, host, path, op)
  let e = map.get(key)
  if (!e) {
    if (map.size >= API_MAX_ENDPOINTS) return undefined
    e = { key, method, host, path, ...(op ? { op } : {}), count: 0, first: c.at, last: c.at, statuses: {}, msSum: 0, msMax: 0, query: [], pages: {}, req: emptyShape(), res: emptyShape() }
    map.set(key, e)
  }
  e.count++
  e.last = c.at
  const st = String(c.status)
  e.statuses[st] = (e.statuses[st] ?? 0) + 1
  e.msSum += c.ms
  e.msMax = Math.max(e.msMax, c.ms)
  for (const q of query) if (!e.query.includes(q) && e.query.length < 60) e.query.push(q)
  const pg = apiPath(c.page)
  const pageKey = pg.host ? pg.path : ''
  if (pageKey && (e.pages[pageKey] !== undefined || Object.keys(e.pages).length < 20)) e.pages[pageKey] = (e.pages[pageKey] ?? 0) + 1
  const rq = parseJson(c.reqBody)
  if (rq !== undefined && e.req.bodies < 200) shapeAdd(e.req, rq)
  const rs = parseJson(c.resBody)
  if (rs !== undefined && e.res.bodies < 200) shapeAdd(e.res, rs)
  const reqHeaders = headerList(c.reqHeaders)
  const resHeaders = headerList(c.resHeaders)
  const sample: ApiSample = {
    at: c.at,
    url: maskUrl(c.url),
    status: c.status,
    ...(c.contentType ? { contentType: c.contentType } : {}),
    ...(c.reqBody !== undefined ? { reqBody: cut(maskBody(c.reqBody)) } : {}),
    ...(c.resBody !== undefined ? { resBody: cut(maskBody(c.resBody)) } : {}),
    ...(reqHeaders ? { reqHeaders } : {}),
    ...(resHeaders ? { resHeaders } : {}),
  }
  const bad = c.status === 0 || c.status >= 400
  if (bad) e.errSample = sample
  // a good call: kept when it has an answer to show (or there is none yet)
  else if (!e.sample || c.resBody !== undefined || e.sample.resBody === undefined) e.sample = sample
  return e
}

// ---------- the Swagger beside it ----------
const segs = (p: string) => p.split('/').filter(Boolean)
/**
 * The spec's operation an endpoint is: the same method, the op's path at the end of the endpoint's (after the
 * server's base path, when it is known): {x} — any one segment, a literal — the same one (an :id never is one).
 * The most literal match wins.
 */
export function matchOp(e: Pick<ApiEndpoint, 'method' | 'path'>, ops: ApiOp[], base = ''): ApiOp | undefined {
  const t = segs(e.path)
  const b = segs(base)
  let best: { op: ApiOp; score: number } | undefined
  for (const op of ops) {
    if (op.method.toUpperCase() !== e.method) continue
    const o = segs(op.path)
    if (o.length > t.length) continue
    const pre = t.slice(0, t.length - o.length)
    // before the op's path: the base path (when the spec names one), else anything — but a bare {x} matches too much
    if (b.length ? pre.join('/').toLowerCase() !== b.join('/').toLowerCase() : false) continue
    let score = 0
    let ok = true
    o.forEach((s, i) => {
      const x = t[pre.length + i]
      if (/^\{.+\}$/.test(s)) return
      if (x === ':id' || x.toLowerCase() !== s.toLowerCase()) ok = false
      else score++
    })
    if (!ok || (!b.length && !score && pre.length)) continue
    if (!best || score > best.score) best = { op, score }
  }
  return best?.op
}
/** The map against a spec: endpoint key → its operation; the spec's operations never called. */
export function compareSpec(list: ApiEndpoint[], ops: ApiOp[], base = ''): { byKey: Record<string, ApiOp>; notCalled: ApiOp[] } {
  const byKey: Record<string, ApiOp> = {}
  const used = new Set<string>()
  for (const e of list) {
    const op = matchOp(e, ops, base)
    if (op) {
      byKey[e.key] = op
      used.add(op.id)
    }
  }
  return { byKey, notCalled: ops.filter((o) => !used.has(o.id)) }
}

// ---------- the search ----------
/** What an endpoint is found by: its method, path, operation, site, query keys, pages, answers, fields, its Swagger words. */
export function searchText(e: ApiEndpoint, summary = ''): string {
  // (not the pages it was called from: a site's admin page /users/… would make «users» find every request it sends)
  return [e.method, e.path, e.op ?? '', e.host, ...e.query, ...Object.keys(e.statuses), ...Object.keys(e.req.fields), ...Object.keys(e.res.fields), summary].join(' ').toLowerCase()
}
/**
 * A search's words, each to be found: an address pasted whole is taken as its path (the ids in it as :id), a path
 * typed with real ids too.
 */
export function searchWords(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^https?:\/\//i.test(w)) return apiPath(w).path.toLowerCase()
      if (w.includes('/')) return w.split('?')[0].split('/').map((s) => (s && isIdSeg(decodeURIComponent(s)) ? ':id' : s)).join('/').toLowerCase()
      return w.toLowerCase()
    })
}
export const searchMatch = (hay: string, words: string[]) => words.every((w) => hay.includes(w))

// ---------- in words ----------
export const avgMs = (e: ApiEndpoint) => (e.count ? Math.round(e.msSum / e.count) : 0)
export const errCount = (e: ApiEndpoint) => Object.entries(e.statuses).reduce((n, [s, c]) => (s === '0' || Number(s) >= 400 ? n + c : n), 0)
export const statusLine = (e: ApiEndpoint) =>
  Object.entries(e.statuses)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([s, c]) => `${s === '0' ? 'сбой' : s}×${c}`)
    .join(' ')
/** A field in words: its types (and look), how often there, null seen. */
export function fieldLine(f: FieldStat, bodies: number): { type: string; often: string } {
  const types = f.types.filter((t) => t !== 'null')
  const type = types.length ? `${types.join(' | ')}${f.fmt ? ` (${f.fmt})` : ''}${f.nulls ? ', бывает null' : ''}` : 'всегда null'
  const often = f.n >= bodies ? 'всегда' : `${Math.round((f.n / Math.max(1, bodies)) * 100)}%`
  return { type, often }
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
function fieldsMd(title: string, sh: Shape): string[] {
  const rows = Object.entries(sh.fields)
  if (!rows.length) return []
  return [
    `**${title}** (тел: ${sh.bodies})`,
    '',
    '| Поле | Тип | Есть | Пример |',
    '| --- | --- | --- | --- |',
    ...rows.map(([p, f]) => {
      const l = fieldLine(f, sh.bodies)
      return `| \`${cell(p)}\` | ${cell(l.type)} | ${l.often} | ${f.ex !== undefined ? cell(f.ex) : ''} |`
    }),
    '',
  ]
}
/** The map of a site as a note: the endpoints' table, each one's fields and a request to run again; the spec's gaps. */
export function apiMapMd(host: string, list: ApiEndpoint[], spec?: { title: string; byKey: Record<string, ApiOp>; notCalled: ApiOp[] }, authOf: (url: string) => Array<[string, string]> = () => []): string {
  const at = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const sorted = [...list].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  const out = [
    `# Карта API ${host}`,
    '',
    `> [!info] Собрано из трафика страниц (${at}): методов ${list.length}, вызовов ${list.reduce((n, e) => n + e.count, 0)}${spec ? ` · Swagger «${spec.title}»: нет в нём ${list.filter((e) => !spec.byKey[e.key]).length}, не вызывались ${spec.notCalled.length}` : ''}`,
    '',
    '| Метод | Путь | Вызовов | Ответы | Среднее | Страницы' + (spec ? ' | Swagger |' : ' |'),
    '| --- | --- | --- | --- | --- | ---' + (spec ? ' | --- |' : ' |'),
    ...sorted.map(
      (e) =>
        `| ${e.method} | \`${cell(e.path)}\`${e.op ? ` · ${cell(e.op)}` : ''} | ${e.count} | ${statusLine(e)} | ${avgMs(e)} мс | ${cell(Object.keys(e.pages).slice(0, 3).join(', '))}${Object.keys(e.pages).length > 3 ? ' …' : ''}` +
        (spec ? ` | ${spec.byKey[e.key] ? cell(spec.byKey[e.key].summary || '✓') : '**нет**'} |` : ' |'),
    ),
    '',
  ]
  if (spec?.notCalled.length) out.push('## Есть в Swagger, но не вызывались', '', ...spec.notCalled.map((o) => `- ${o.method.toUpperCase()} \`${o.path}\`${o.summary ? ` — ${o.summary}` : ''}`), '')
  const taken = new Set<string>()
  for (const e of sorted) {
    out.push(`## ${e.method} ${e.path}${e.op ? ` · ${e.op}` : ''}`, '')
    out.push(`Вызовов ${e.count} · ответы ${statusLine(e)} · среднее ${avgMs(e)} мс, макс. ${e.msMax} мс${e.query.length ? ` · параметры: ${e.query.map((q) => `\`${q}\``).join(', ')}` : ''}`, '')
    if (Object.keys(e.pages).length) out.push(`Страницы: ${Object.keys(e.pages).map((p) => `\`${cell(p)}\``).join(', ')}`, '')
    out.push(...fieldsMd('Отправляется', e.req), ...fieldsMd('Приходит', e.res))
    const s = e.sample ?? e.errSample
    if (s) out.push(httpBlocks([{ method: e.method, url: s.url, body: s.reqBody, contentType: s.contentType }], authOf, taken), '')
  }
  return out.join('\n')
}
