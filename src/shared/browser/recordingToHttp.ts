import { httpId, kv, newRequest, type HttpFolder, type HttpKV, type HttpRequest } from '../http'
import { DROP_HEADERS, hostKey, linkable, parseBody, pathText, SECRET_HEADER } from './recordedRequest'
import { accessor, type LinkUse, type RecLink } from './recordingLinks'
import type { RecFull } from './recording'

/** A recording → requests of the HTTP section. */
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
    switch (body.kind) {
      case 'json': {
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
        break
      }
      case 'rows':
        req.body = { mode: body.mode, text: '', rawType: 'text/plain', rows: body.rows.map((x) => ({ ...x, value: uses('body', x.key)?.value === x.value ? `{{${uses('body', x.key)!.varName}}}` : x.value })) }
        // multipart: the boundary is the client's business
        if (body.mode === 'form') req.headers = req.headers.filter((h) => h.key.toLowerCase() !== 'content-type')
        break
      case 'raw':
        req.body = { mode: 'raw', text: body.text, rawType: body.type, rows: [] }
        break
      case 'none':
        break
      default: {
        const unknownBody: never = body
        void unknownBody
      }
    }
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
