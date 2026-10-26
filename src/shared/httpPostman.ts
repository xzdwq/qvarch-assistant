import { HTTP_METHODS, httpId, kv, newRequest, type HttpAuth, type HttpBody, type HttpFolder, type HttpKV, type HttpMethod, type HttpNode, type HttpRequest } from './http'

/**
 * A Postman file into the HTTP section: a collection (v2.0 / v2.1 — its folders, requests with their params, headers,
 * bodies and authorization, inherited from the folders and the collection as Postman does; its variables) or an
 * environment (its variables). What can't come over (a binary body, a kind of authorization unknown here) is told; the
 * scripts (`pm.*` — not this app's API) come as comments, to be carried by hand.
 */
export interface PostmanImport {
  /** The collection as a folder (none — an environment: variables only). */
  folder?: HttpFolder
  vars: Array<HttpKV & { secret?: boolean }>
  /** What did not come over as it was, for the person. */
  notes: string[]
}

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
const str = (x: unknown): string => (typeof x === 'string' ? x : typeof x === 'number' || typeof x === 'boolean' ? String(x) : '')
/** A Postman text: a string or lines (`exec`, `description`). */
const lines = (x: unknown): string => (Array.isArray(x) ? x.map(str).join('\n') : str(x))
const decode = (s: string): string => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}
/** Postman's `{key, value, disabled}` rows. */
const rowsOf = (x: unknown): HttpKV[] => arr(x).filter(isObj).filter((r) => str(r.key)).map((r) => kv(str(r.key), str(r.value), r.disabled !== true))

/** A Postman file read: a collection or an environment; anything else — an error in words. */
export function postmanImport(json: unknown): PostmanImport {
  if (!isObj(json)) throw new Error('Это не файл Postman (нужен JSON коллекции или окружения)')
  if (Array.isArray(json.values)) return environmentOf(json)
  if (isObj(json.info) && Array.isArray(json.item)) return collectionOf(json)
  if (Array.isArray(json.collections)) throw new Error('Это полная выгрузка Postman — экспортируйте коллекцию отдельно (Export → Collection v2.1)')
  if (Array.isArray(json.requests)) throw new Error('Коллекция в старом формате Postman v1 — экспортируйте её заново как Collection v2.1')
  throw new Error('Не похоже на коллекцию или окружение Postman')
}

function environmentOf(env: Obj): PostmanImport {
  const vars = arr(env.values)
    .filter(isObj)
    .filter((v) => str(v.key))
    .map((v) => ({ ...kv(str(v.key), str(v.value), v.enabled !== false), ...(v.type === 'secret' ? { secret: true } : {}) }))
  return { vars, notes: [] }
}

/** What the import met along the way. */
class Notes {
  private counts = new Map<string, number>()
  add(what: string): void {
    this.counts.set(what, (this.counts.get(what) ?? 0) + 1)
  }
  list(): string[] {
    return [...this.counts].map(([what, n]) => (n > 1 ? `${what} — ${n}` : what))
  }
}

function collectionOf(c: Obj): PostmanImport {
  const notes = new Notes()
  const info = c.info as Obj
  const auth = authOf(c.auth, NO_AUTH, notes)
  if (hasScripts(c.event)) notes.add('скрипты коллекции не перенесены (pm.*)')
  const folder: HttpFolder = { id: httpId(), type: 'folder', name: str(info.name) || 'Postman', open: true, children: nodesOf(c.item, auth, notes) }
  const vars = arr(c.variable)
    .filter(isObj)
    .filter((v) => str(v.key))
    .map((v) => ({ ...kv(str(v.key), str(v.value), v.disabled !== true), ...(v.type === 'secret' ? { secret: true } : {}) }))
  return { folder, vars, notes: notes.list() }
}

function nodesOf(items: unknown, auth: Auth, notes: Notes): HttpNode[] {
  return arr(items)
    .filter(isObj)
    .map((it): HttpNode => {
      if (Array.isArray(it.item)) {
        if (hasScripts(it.event)) notes.add('скрипты папок не перенесены (pm.*)')
        return { id: httpId(), type: 'folder', name: str(it.name) || 'Папка', open: false, children: nodesOf(it.item, authOf(it.auth, auth, notes), notes) }
      }
      return requestOf(it, auth, notes)
    })
}

function requestOf(it: Obj, inherited: Auth, notes: Notes): HttpRequest {
  // (v2.0: a request may be its address alone)
  const r: Obj = isObj(it.request) ? it.request : { url: str(it.request), method: 'GET' }
  const req = newRequest(str(it.name) || 'Запрос')
  const method = str(r.method).toUpperCase() || 'GET'
  if ((HTTP_METHODS as readonly string[]).includes(method)) req.method = method as HttpMethod
  else notes.add(`метод ${method} заменён на GET`)
  const { url, params } = urlOf(r.url)
  req.url = url
  req.params = params
  req.headers = typeof r.header === 'string' ? headerLines(r.header) : rowsOf(r.header)
  const body = bodyOf(r.body, notes)
  if (body) req.body = body
  const auth = authOf(r.auth, inherited, notes)
  req.auth = auth.auth
  req.headers.push(...auth.headers)
  req.params.push(...auth.params)
  const pre = scriptOf(it.event, 'prerequest')
  const post = scriptOf(it.event, 'test')
  if (pre) req.pre.script = commented(pre, notes)
  if (post) req.post = commented(post, notes)
  return req
}

/** «Key: value» lines (a v2.0 header as text). */
const headerLines = (s: string): HttpKV[] =>
  s
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([^:]+?)\s*:\s*(.*)$/))
    .flatMap((m) => (m ? [kv(m[1], m[2])] : []))

/**
 * The address without its query (the query → params, on and off), a path's `:name` → its value, or `{{name}}` when it
 * has none (a port's `:8080` is not one: a path's variable follows a «/»).
 */
export function urlOf(u: unknown): { url: string; params: HttpKV[] } {
  const raw = isObj(u) ? str(u.raw) || joinUrl(u) : str(u)
  const at = raw.indexOf('?')
  const base = at < 0 ? raw : raw.slice(0, at)
  const pathVars = isObj(u) ? arr(u.variable).filter(isObj) : []
  const url = base.replace(/\/:([A-Za-z_][\w-]*)/g, (_, name: string) => {
    const v = str(pathVars.find((x) => str(x.key) === name)?.value)
    return `/${v || `{{${name}}}`}`
  })
  const params =
    isObj(u) && Array.isArray(u.query)
      ? u.query.filter(isObj).filter((q) => str(q.key)).map((q) => kv(decode(str(q.key)), decode(str(q.value)), q.disabled !== true))
      : at < 0
        ? []
        : raw
            .slice(at + 1)
            .split('&')
            .filter(Boolean)
            .map((p) => {
              const eq = p.indexOf('=')
              return eq < 0 ? kv(decode(p), '') : kv(decode(p.slice(0, eq)), decode(p.slice(eq + 1)))
            })
  return { url, params }
}
/** An address put together from its parts (an object without `raw`). */
function joinUrl(u: Obj): string {
  const host = Array.isArray(u.host) ? u.host.map(str).join('.') : str(u.host)
  const path = Array.isArray(u.path) ? u.path.map((p) => (isObj(p) ? str(p.value) : str(p))).join('/') : str(u.path)
  const port = str(u.port)
  return `${u.protocol ? `${str(u.protocol)}://` : ''}${host}${port ? `:${port}` : ''}${path ? `/${path}` : ''}`
}

// ---------- the body ----------
/** A raw body's language → its type (json — the JSON mode). */
const RAW_TYPES: Record<string, string> = { text: 'text/plain', javascript: 'application/javascript', html: 'text/html', xml: 'application/xml' }
const textBody = (mode: HttpBody['mode'], text: string, rawType = 'text/plain'): HttpBody => ({ mode, text, rawType, rows: [] })
const formFile = (r: Obj) => kv(str(r.key), `«файл: ${lines(r.src) || 'не указан'}» — выберите заново`, false)
/** Each Postman body mode: the body here (undefined — none). */
const BODIES: Record<string, (b: Obj, notes: Notes) => HttpBody | undefined> = {
  raw: (b) => {
    const text = str(b.raw)
    const lang = isObj(b.options) && isObj(b.options.raw) ? str(b.options.raw.language) : ''
    if (lang === 'json' || (!lang && /^\s*[[{]/.test(text))) return textBody('json', text)
    return textBody('raw', text, Object.hasOwn(RAW_TYPES, lang) ? RAW_TYPES[lang] : 'text/plain')
  },
  urlencoded: (b) => ({ mode: 'urlencoded', text: '', rawType: 'text/plain', rows: rowsOf(b.urlencoded) }),
  formdata: (b, notes) => {
    const rows = arr(b.formdata)
      .filter(isObj)
      .filter((r) => str(r.key))
      .map((r) => {
        if (r.type !== 'file') return kv(str(r.key), str(r.value), r.disabled !== true)
        notes.add('файлы в form-data надо выбрать заново')
        return formFile(r)
      })
    return { mode: 'form', text: '', rawType: 'text/plain', rows }
  },
  graphql: (b) => {
    const g = isObj(b.graphql) ? b.graphql : {}
    let variables: unknown = undefined
    try {
      variables = str(g.variables).trim() ? JSON.parse(str(g.variables)) : undefined
    } catch {
      variables = str(g.variables)
    }
    return textBody('json', JSON.stringify({ query: str(g.query), ...(variables !== undefined ? { variables } : {}) }, null, 2))
  },
  file: (_b, notes) => {
    notes.add('тело-файл (binary) не перенесено')
    return undefined
  },
}
function bodyOf(b: unknown, notes: Notes): HttpBody | undefined {
  if (!isObj(b) || !str(b.mode) || b.disabled === true) return undefined
  const make = Object.hasOwn(BODIES, str(b.mode)) ? BODIES[str(b.mode)] : undefined
  if (!make) {
    notes.add(`тело «${str(b.mode)}» не перенесено`)
    return undefined
  }
  return make(b, notes)
}

// ---------- the authorization ----------
/** An authorization as it comes to a request: the auth itself, and what goes as a header or a param (an API key). */
interface Auth {
  auth: HttpAuth
  headers: HttpKV[]
  params: HttpKV[]
}
const NO_AUTH: Auth = { auth: { type: 'none', token: '', user: '', pass: '' }, headers: [], params: [] }
/** A Postman auth's fields: v2.1 — `[{key, value}]`, v2.0 — `{key: value}`. */
function fieldsOf(x: unknown): Record<string, string> {
  if (isObj(x)) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, str(v)]))
  return Object.fromEntries(arr(x).filter(isObj).map((f) => [str(f.key), str(f.value)]))
}
const auth = (a: Partial<HttpAuth>): Auth => ({ ...NO_AUTH, auth: { ...NO_AUTH.auth, ...a } })
/** Each Postman auth type: the auth here (undefined — not carried). */
const AUTHS: Record<string, (f: Record<string, string>, inherited: Auth) => Auth | undefined> = {
  noauth: () => NO_AUTH,
  inherit: (_f, inherited) => inherited,
  bearer: (f) => auth({ type: 'bearer', token: f.token ?? '' }),
  basic: (f) => auth({ type: 'basic', user: f.username ?? '', pass: f.password ?? '' }),
  apikey: (f) => {
    const row = kv(f.key || 'X-API-Key', f.value ?? '')
    return f.in === 'query' ? { ...NO_AUTH, params: [row] } : { ...NO_AUTH, headers: [row] }
  },
  // a token got already — sent as a Bearer one (getting a new one is Postman's flow, not carried)
  oauth2: (f) => (f.accessToken ? auth({ type: 'bearer', token: f.accessToken }) : undefined),
}
function authOf(a: unknown, inherited: Auth, notes: Notes): Auth {
  // none set — the folder's / the collection's
  if (!isObj(a) || !str(a.type)) return inherited
  const type = str(a.type)
  const made = Object.hasOwn(AUTHS, type) ? AUTHS[type](fieldsOf(a[type]), inherited) : undefined
  if (made) return made
  notes.add(`авторизация «${type}» не перенесена — задайте её в запросе`)
  return NO_AUTH
}

// ---------- the scripts ----------
const scriptOf = (events: unknown, listen: string): string =>
  arr(events)
    .filter(isObj)
    .filter((e) => e.listen === listen && isObj(e.script))
    .map((e) => lines((e.script as Obj).exec))
    .join('\n')
    .trim()
const hasScripts = (events: unknown) => !!(scriptOf(events, 'prerequest') || scriptOf(events, 'test'))
/** A Postman script kept as a comment (its `pm.*` is not this app's `qa` / `res`). */
function commented(script: string, notes: Notes): string {
  notes.add('скрипты Postman сохранены комментарием — перенесите вручную')
  return `/* Скрипт из Postman (pm.* здесь не работает — перепишите на qa / res):\n${script.replace(/\*\//g, '* /')}\n*/`
}
