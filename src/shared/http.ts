/**
 * HTTP — a small Postman: requests in folders, variables `{{name}}`, requests and a script run before a request
 * (a token → a variable), a script that works on the response (filter, sort, count…).
 */
/** QUERY — the new safe method with a body (a search that does not fit into a URL). */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'QUERY', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]
/** The methods that send no body. */
export const BODILESS_METHODS: ReadonlySet<HttpMethod> = new Set(['GET', 'HEAD'])
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
export const HTTP_BODY_MODES = ['none', 'json', 'raw', 'urlencoded', 'form'] as const
export type HttpBodyMode = (typeof HTTP_BODY_MODES)[number]
export interface HttpBody {
  mode: HttpBodyMode
  /** json / raw text. */
  text: string
  /** The Content-Type of a raw body. */
  rawType: string
  /** urlencoded / form-data rows. */
  rows: HttpKV[]
}
export const HTTP_AUTH_TYPES = ['none', 'bearer', 'basic'] as const
export type HttpAuthType = (typeof HTTP_AUTH_TYPES)[number]
export interface HttpAuth {
  type: HttpAuthType
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
  parts.push(...BODY_MODES[r.body.mode].curl(r.body, vars).map(([flag, arg]) => `${flag} ${q(arg)}`))
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
  const authorization = HTTP_AUTH[r.auth.type].header(r.auth, vars)
  if (authorization && !has('authorization')) out.push(['Authorization', authorization])
  const contentType = BODY_MODES[r.body.mode].contentType(r.body)
  if (contentType && !has('content-type')) out.push(['Content-Type', contentType])
  return out
}

/** How each authorization is named and what Authorization header it makes (undefined — none). */
export const HTTP_AUTH: Record<HttpAuthType, { label: string; header: (a: HttpAuth, vars: Record<string, string>) => string | undefined }> = {
  none: { label: 'Нет', header: () => undefined },
  bearer: { label: 'Bearer-токен', header: (a, vars) => (a.token ? `Bearer ${fill(a.token, vars)}` : undefined) },
  basic: { label: 'Basic', header: (a, vars) => `Basic ${btoaUtf8(`${fill(a.user, vars)}:${fill(a.pass, vars)}`)}` },
}

/** The on rows of a form body, variables filled. */
const formRows = (b: HttpBody, vars: Record<string, string>): Array<[string, string]> =>
  b.rows.filter((x) => x.on && x.key).map((x) => [fill(x.key, vars), fill(x.value, vars)])

/** How a body mode is named, sent and written as cURL. */
interface BodyModeRule {
  label: string
  /** The body is a text (else rows). */
  isText: boolean
  /** The Content-Type it is sent with unless one is set by hand (undefined — none). */
  contentType: (b: HttpBody) => string | undefined
  /** It brings its own Content-Type (multipart with its boundary, set by fetch): one set by hand is dropped. */
  ownContentType?: boolean
  /** The body as fetch sends it, variables filled; throws when a JSON body is not JSON. */
  encode: (b: HttpBody, vars: Record<string, string>) => string | FormData | undefined
  /** Its cURL arguments: [flag, value]. */
  curl: (b: HttpBody, vars: Record<string, string>) => Array<[string, string]>
}
const textCurl = (b: HttpBody, vars: Record<string, string>): Array<[string, string]> => [['--data-raw', fill(b.text, vars)]]
export const BODY_MODES: Record<HttpBodyMode, BodyModeRule> = {
  none: { label: 'Нет', isText: false, contentType: () => undefined, encode: () => undefined, curl: () => [] },
  json: {
    label: 'JSON',
    isText: true,
    contentType: () => 'application/json',
    encode: (b, vars) => {
      const text = fill(b.text, vars)
      try {
        JSON.parse(text || 'null')
      } catch (e) {
        throw new Error(`Тело — не JSON: ${e instanceof Error ? e.message : String(e)}`)
      }
      return text
    },
    curl: textCurl,
  },
  raw: { label: 'Текст', isText: true, contentType: (b) => b.rawType || undefined, encode: (b, vars) => fill(b.text, vars), curl: textCurl },
  urlencoded: {
    label: 'x-www-form-urlencoded',
    isText: false,
    contentType: () => 'application/x-www-form-urlencoded',
    encode: (b, vars) => new URLSearchParams(formRows(b, vars)).toString(),
    curl: (b, vars) => formRows(b, vars).map(([k, v]) => ['--data-urlencode', `${k}=${v}`]),
  },
  form: {
    label: 'form-data',
    isText: false,
    contentType: () => undefined,
    ownContentType: true,
    encode: (b, vars) => {
      const fd = new FormData()
      for (const [k, v] of formRows(b, vars)) fd.append(k, v)
      return fd
    },
    curl: (b, vars) => formRows(b, vars).map(([k, v]) => ['-F', `${k}=${v}`]),
  },
}
function btoaUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** The collection a first start makes: empty. */
export function emptyHttpDoc(): HttpDoc {
  return { v: 1, items: [], vars: [] }
}
