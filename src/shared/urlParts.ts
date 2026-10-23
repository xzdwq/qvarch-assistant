/**
 * An address in parts a person edits: scheme, host (with its port), path, the query's parameters (each on / off, its
 * key and value readable — decoded), the hash; a router's address after # (#/route?x=1) with parameters of its own.
 * Built back: a parameter left as it was keeps its encoding exactly; a changed one is encoded anew.
 */
export interface UrlParam {
  key: string
  value: string
  /** As it was written (encoded) — kept when the key and value are not changed. */
  raw?: string
  on: boolean
}
export interface UrlParts {
  scheme: string
  host: string
  path: string
  params: UrlParam[]
  /** The hash without its parameters (#/route, #section). */
  hash: string
  /** A router's parameters after # (#/route?x=1). */
  hashParams: UrlParam[]
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}
/** A query's text («a=1&b=%D0%B0») → its parameters. */
export function parseQuery(q: string): UrlParam[] {
  return q
    .replace(/^\?/, '')
    .split('&')
    .filter((x) => x !== '')
    .map((raw) => {
      const i = raw.indexOf('=')
      const k = i < 0 ? raw : raw.slice(0, i)
      const v = i < 0 ? '' : raw.slice(i + 1)
      return { key: decode(k), value: decode(v), raw, on: true }
    })
}
/** A parameter as written: its own text when unchanged, else encoded (the characters a query keeps as they are kept). */
function written(p: UrlParam): string {
  if (p.raw !== undefined) {
    const i = p.raw.indexOf('=')
    const k = i < 0 ? p.raw : p.raw.slice(0, i)
    const v = i < 0 ? '' : p.raw.slice(i + 1)
    if (decode(k) === p.key && decode(v) === p.value) return p.raw
  }
  const enc = (s: string) => encodeURIComponent(s).replace(/%(2C|3A|2F|40|5B|5D|24|21|2A|27|28|29|7E)/gi, (m) => decodeURIComponent(m))
  return p.value === '' && p.raw !== undefined && !p.raw.includes('=') ? enc(p.key) : `${enc(p.key)}=${enc(p.value)}`
}
export const buildQuery = (ps: UrlParam[]) => {
  const on = ps.filter((p) => p.on && p.key !== '')
  return on.length ? `?${on.map(written).join('&')}` : ''
}

export function parseUrl(url: string): UrlParts {
  const m = /^([a-z][\w+.-]*:)?(?:\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(url.trim()) ?? []
  const hash = m[5] ?? ''
  // a router's address after #: its own parameters
  const hq = hash.indexOf('?')
  return {
    scheme: (m[1] ?? 'https:').replace(/:$/, ''),
    host: m[2] ?? '',
    path: m[3] ?? '',
    params: parseQuery(m[4] ?? ''),
    hash: hq < 0 ? hash : hash.slice(0, hq),
    hashParams: hq < 0 ? [] : parseQuery(hash.slice(hq + 1)),
  }
}
export function buildUrl(p: UrlParts): string {
  const hash = p.hash || p.hashParams.some((x) => x.on && x.key) ? `${p.hash.startsWith('#') || !p.hash ? p.hash : `#${p.hash}`}${buildQuery(p.hashParams)}` : ''
  const path = p.path && !p.path.startsWith('/') && p.host ? `/${p.path}` : p.path
  return `${p.scheme ? `${p.scheme}:` : ''}${p.host ? `//${p.host}` : ''}${path}${buildQuery(p.params)}${hash}`
}
