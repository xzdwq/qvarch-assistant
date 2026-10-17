import { httpId, kv, newRequest, type HttpFolder, type HttpKV, type HttpRequest } from './http'

/**
 * Браузер: tabs (each a page of its own, a profile apart from the app), one or two panes, bookmarks — and the
 * recording of the requests a page sends (XHR / fetch), which become a chain of requests in the HTTP section.
 */
export interface BrowserTab {
  id: string
  url: string
  title: string
  favicon?: string
  loading: boolean
  canBack: boolean
  canFwd: boolean
  /** The page's zoom, %. */
  zoom: number
  /** The developer tools are open (docked under the page). */
  devtools?: boolean
  /** The rulers are shown over the page. */
  ruler?: boolean
  /** The page did not open (no network, a bad certificate…). */
  error?: { code: number; desc: string; url: string; cert?: boolean; host?: string }
}
export interface Bookmark {
  id: string
  title: string
  /** None — a folder. */
  url?: string
  /** The site's icon (data:) — saved with it. */
  icon?: string
  children?: Bookmark[]
}
/** A page's connection: plain http, or its certificate. */
export interface CertInfo {
  host: string
  secure: boolean
  /** Chromium found the certificate fine. */
  ok?: boolean
  /** The check's result (net::OK, net::ERR_CERT_…). */
  result?: string
  /** Opened anyway (the user accepted a bad one). */
  trusted?: boolean
  subject?: Record<string, string>
  issuer?: Record<string, string>
  validFrom?: number
  validTo?: number
  san?: string[]
  serial?: string
  sha256?: string
  keySha256?: string
  /** The issuers up to the root. */
  chain?: string[]
}
/** A saved login (the password itself is asked for one by one). */
export interface PasswordInfo {
  id: string
  origin: string
  username: string
  saved: number
  used?: number
}
export interface HistoryItem {
  url: string
  title: string
  last: number
  count: number
}

/** A recorded request, as the list shows it. */
export interface RecItem {
  id: string
  /** The order it was sent in (the whole recording). */
  seq: number
  tabId: string
  /** When it was sent (ms since 1970). */
  at: number
  method: string
  url: string
  /** XHR, Fetch or Document. */
  type: string
  status?: number
  /** How long it took, ms. */
  ms?: number
  error?: string
  /** The answer's size, bytes. */
  size?: number
}
/** …with everything: the real headers (cookies too), the body, the answer. */
export interface RecFull extends RecItem {
  reqHeaders: Array<[string, string]>
  postData?: string
  resHeaders?: Array<[string, string]>
  mimeType?: string
  /** The answer's text (JSON, text) — cut at 1 MB; none for pictures and files. */
  resBody?: string
}
export interface RecState {
  on: boolean
  /** Also the pages themselves (the document a tab opens), not only XHR / fetch. */
  documents: boolean
  count: number
}

export const browserId = () => Math.random().toString(36).slice(2, 10)
/** What the address line turns into a URL: a host → https, words → a search. */
export function toUrl(text: string): string {
  const t = text.trim()
  if (!t) return 'about:blank'
  if (/^(https?|file|about|data|view-source):/i.test(t)) return t
  if (/^localhost(:\d+)?(\/|$)/i.test(t) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(t)) return `http://${t}`
  if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t)) return `https://${t}`
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`
}

// ---------- a recording → requests of the HTTP section ----------

/** Headers a request must not carry over (the client sets them itself, or they break a replay). */
const DROP_HEADERS = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'accept-encoding', 'proxy-connection', 'expect'])
/** Headers that hold a secret: they go into secret variables. */
const SECRET_HEADER = /^(authorization|cookie)$|token|api[-_]?key|secret|csrf|xsrf|session/i
/** A host → a piece of a variable name: api.example.com:8080 → api_example_com_8080. */
export const hostKey = (host: string) => host.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
const header = (h: Array<[string, string]>, name: string) => h.find(([k]) => k.toLowerCase() === name)?.[1]

/** A place in a request where a value from an earlier answer turned up. */
export interface LinkUse {
  /** The request (its index in the chain). */
  to: number
  where: 'path' | 'query' | 'body' | 'header'
  /** The param / header / body path, for the list. */
  key: string
}
/** A value an answer gave and later requests used: a script takes it from the answer, they get {{var}}. */
export interface RecLink {
  value: string
  /** The answer it came from (index in the chain). */
  from: number
  /** Its place in that answer's JSON. */
  path: Array<string | number>
  varName: string
  uses: LinkUse[]
  on: boolean
}

type Slot = { where: LinkUse['where']; key: string; value: string }
/** The values a request sends: path segments, query values, JSON body leaves, form values, headers. */
function slotsOf(r: RecFull): Slot[] {
  const out: Slot[] = []
  let u: URL
  try {
    u = new URL(r.url)
  } catch {
    return out
  }
  u.pathname.split('/').forEach((seg, i) => seg && out.push({ where: 'path', key: `сегмент ${i}`, value: safeDecode(seg) }))
  for (const [k, v] of u.searchParams) out.push({ where: 'query', key: k, value: v })
  const body = parseBody(r)
  if (body.kind === 'json') leaves(body.value, [], (p, v) => out.push({ where: 'body', key: pathText(p), value: String(v) }))
  else if (body.kind === 'rows') for (const x of body.rows) out.push({ where: 'body', key: x.key, value: x.value })
  for (const [k, v] of r.reqHeaders) if (!k.startsWith(':') && !DROP_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== 'cookie') out.push({ where: 'header', key: k, value: v.replace(/^Bearer\s+/i, '') })
  return out
}
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
/** Only values that mean something: not short words, not small numbers, not true / false. */
const linkable = (v: unknown): v is string | number => (typeof v === 'string' ? v.length >= 3 && !/^(true|false|null|undefined)$/i.test(v) : typeof v === 'number' && Number.isFinite(v) && Math.abs(v) >= 10)
function leaves(v: unknown, path: Array<string | number>, cb: (path: Array<string | number>, v: string | number) => void, budget = { n: 5000 }): void {
  if (budget.n-- <= 0) return
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, [...path, i], cb, budget))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, [...path, k], cb, budget)
  else if (linkable(v)) cb(path, v)
}
const pathText = (p: Array<string | number>) => p.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('').replace(/^\./, '') || '(всё тело)'
/** `res.json().data.items[0].id` — how a script reaches a place of the answer. */
export function accessor(p: Array<string | number>): string {
  return `res.json()${p.map((k) => (typeof k === 'number' ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`)).join('')}`
}
function jsonOf(text: string | undefined): unknown {
  if (!text) return undefined
  const t = text.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

/**
 * The links of a chain: a value an answer gave (not one the page had sent before) that a later request sends —
 * an id made by a POST and then opened, a token from a login. The newest answer holding it is its source.
 */
export function findLinks(items: RecFull[]): RecLink[] {
  const sent = new Set<string>()
  const fromAnswers = new Map<string, { from: number; path: Array<string | number> }>()
  const links = new Map<string, RecLink>()
  items.forEach((r, j) => {
    const slots = slotsOf(r)
    for (const s of slots) {
      const src = fromAnswers.get(s.value)
      if (!src) continue
      const key = `${src.from}|${s.value}`
      let l = links.get(key)
      if (!l) {
        const last = [...src.path].reverse().find((k) => typeof k === 'string') as string | undefined
        const base = (last ?? 'value').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'value'
        l = { value: s.value, from: src.from, path: src.path, varName: `${base}_${src.from + 1}`, uses: [], on: true }
        links.set(key, l)
      }
      if (!l.uses.some((u) => u.to === j && u.where === s.where && u.key === s.key)) l.uses.push({ to: j, where: s.where, key: s.key })
    }
    for (const s of slots) sent.add(s.value)
    leaves(jsonOf(r.resBody), [], (p, v) => {
      const s = String(v)
      if (!sent.has(s)) fromAnswers.set(s, { from: j, path: p })
    })
  })
  // one name per variable (two values from one answer may end on the same key)
  const out = [...links.values()]
  const used = new Map<string, number>()
  for (const l of out) {
    const n = used.get(l.varName) ?? 0
    used.set(l.varName, n + 1)
    if (n) l.varName = `${l.varName}_${n + 1}`
  }
  return out
}

type Body = { kind: 'none' } | { kind: 'json'; value: unknown } | { kind: 'rows'; mode: 'urlencoded' | 'form'; rows: HttpKV[] } | { kind: 'raw'; text: string; type: string }
function parseBody(r: RecFull): Body {
  const data = r.postData
  if (data === undefined || data === '') return { kind: 'none' }
  const ct = (header(r.reqHeaders, 'content-type') ?? '').toLowerCase()
  if (ct.includes('json') || (!ct && /^\s*[[{]/.test(data))) {
    try {
      return { kind: 'json', value: JSON.parse(data) }
    } catch {
      // not JSON after all
    }
  }
  if (ct.includes('application/x-www-form-urlencoded')) return { kind: 'rows', mode: 'urlencoded', rows: [...new URLSearchParams(data)].map(([k, v]) => kv(k, v)) }
  // (the boundary as it was — it is case-sensitive)
  const bm = (header(r.reqHeaders, 'content-type') ?? '').match(/multipart\/form-data;.*boundary=("?)([^";]+)\1/i)
  if (bm) {
    const rows: HttpKV[] = []
    for (const part of data.split(`--${bm[2]}`)) {
      const m = part.match(/name="([^"]*)"(?:;\s*filename="([^"]*)")?[\s\S]*?\r?\n\r?\n([\s\S]*?)\r?\n?$/)
      if (!m) continue
      // a file's content is not in the recording — it has to be picked again
      rows.push(m[2] !== undefined ? kv(m[1], `«файл: ${m[2]}» — выберите заново`, false) : kv(m[1], m[3]))
    }
    return { kind: 'rows', mode: 'form', rows }
  }
  return { kind: 'raw', text: data, type: ct.split(';')[0] || 'text/plain' }
}

export interface ToHttpOptions {
  /** The server's address into {{base_host}}. */
  base: boolean
  /** Tokens, cookies, keys into secret variables. */
  secrets: boolean
}
/** The chain as a folder of the HTTP section: «домен hh:mm:ss», requests «N /путь», variables. */
export function recordingToHttp(items: RecFull[], links: RecLink[], o: ToHttpOptions): { folder: HttpFolder; vars: Array<HttpKV & { secret?: boolean }> } {
  const vars: Array<HttpKV & { secret?: boolean }> = []
  const setVar = (key: string, value: string, secret = false) => {
    const row = vars.find((v) => v.key === key)
    if (row) row.value = value
    else vars.push({ ...kv(key, value), ...(secret ? { secret: true } : {}) })
  }
  /** A secret's variable: one name per header and value (a token renewed midway gets name_2). */
  const secretVars = new Map<string, string>()
  const secretVar = (base: string, value: string): string => {
    const k = `${base}|${value}`
    const hit = secretVars.get(k)
    if (hit) return hit
    let name = base
    for (let n = 2; [...secretVars.values()].includes(name); n++) name = `${base}_${n}`
    secretVars.set(k, name)
    setVar(name, value, true)
    return name
  }
  const on = links.filter((l) => l.on)
  const hosts = new Map<string, number>()
  const reqs: HttpRequest[] = items.map((r, i) => {
    let u: URL
    try {
      u = new URL(r.url)
    } catch {
      u = new URL('http://invalid/')
    }
    const hk = hostKey(u.host)
    hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1)
    const req = newRequest(`${i + 1} ${u.pathname}${u.search}`.slice(0, 140))
    req.method = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'QUERY', 'HEAD', 'OPTIONS'].includes(r.method) ? r.method : 'GET') as HttpRequest['method']
    const uses = (where: LinkUse['where'], key: string) => on.find((l) => l.uses.some((x) => x.to === i && x.where === where && x.key === key))
    // the address: {{base_host}} + the path (a segment from an answer → {{var}}); the query → params
    const segs = u.pathname.split('/').map((seg, k) => {
      const l = seg ? uses('path', `сегмент ${k}`) : undefined
      return l ? `{{${l.varName}}}` : seg
    })
    if (o.base) setVar(`base_${hk}`, u.origin)
    req.url = `${o.base ? `{{base_${hk}}}` : u.origin}${segs.join('/')}`
    req.params = [...u.searchParams].map(([k, v]) => {
      const l = uses('query', k)
      return kv(k, l && l.value === v ? `{{${l.varName}}}` : v)
    })
    // headers: secrets into variables, the rest as they were
    for (const [k0, v] of r.reqHeaders) {
      const k = k0.toLowerCase()
      if (k.startsWith(':') || DROP_HEADERS.has(k)) continue
      if (o.secrets && k === 'authorization' && /^Bearer\s+/i.test(v)) {
        const tok = v.replace(/^Bearer\s+/i, '')
        const link = on.find((l) => l.value === tok && l.uses.some((x) => x.to === i && x.where === 'header'))
        req.auth = { type: 'bearer', token: `{{${link ? link.varName : secretVar(`token_${hk}`, tok)}}}`, user: '', pass: '' }
        continue
      }
      if (o.secrets && SECRET_HEADER.test(k)) {
        const link = on.find((l) => l.value === v && l.uses.some((x) => x.to === i && x.where === 'header'))
        req.headers.push(kv(k0, `{{${link ? link.varName : secretVar(`${k.replace(/[^a-z0-9]+/g, '_')}_${hk}`, v)}}}`))
        continue
      }
      const l = uses('header', k0)
      req.headers.push(kv(k0, l && l.value === v.replace(/^Bearer\s+/i, '') ? v.replace(l.value, `{{${l.varName}}}`) : v))
    }
    // the body: JSON (answers' values → {{var}}), a form, raw text
    const body = parseBody(r)
    if (body.kind === 'json') {
      const marks: string[] = []
      const mark = (v: unknown, p: Array<string | number>): unknown => {
        if (Array.isArray(v)) return v.map((x, k) => mark(x, [...p, k]))
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mark(x, [...p, k])]))
        const l = linkable(v) ? uses('body', pathText(p)) : undefined
        if (!l || l.value !== String(v)) return v
        marks.push(typeof v === 'number' ? `{{${l.varName}}}` : `"{{${l.varName}}}"`)
        return `\u0000${marks.length - 1}\u0000`
      }
      const text = JSON.stringify(mark(body.value, []), null, 2).replace(/"\\u0000(\d+)\\u0000"/g, (_, n: string) => marks[Number(n)])
      req.body = { mode: 'json', text, rawType: 'text/plain', rows: [] }
    } else if (body.kind === 'rows') {
      req.body = { mode: body.mode, text: '', rawType: 'text/plain', rows: body.rows.map((x) => ({ ...x, value: uses('body', x.key)?.value === x.value ? `{{${uses('body', x.key)!.varName}}}` : x.value })) }
      // multipart: the boundary is the client's business
      if (body.mode === 'form') req.headers = req.headers.filter((h) => h.key.toLowerCase() !== 'content-type')
    } else if (body.kind === 'raw') req.body = { mode: 'raw', text: body.text, rawType: body.type, rows: [] }
    // the answer's values the next requests need
    const mine = on.filter((l) => l.from === i)
    if (mine.length) req.post = `// значения из этого ответа — для следующих запросов цепочки\n${mine.map((l) => `qa.set('${l.varName}', ${accessor(l.path)})`).join('\n')}\nreturn res.status`
    return req
  })
  // each link's variable starts with the recorded value (a single request runs too)
  // (a secret one — a token from a login — stays secret)
  for (const l of on) if (!vars.some((v) => v.key === l.varName)) setVar(l.varName, l.value, o.secrets && l.uses.some((u) => u.where === 'header' && SECRET_HEADER.test(u.key)))
  const main = [...hosts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'запись'
  const t = new Date(items[0]?.at ?? Date.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  const folder: HttpFolder = { id: httpId(), type: 'folder', name: `${main} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`, open: true, children: reqs }
  return { folder, vars }
}

/** What the window may ask the browser for (one IPC channel, the method's name first). */
export interface BrowserApi {
  list(): BrowserTab[]
  create(url?: string, opener?: string): BrowserTab
  close(id: string): void
  go(id: string, url: string): void
  nav(id: string, action: 'back' | 'fwd' | 'reload' | 'hard' | 'stop' | 'devtools'): void
  zoom(id: string, percent: number): void
  trust(id: string, host: string): void
  loginReply(reqId: string, user?: string, pass?: string): void
  cover(on: boolean): Promise<Record<string, string>>
  bookmarks(): Bookmark[]
  setBookmarks(list: Bookmark[]): void
  suggest(q: string): Array<{ url: string; title: string; bookmark: boolean }>
  clearHistory(): void
  folderMenu(id: string, x: number, y: number): void
  choose(items: Array<{ id: string; label: string }>, x: number, y: number): Promise<string | undefined>
  recState(): RecState
  rec(on: boolean, documents?: boolean): RecState
  recClear(): void
  recList(): RecItem[]
  recFull(ids: string[]): RecFull[]
  /** A downloaded file shown in its folder. */
  reveal(path: string): void
  /** Drops everything the site keeps (cache, cookies, storage) and reloads. */
  resetSite(id: string): Promise<void>
  passwords(): PasswordInfo[]
  pwAnswer(askId: string, answer: 'save' | 'no' | 'never'): void
  pwReveal(id: string): string
  pwDelete(id: string): void
  pwFill(tabId: string, id: string): void
  neverList(): string[]
  neverRemove(origin: string): void
  certInfo(id: string): CertInfo | undefined
  ruler(id: string, on: boolean): void
  savePage(id: string): Promise<void>
  viewSource(id: string): void
  swaggerFind(id: string): Promise<{ url: string; text: string } | { error: string; tried: string[] }>
}
export const BROWSER_METHODS: Array<keyof BrowserApi> = ['list', 'create', 'close', 'go', 'nav', 'zoom', 'trust', 'loginReply', 'cover', 'bookmarks', 'setBookmarks', 'suggest', 'clearHistory', 'folderMenu', 'choose', 'recState', 'rec', 'recClear', 'recList', 'recFull', 'reveal', 'resetSite', 'passwords', 'pwAnswer', 'pwReveal', 'pwDelete', 'pwFill', 'neverList', 'neverRemove', 'certInfo', 'ruler', 'swaggerFind', 'savePage', 'viewSource']
