/**
 * HTTP — a small Postman: requests in folders, variables `{{name}}`, requests and a script run before a request
 * (a token → a variable), a script that works on the response (filter, sort, count…).
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'QUERY' | 'HEAD' | 'OPTIONS'
/** QUERY — the new safe method with a body (a search that does not fit into a URL). */
export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'QUERY', 'HEAD', 'OPTIONS']
/** Each method's colour (the list shows every one in its own). */
export const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: 'var(--up-fg)',
  POST: 'var(--warn-fg)',
  PUT: 'var(--info-fg)',
  PATCH: 'var(--info-fg)',
  DELETE: 'var(--down-fg)',
  QUERY: 'var(--cyan)',
  HEAD: 'var(--muted)',
  OPTIONS: 'var(--muted)',
}
/** For every request: the User-Agent, more headers, the time limit. A request's own header wins. */
export interface HttpSettings {
  userAgent: string
  headers: HttpKV[]
  timeoutSec: number
}
export const DEFAULT_HTTP_SETTINGS: HttpSettings = { userAgent: 'Qvarch-HTTP/1.0', headers: [], timeoutSec: 60 }

/** A row of params / headers / a form: off rows are kept but not sent. */
export interface HttpKV {
  on: boolean
  key: string
  value: string
  /** A secret (a token, a cookie): shown hidden, kept encrypted on disk (Windows DPAPI). Variables only. */
  secret?: boolean
}
export type HttpBodyMode = 'none' | 'json' | 'raw' | 'urlencoded' | 'form'
export interface HttpBody {
  mode: HttpBodyMode
  /** json / raw text. */
  text: string
  /** The Content-Type of a raw body. */
  rawType: string
  /** urlencoded / form-data rows. */
  rows: HttpKV[]
}
export interface HttpAuth {
  type: 'none' | 'bearer' | 'basic'
  token: string
  user: string
  pass: string
}
export interface HttpRequest {
  id: string
  type: 'request'
  name: string
  method: HttpMethod
  url: string
  params: HttpKV[]
  headers: HttpKV[]
  auth: HttpAuth
  body: HttpBody
  /** Run before this one: other requests (by id, in order), then the script. */
  pre: { requests: string[]; script: string }
  /** Works on the response; its `return` value is shown. */
  post: string
}
export interface HttpFolder {
  id: string
  type: 'folder'
  name: string
  open?: boolean
  /** When its chain stops: "error" and statuses — 4xx, 5xx, 401, 400-404 (comma separated); empty — never. */
  stopOn?: string
  children: HttpNode[]
}
export type HttpNode = HttpRequest | HttpFolder
export interface HttpDoc {
  v: 1
  items: HttpNode[]
  /** Variables `{{name}}` — set here or by the scripts (qa.set). */
  vars: HttpKV[]
  settings?: HttpSettings
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: string
  /** ms */
  time: number
  size: number
  url: string
}
export interface HttpRunStep {
  name: string
  method: HttpMethod
  url: string
  status?: number
  time?: number
  error?: string
}
export interface HttpRunResult {
  response?: HttpResponse
  /** What the post script returned (any JSON-able value). */
  result?: unknown
  hasResult: boolean
  logs: string[]
  /** The variables after the run (the scripts may have set some). */
  vars: Record<string, string>
  /** The requests run before this one. */
  chain: HttpRunStep[]
  error?: string
  /** Where it failed: the pre script, a pre request, the request, the post script. */
  stage?: 'pre' | 'chain' | 'request' | 'post'
}

/** What a chain stops on by default: no answer / a script error, and any 4xx / 5xx answer. */
export const DEFAULT_STOP_ON = 'error, 4xx, 5xx'
/** Why a step stops its chain (by the folder's stopOn), or nothing. */
export function stopReason(spec: string, out: HttpRunResult): string | undefined {
  const parts = spec.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
  if (out.error && parts.includes('error')) return out.error
  const s = out.response?.status
  if (s === undefined) return undefined
  for (const p of parts) {
    const m = p.match(/^([1-5])xx$/)
    if (m && Math.floor(s / 100) === Number(m[1])) return `ответ ${s}`
    const r = p.match(/^(\d{3})(?:-(\d{3}))?$/)
    if (r && s >= Number(r[1]) && s <= Number(r[2] ?? r[1])) return `ответ ${s}`
  }
  return undefined
}

export const httpId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
export const kv = (key = '', value = '', on = true): HttpKV => ({ on, key, value })
export function newRequest(name = 'Новый запрос'): HttpRequest {
  return {
    id: httpId(),
    type: 'request',
    name,
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none', token: '', user: '', pass: '' },
    body: { mode: 'none', text: '', rawType: 'text/plain', rows: [] },
    pre: { requests: [], script: '' },
    post: '',
  }
}
export const newFolder = (name = 'Новая папка'): HttpFolder => ({ id: httpId(), type: 'folder', name, open: true, children: [] })

/** `{{name}}` → its value (unknown names stay as they are). */
export function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

/** Every request of a tree, with its folder path. */
export function allRequests(items: HttpNode[], path: string[] = []): Array<{ req: HttpRequest; path: string[] }> {
  const out: Array<{ req: HttpRequest; path: string[] }> = []
  for (const n of items) {
    if (n.type === 'request') out.push({ req: n, path })
    else out.push(...allRequests(n.children, [...path, n.name]))
  }
  return out
}
export function findNode(items: HttpNode[], id: string): HttpNode | undefined {
  for (const n of items) {
    if (n.id === id) return n
    if (n.type === 'folder') {
      const f = findNode(n.children, id)
      if (f) return f
    }
  }
  return undefined
}

/** The request as a cURL command (variables filled). */
export function toCurl(r: HttpRequest, vars: Record<string, string>, settings?: HttpSettings): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const url = buildUrl(r, vars)
  const parts = [`curl -X ${r.method} ${q(url)}`]
  for (const [k, v] of buildHeaders(r, vars, settings)) parts.push(`-H ${q(`${k}: ${v}`)}`)
  const b = r.body
  if (b.mode === 'json' || b.mode === 'raw') parts.push(`--data-raw ${q(fill(b.text, vars))}`)
  else if (b.mode === 'urlencoded') for (const x of b.rows.filter((x) => x.on && x.key)) parts.push(`--data-urlencode ${q(`${fill(x.key, vars)}=${fill(x.value, vars)}`)}`)
  else if (b.mode === 'form') for (const x of b.rows.filter((x) => x.on && x.key)) parts.push(`-F ${q(`${fill(x.key, vars)}=${fill(x.value, vars)}`)}`)
  return parts.join(' \\\n  ')
}
/** The URL with the on params added (variables filled). */
export function buildUrl(r: HttpRequest, vars: Record<string, string>): string {
  const base = fill(r.url.trim(), vars)
  const ps = r.params.filter((p) => p.on && p.key).map((p) => `${encodeURIComponent(fill(p.key, vars))}=${encodeURIComponent(fill(p.value, vars))}`)
  if (!ps.length) return base
  return `${base}${base.includes('?') ? '&' : '?'}${ps.join('&')}`
}
/** The headers to send: the on rows, the auth, a Content-Type for the body mode (unless set by hand). */
export function buildHeaders(r: HttpRequest, vars: Record<string, string>, settings?: HttpSettings): Array<[string, string]> {
  const out: Array<[string, string]> = r.headers.filter((h) => h.on && h.key).map((h) => [fill(h.key, vars), fill(h.value, vars)])
  const has = (k: string) => out.some(([x]) => x.toLowerCase() === k)
  // the global ones go under the request's own
  for (const h of settings?.headers ?? []) if (h.on && h.key && !has(fill(h.key, vars).toLowerCase())) out.push([fill(h.key, vars), fill(h.value, vars)])
  if (settings?.userAgent && !has('user-agent')) out.push(['User-Agent', fill(settings.userAgent, vars)])
  if (r.auth.type === 'bearer' && r.auth.token && !has('authorization')) out.push(['Authorization', `Bearer ${fill(r.auth.token, vars)}`])
  if (r.auth.type === 'basic' && !has('authorization')) out.push(['Authorization', `Basic ${btoaUtf8(`${fill(r.auth.user, vars)}:${fill(r.auth.pass, vars)}`)}`])
  if (!has('content-type')) {
    if (r.body.mode === 'json') out.push(['Content-Type', 'application/json'])
    else if (r.body.mode === 'raw' && r.body.rawType) out.push(['Content-Type', r.body.rawType])
    else if (r.body.mode === 'urlencoded') out.push(['Content-Type', 'application/x-www-form-urlencoded'])
  }
  return out
}
function btoaUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** The test collection made on the first start (kept — the user checks it). */
export function sampleDoc(): HttpDoc {
  const login = newRequest('Получить токен')
  Object.assign(login, {
    method: 'POST',
    url: '{{auth_url}}/auth/login',
    body: { mode: 'json', text: JSON.stringify({ username: '{{user}}', password: '{{password}}', expiresInMins: 30 }, null, 2), rawType: 'text/plain', rows: [] },
    post: `// the token goes to the variable {{token}} — other requests use it
const data = res.json()
qa.set('token', data.accessToken)
qa.log('Токен получен для', data.username)
return { user: data.username, email: data.email, token: data.accessToken.slice(0, 24) + '…' }`,
  })
  const me = newRequest('Мой профиль (с токеном)')
  Object.assign(me, {
    url: '{{auth_url}}/auth/me',
    auth: { type: 'bearer', token: '{{token}}', user: '', pass: '' },
    pre: { requests: [login.id], script: `// перед запросом уже выполнен «Получить токен» — он положил {{token}}
qa.log('token =', qa.get('token')?.slice(0, 12) + '…')` },
    post: `const u = res.json()
return { name: u.firstName + ' ' + u.lastName, age: u.age, company: u.company?.name, city: u.address?.city }`,
  })
  const products = newRequest('Товары: дороже 500, по цене')
  Object.assign(products, {
    url: '{{api}}/products',
    params: [kv('limit', '100'), kv('select', 'title,price,category,rating')],
    post: `// фильтр, сортировка и подсчёт по массиву
const items = res.json().products
const expensive = items.filter((p) => p.price > 500).sort((a, b) => b.price - a.price)
const byCategory = {}
for (const p of items) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1
qa.log('всего товаров:', items.length, '· дороже 500:', expensive.length)
return { count: expensive.length, top: expensive.slice(0, 5).map((p) => p.title + ' — ' + p.price), byCategory }`,
  })
  const search = newRequest('Поиск товаров')
  Object.assign(search, {
    url: '{{api}}/products/search',
    params: [kv('q', 'phone'), kv('limit', '10'), kv('skip', '0', false)],
    post: `const { products, total } = res.json()
return { total, found: products.map((p) => p.title) }`,
  })
  const form = newRequest('Форма (x-www-form-urlencoded)')
  Object.assign(form, {
    method: 'POST',
    url: 'https://httpbin.org/post',
    headers: [kv('X-Trace', 'qvarch-{{user}}')],
    body: { mode: 'urlencoded', text: '', rawType: 'text/plain', rows: [kv('name', 'Виктор'), kv('role', 'dev'), kv('debug', 'true', false)] },
    post: `return res.json().form`,
  })
  const xml = newRequest('Сырое тело (XML)')
  Object.assign(xml, {
    method: 'POST',
    url: 'https://httpbin.org/anything',
    body: { mode: 'raw', text: '<order id="42">\n  <item sku="A-1" qty="2"/>\n</order>', rawType: 'application/xml', rows: [] },
    post: `const r = res.json()
return { contentType: r.headers['Content-Type'], body: r.data }`,
  })
  const multipart = newRequest('Форма (multipart/form-data)')
  Object.assign(multipart, {
    method: 'POST',
    url: 'https://httpbin.org/post',
    body: { mode: 'form', text: '', rawType: 'text/plain', rows: [kv('title', 'Отчёт'), kv('month', '2026-10')] },
    post: `return res.json().form`,
  })
  const basic = newRequest('Basic-авторизация')
  Object.assign(basic, {
    url: 'https://httpbin.org/basic-auth/{{user}}/{{password}}',
    auth: { type: 'basic', token: '', user: '{{user}}', pass: '{{password}}' },
  })
  return {
    v: 1,
    vars: [kv('api', 'https://dummyjson.com'), kv('auth_url', 'https://dummyjson.com'), kv('user', 'emilys'), kv('password', 'emilyspass'), kv('token', '')],
    items: [
      { id: httpId(), type: 'folder', name: 'Авторизация', open: true, children: [login, basic] },
      { id: httpId(), type: 'folder', name: 'Запросы', open: true, children: [me, products, search] },
      { id: httpId(), type: 'folder', name: 'Форматы тела', open: true, children: [form, multipart, xml] },
    ],
  }
}
