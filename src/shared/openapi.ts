import { hostKey } from './browser'
import { httpId, kv, newRequest, type HttpFolder, type HttpKV, type HttpNode, type HttpRequest } from './http'

/**
 * Swagger / OpenAPI → the HTTP section: every operation of a spec (OpenAPI 3 or Swagger 2), and the picked ones
 * as requests — the address via {{base_host}}, path params as {{name}}, query / header params as rows (required
 * ones on), a JSON body built from its schema with empty values ("" / 0 / false / [] / {…}), the auth the spec
 * names as a secret variable.
 */
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

export interface ApiOp {
  /** method + path — unique in a spec. */
  id: string
  method: string
  path: string
  summary: string
  tag: string
  operationId?: string
  deprecated?: boolean
}
export interface ApiSpec {
  title: string
  version: string
  /** OpenAPI 3.x / Swagger 2.0. */
  kind: string
  ops: ApiOp[]
}

/** The spec's own `$ref` (#/components/schemas/X, #/definitions/X, …) → what it points at. */
function deref(spec: Obj, v: unknown, seen = new Set<string>()): unknown {
  if (!isObj(v) || typeof v.$ref !== 'string') return v
  const ref = v.$ref
  if (!ref.startsWith('#/') || seen.has(ref)) return {}
  seen.add(ref)
  let cur: unknown = spec
  for (const part of ref.slice(2).split('/')) cur = isObj(cur) ? cur[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined
  return deref(spec, cur, seen)
}

/** A list of what a spec offers (its operations, by tag). Throws when it is not OpenAPI / Swagger. */
export function readSpec(spec: unknown): ApiSpec {
  if (!isObj(spec) || !(typeof spec.openapi === 'string' || typeof spec.swagger === 'string') || !isObj(spec.paths)) throw new Error('Это не описание OpenAPI / Swagger (нет openapi / swagger и paths)')
  const info = isObj(spec.info) ? spec.info : {}
  const ops: ApiOp[] = []
  for (const [path, item] of Object.entries(spec.paths)) {
    if (!isObj(item)) continue
    for (const m of METHODS) {
      const op = item[m]
      if (!isObj(op)) continue
      const tags = Array.isArray(op.tags) ? (op.tags as string[]) : []
      ops.push({
        id: `${m.toUpperCase()} ${path}`,
        method: m.toUpperCase(),
        path,
        summary: String(op.summary ?? op.description ?? '').split('\n')[0].slice(0, 160),
        tag: tags[0] ?? 'без тега',
        operationId: typeof op.operationId === 'string' ? op.operationId : undefined,
        deprecated: op.deprecated === true || undefined,
      })
    }
  }
  return { title: String(info.title ?? 'API'), version: String(info.version ?? ''), kind: typeof spec.openapi === 'string' ? `OpenAPI ${spec.openapi}` : `Swagger ${String(spec.swagger)}`, ops }
}

/** The value a schema itself suggests: its default, its example, the first of its examples / its enum. */
function suggested(s: Obj): { v: unknown } | undefined {
  if ('default' in s) return { v: s.default }
  if ('example' in s) return { v: s.example }
  if (Array.isArray(s.examples) && s.examples.length) return { v: s.examples[0] }
  if (Array.isArray(s.enum) && s.enum.length) return { v: s.enum[0] }
  return undefined
}
/**
 * A value shaped by a schema: "" for text, 0 for numbers, false, [], and objects with every field — or, with
 * `defaults`, what the schema suggests (default, example, the first enum value) wherever it says something.
 */
export function emptyOf(spec: Obj, schema: unknown, o: { defaults?: boolean } = {}, depth = 0, seen = new Set<string>()): unknown {
  if (depth > 8) return null
  if (o.defaults && isObj(schema)) {
    const hit = suggested(schema)
    if (hit) return hit.v
  }
  if (isObj(schema) && typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return {}
    const next = new Set(seen).add(schema.$ref)
    return emptyOf(spec, deref(spec, schema), o, depth + 1, next)
  }
  if (!isObj(schema)) return null
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf.map((s) => emptyOf(spec, s, o, depth + 1, seen))
    return parts.every(isObj) ? Object.assign({}, ...parts) : (parts[0] ?? null)
  }
  const alt = (Array.isArray(schema.oneOf) && schema.oneOf[0]) || (Array.isArray(schema.anyOf) && schema.anyOf[0])
  if (alt) return emptyOf(spec, alt, o, depth + 1, seen)
  const type = Array.isArray(schema.type) ? (schema.type as string[]).find((t) => t !== 'null') : schema.type
  if (type === 'object' || (!type && isObj(schema.properties))) {
    const out: Obj = {}
    for (const [k, v] of Object.entries(isObj(schema.properties) ? schema.properties : {})) {
      if (isObj(v) && v.readOnly === true) continue
      out[k] = emptyOf(spec, v, o, depth + 1, seen)
    }
    return out
  }
  if (typeof type === 'string' && Object.hasOwn(EMPTY_SCALAR, type)) return EMPTY_SCALAR[type]()
  if (Array.isArray(schema.enum)) return ''
  return null
}
/** The empty value of a schema's (non-object) type. */
const EMPTY_SCALAR: Record<string, () => unknown> = { array: () => [], integer: () => 0, number: () => 0, boolean: () => false, string: () => '' }
/** A parameter's value as text: what its schema suggests (with `defaults`), else empty. */
function paramValue(spec: Obj, p: Obj, defaults: boolean): string {
  // nothing suggested anywhere — the field stays blank (an empty shape says nothing)
  if (!defaults || !suggestedAnywhere(spec, p)) return ''
  const own = suggested(p)
  const v = 'example' in p ? p.example : own ? own.v : emptyOf(spec, p.schema, { defaults: true })
  if (v === null || v === undefined) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}
/** The parameter (or its schema, through $ref) names a default / an example / an enum. */
function suggestedAnywhere(spec: Obj, p: Obj): boolean {
  if (suggested(p) || 'example' in p) return true
  let s: unknown = p.schema
  for (let i = 0; i < 5 && isObj(s); i++) {
    if (suggested(s)) return true
    s = typeof s.$ref === 'string' ? deref(spec, { $ref: s.$ref }) : undefined
  }
  return false
}
/** What a transfer fills in. */
export interface SpecToHttpOptions {
  /** Defaults, examples, the first enum value — in params and bodies. */
  defaults?: boolean
  /** Optional params switched on too (else only the required ones). */
  optional?: boolean
}

/** Where the API is: OpenAPI 3 servers (relative to the spec, {vars} by their defaults), Swagger 2 host + basePath. */
export function serverOf(spec: Obj, specUrl: string): string {
  let base = ''
  if (Array.isArray(spec.servers) && isObj(spec.servers[0]) && typeof spec.servers[0].url === 'string') {
    const s = spec.servers[0]
    const vars = isObj(s.variables) ? s.variables : {}
    base = (s.url as string).replace(/\{(\w+)\}/g, (_, k: string) => String((isObj(vars[k]) && (vars[k] as Obj).default) ?? ''))
  } else if (typeof spec.swagger === 'string') {
    const u = new URL(specUrl)
    const scheme = Array.isArray(spec.schemes) && spec.schemes.length ? String(spec.schemes.includes(u.protocol.slice(0, -1)) ? u.protocol.slice(0, -1) : spec.schemes[0]) : u.protocol.slice(0, -1)
    base = `${scheme}://${typeof spec.host === 'string' ? spec.host : u.host}${typeof spec.basePath === 'string' ? spec.basePath : ''}`
  }
  try {
    return new URL(base || '/', specUrl).href.replace(/\/$/, '')
  } catch {
    return new URL(specUrl).origin
  }
}

/** How a request carries the login a security scheme names: the auth tab, or an API key in a header / the query. */
type AuthKind = 'bearer' | 'basic' | 'header' | 'query'
/** An HTTP security scheme (`scheme`) → its auth. */
const HTTP_SCHEME_AUTH: Record<string, AuthKind> = { bearer: 'bearer', basic: 'basic' }
/** Where an API key may go. */
const API_KEY_PLACES: readonly AuthKind[] = ['header', 'query']
/** The auth a security scheme means; undefined — one not filled in. */
function authKindOf(s: Obj): AuthKind | undefined {
  switch (s.type) {
    case 'http': {
      const scheme = String(s.scheme).toLowerCase()
      return Object.hasOwn(HTTP_SCHEME_AUTH, scheme) ? HTTP_SCHEME_AUTH[scheme] : undefined
    }
    case 'oauth2':
    case 'openIdConnect':
      return 'bearer'
    case 'basic':
      return 'basic'
    case 'apiKey':
      return API_KEY_PLACES.find((place) => place === s.in)
    default:
      return undefined
  }
}

/** The picked operations as a folder of requests (by tag when there are several), and their variables. */
export function specToHttp(spec: unknown, specUrl: string, ids: string[], opt: SpecToHttpOptions = {}): { folder: HttpFolder; vars: Array<HttpKV & { secret?: boolean }> } {
  if (!isObj(spec) || !isObj(spec.paths)) throw new Error('Нет описания API')
  const info = readSpec(spec)
  const server = serverOf(spec, specUrl)
  const hk = hostKey(new URL(server).host)
  const baseVar = `base_${hk}`
  const vars: Array<HttpKV & { secret?: boolean }> = [kv(baseVar, server)]
  const secret = (name: string) => {
    if (!vars.some((v) => v.key === name)) vars.push({ ...kv(name, ''), secret: true })
    return `{{${name}}}`
  }
  const schemes = isObj(spec.components) && isObj(spec.components.securitySchemes) ? spec.components.securitySchemes : isObj(spec.securityDefinitions) ? spec.securityDefinitions : {}
  const byTag = new Map<string, HttpRequest[]>()
  for (const id of ids) {
    const o = info.ops.find((x) => x.id === id)
    if (!o) continue
    const item = spec.paths[o.path] as Obj
    const op = item[o.method.toLowerCase()] as Obj
    const req = newRequest(`${o.path}${o.summary ? ` — ${o.summary}` : ''}`.slice(0, 140))
    req.method = o.method as HttpRequest['method']
    // the path's {param} → {{param}} (a variable — or type the value in)
    req.url = `{{${baseVar}}}${o.path.replace(/\{([^}]+)\}/g, '{{$1}}')}`
    const params = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])].map((p) => deref(spec, p)).filter(isObj)
    let swaggerBody: unknown
    const form: HttpKV[] = []
    for (const p of params) {
      const name = String(p.name ?? '')
      const req1 = p.required === true || !!opt.optional
      const value = paramValue(spec, p, !!opt.defaults)
      switch (p.in) {
        case 'query':
          req.params.push(kv(name, value, req1))
          break
        case 'header':
          // (the auth and the body's type are set by their own sections)
          if (!/^(authorization|content-type|accept)$/i.test(name)) req.headers.push(kv(name, value, req1))
          break
        case 'path':
          // a path param with a known value goes straight into the address
          if (value) req.url = req.url.split(`{{${name}}}`).join(encodeURIComponent(value))
          break
        case 'body':
          swaggerBody = p.schema
          break
        case 'formData':
          form.push(kv(name, value, req1 || p.type !== 'file'))
          break
      }
    }
    // the body: JSON from its schema, or a form
    const rb = deref(spec, op.requestBody)
    const content = isObj(rb) && isObj(rb.content) ? rb.content : undefined
    const json = content && Object.keys(content).find((c) => /json/i.test(c))
    const formType = content && Object.keys(content).find((c) => /x-www-form-urlencoded|multipart\/form-data/i.test(c))
    if (json || swaggerBody) {
      const schema = json ? (content![json] as Obj).schema : swaggerBody
      req.body = { mode: 'json', text: JSON.stringify(emptyOf(spec, schema, { defaults: opt.defaults }), null, 2) ?? '', rawType: 'text/plain', rows: [] }
    } else if (formType) {
      const schema = deref(spec, (content![formType] as Obj).schema)
      const props = isObj(schema) && isObj(schema.properties) ? schema.properties : {}
      req.body = { mode: /multipart/i.test(formType) ? 'form' : 'urlencoded', text: '', rawType: 'text/plain', rows: Object.entries(props).map(([k, v]) => {
        const x = opt.defaults ? emptyOf(spec, v, { defaults: true }) : ''
        return kv(k, x === null || x === undefined || (opt.defaults && !(isObj(v) && suggested(v))) ? '' : String(x))
      }) }
    } else if (form.length) req.body = { mode: (Array.isArray(op.consumes) ? op.consumes : spec.consumes ?? []).toString().includes('multipart') ? 'form' : 'urlencoded', text: '', rawType: 'text/plain', rows: form }
    // the auth the operation (or the whole spec) asks for
    const sec = (Array.isArray(op.security) ? op.security : Array.isArray(spec.security) ? spec.security : []) as Obj[]
    for (const name of sec.flatMap((s) => (isObj(s) ? Object.keys(s) : []))) {
      const s = deref(spec, schemes[name])
      if (!isObj(s)) continue
      const kind = authKindOf(s)
      if (!kind) continue
      // (an API key: a variable named after the key)
      const keyVar = () => secret(`${String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${hk}`)
      const fillAuth: Record<AuthKind, () => void> = {
        bearer: () => (req.auth = { type: 'bearer', token: secret(`token_${hk}`), user: '', pass: '' }),
        basic: () => (req.auth = { type: 'basic', token: '', user: secret(`user_${hk}`), pass: secret(`password_${hk}`) }),
        header: () => req.headers.push(kv(String(s.name), keyVar())),
        query: () => req.params.push(kv(String(s.name), keyVar())),
      }
      fillAuth[kind]()
      break
    }
    if (!byTag.has(o.tag)) byTag.set(o.tag, [])
    byTag.get(o.tag)!.push(req)
  }
  const t = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const children: HttpNode[] = byTag.size > 1 ? [...byTag].map(([tag, reqs]) => ({ id: httpId(), type: 'folder' as const, name: tag, open: false, children: reqs })) : [...byTag.values()].flat()
  return { folder: { id: httpId(), type: 'folder', name: `${info.title}${info.version ? ` ${info.version}` : ''} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`, open: true, children }, vars }
}

/** A body mode that becomes plain text (the others — a file form, none — are left out): its type and its text. */
const BODY_AS_TEXT: Partial<Record<HttpRequest['body']['mode'], { contentType: string; text: (b: HttpRequest['body']) => string }>> = {
  json: { contentType: 'application/json', text: (b) => b.text },
  urlencoded: {
    contentType: 'application/x-www-form-urlencoded',
    text: (b) => b.rows.filter((x) => x.on && x.key).map((x) => `${encodeURIComponent(x.key)}=${encodeURIComponent(x.value)}`).join('&'),
  },
}

/**
 * The picked operations as plain requests (for the notebook's blocks, the clipboard): the server's address put in, the
 * query and the headers the description asks for, the body made from its schema. Path parameters with no value stay as
 * {{name}} (the note asks for them); the login is the site's own (put in by who writes the block), not the variables.
 */
export function specExamples(spec: unknown, specUrl: string, ids: string[], opt: SpecToHttpOptions = {}): Array<{ method: string; url: string; body?: string; contentType?: string; headers: Array<[string, string]> }> {
  const { folder, vars } = specToHttp(spec, specUrl, ids, opt)
  const base = vars[0]
  const reqs: HttpRequest[] = []
  const walk = (n: HttpNode) => (n.type === 'request' ? reqs.push(n) : n.children.forEach(walk))
  walk(folder)
  return reqs.map((r) => {
    let url = r.url.split(`{{${base.key}}}`).join(base.value)
    const q = r.params.filter((p) => p.on && p.key).map((p) => `${encodeURIComponent(p.key)}=${/\{\{[^}]+\}\}/.test(p.value) ? p.value : encodeURIComponent(p.value)}`)
    if (q.length) url += `${url.includes('?') ? '&' : '?'}${q.join('&')}`
    const asText = Object.hasOwn(BODY_AS_TEXT, r.body.mode) ? BODY_AS_TEXT[r.body.mode] : undefined
    const body = asText?.text(r.body)
    const contentType = asText?.contentType
    return { method: r.method, url, ...(body ? { body, contentType } : {}), headers: r.headers.filter((h) => h.on && h.key).map((h) => [h.key, h.value] as [string, string]) }
  })
}
