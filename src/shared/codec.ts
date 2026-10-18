/**
 * Encodings: Base64 (UTF-8, URL-safe), JWT (decode, sign HS256/384/512 with WebCrypto, verify), UUID (v1 / v4 / v7
 * made, any one read: valid, version, variant, its time for v1 / v6 / v7).
 */

// ---------- Base64 ----------
export function b64encode(text: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const s = btoa(bin)
  return urlSafe ? s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : s
}
/** Base64 (plain or URL-safe, with or without padding, spaces ignored) → text; throws on a bad one. */
export function b64decode(s: string): string {
  const clean = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('Это не Base64: допустимы A–Z, a–z, 0–9, + / (или - _) и = в конце')
  const pad = clean + '='.repeat((4 - (clean.length % 4)) % 4)
  const bin = atob(pad)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
/** Bytes → Base64 (in chunks: a big file must not overflow the call stack). */
export function bytesToB64(bytes: Uint8Array, urlSafe = false): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const s = btoa(bin)
  return urlSafe ? s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : s
}
/** Base64 (or a data: URL) → its bytes and the type the data: URL named; throws on a bad one. */
export function b64ToBytes(s: string): { bytes: Uint8Array; mime?: string } {
  const m = /^\s*data:([\w.+-]+\/[\w.+-]+)?(?:;[\w-]+=[^;,]*)*;base64,/i.exec(s)
  const clean = (m ? s.slice(m[0].length) : s).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('Это не Base64: допустимы A–Z, a–z, 0–9, + / (или - _) и = в конце')
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4))
  return { bytes: Uint8Array.from(bin, (c) => c.charCodeAt(0)), mime: m?.[1]?.toLowerCase() }
}
/** A file's type by its first bytes (pictures, PDF, archives…); undefined — not known. */
export function sniffMime(b: Uint8Array): { mime: string; ext: string; image: boolean } | undefined {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  const txt = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0))
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { mime: 'image/png', ext: 'png', image: true }
  if (at(0, 0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: 'jpg', image: true }
  if (txt(0, 'GIF8')) return { mime: 'image/gif', ext: 'gif', image: true }
  if (txt(0, 'RIFF') && txt(8, 'WEBP')) return { mime: 'image/webp', ext: 'webp', image: true }
  if (txt(0, 'BM')) return { mime: 'image/bmp', ext: 'bmp', image: true }
  if (at(0, 0, 0, 1, 0)) return { mime: 'image/x-icon', ext: 'ico', image: true }
  if (txt(4, 'ftypavif')) return { mime: 'image/avif', ext: 'avif', image: true }
  const head = new TextDecoder().decode(b.subarray(0, 300)).trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(head)) return { mime: 'image/svg+xml', ext: 'svg', image: true }
  if (txt(0, '%PDF')) return { mime: 'application/pdf', ext: 'pdf', image: false }
  if (at(0, 0x50, 0x4b, 3, 4)) return { mime: 'application/zip', ext: 'zip', image: false }
  if (at(0, 0x1f, 0x8b)) return { mime: 'application/gzip', ext: 'gz', image: false }
  return undefined
}
/** Bytes as UTF-8 text, or undefined when they are not (binary data). */
export function asText(b: Uint8Array): string | undefined {
  try {
    const t = new TextDecoder('utf-8', { fatal: true }).decode(b)
    // control characters other than tabs / line breaks — binary
    return /[\u0000-\u0008\u000e-\u001f]/.test(t) ? undefined : t
  } catch {
    return undefined
  }
}

// ---------- what an encoded string is ----------
export type HashAlg = 'md5' | 'sha1' | 'sha256' | 'sha512'
export const HASH_ALGS: Array<{ id: HashAlg; title: string; bits: number }> = [
  { id: 'md5', title: 'MD5', bits: 128 },
  { id: 'sha1', title: 'SHA-1', bits: 160 },
  { id: 'sha256', title: 'SHA-256', bits: 256 },
  { id: 'sha512', title: 'SHA-512', bits: 512 },
]
export interface Sniffed {
  kind: 'hash' | 'crypt' | 'jwt' | 'uuid' | 'base64' | 'hex' | 'url'
  title: string
  note: string
  /** The hash algorithms it may be (a hex / Base64 digest). */
  algs?: HashAlg[]
  /** What it decodes to (text). */
  decoded?: string
}
/** What a pasted string may already be: a hash (by its length), bcrypt / argon2, JWT, UUID, Base64, hex, %-encoding. */
export function sniffEncoded(input: string): Sniffed[] {
  const s = input.trim()
  if (!s || s.length > 100_000) return []
  const out: Sniffed[] = []
  const crypt = /^\$(2[abxy]?|argon2(?:id|i|d)|1|5|6|y|scrypt|pbkdf2[\w-]*)\$/.exec(s)
  if (crypt) {
    const name = crypt[1].startsWith('2') ? 'bcrypt' : crypt[1].startsWith('argon2') ? crypt[1] : crypt[1] === '1' ? 'MD5-crypt' : crypt[1] === '5' ? 'SHA-256-crypt' : crypt[1] === '6' ? 'SHA-512-crypt' : crypt[1] === 'y' ? 'yescrypt' : crypt[1]
    out.push({ kind: 'crypt', title: `Хэш пароля ${name}`, note: 'Со своей солью и числом раундов: необратим, проверяется только самой системой входа.' })
    return out
  }
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(s) && s.startsWith('eyJ')) out.push({ kind: 'jwt', title: 'JWT', note: 'Токен: заголовок, данные и подпись — откройте во вкладке JWT.' })
  if (/^[{(]?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}[)}]?$/i.test(s) && s.includes('-')) out.push({ kind: 'uuid', title: 'UUID', note: 'Идентификатор — подробности во вкладке UUID.' })
  if (/^[0-9a-f]+$/i.test(s)) {
    const algs = HASH_ALGS.filter((a) => a.bits / 4 === s.length).map((a) => a.id)
    if (algs.length) out.push({ kind: 'hash', title: `Похоже на ${algs.map((a) => HASH_ALGS.find((x) => x.id === a)!.title).join(' / ')}`, note: `${s.length} шестнадцатеричных символов = ${s.length * 4} бит. Хэш необратим: исходный текст из него не получить, но можно проверить догадку.`, algs })
    else if (s.length % 2 === 0 && s.length >= 4) {
      const t = asText(Uint8Array.from(s.match(/../g)!, (h) => parseInt(h, 16)))
      if (t && t.trim()) out.push({ kind: 'hex', title: 'Hex (байты в шестнадцатеричном виде)', note: 'Это текст:', decoded: t })
    }
  }
  if (/%[0-9a-f]{2}/i.test(s)) {
    try {
      const d = decodeURIComponent(s.replace(/\+/g, ' '))
      if (d !== s) out.push({ kind: 'url', title: 'URL-кодирование (%XX)', note: 'Это текст:', decoded: d })
    } catch {
      // a lone % — not URL encoding
    }
  }
  if (!out.some((x) => x.kind === 'jwt' || x.kind === 'hash') && s.length >= 8 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(s.replace(/\s+/g, ''))) {
    try {
      const { bytes } = b64ToBytes(s)
      const algs = HASH_ALGS.filter((a) => a.bits / 8 === bytes.length).map((a) => a.id)
      const t = asText(bytes)
      if (algs.length && !t) out.push({ kind: 'hash', title: `Похоже на ${algs.map((a) => HASH_ALGS.find((x) => x.id === a)!.title).join(' / ')} в Base64`, note: `${bytes.length} байт = ${bytes.length * 8} бит. Хэш необратим, но догадку можно проверить.`, algs })
      else if (t && /[\p{L}\p{N}]{2}/u.test(t)) out.push({ kind: 'base64', title: 'Base64', note: 'Это текст:', decoded: t })
      else if (sniffMime(bytes)) out.push({ kind: 'base64', title: `Base64 — файл ${sniffMime(bytes)!.ext.toUpperCase()}`, note: 'Откройте во вкладке Base64, чтобы увидеть или сохранить.' })
    } catch {
      // not Base64
    }
  }
  return out
}

const b64urlBytes = (bytes: Uint8Array) => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------- JWT ----------
export type JwtAlg = 'HS256' | 'HS384' | 'HS512'
export const JWT_ALGS: JwtAlg[] = ['HS256', 'HS384', 'HS512']
export interface JwtParts {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: string
  /** The header.payload as it stands in the token (what the signature covers). */
  signed: string
}
export function jwtDecode(token: string): JwtParts {
  const t = token.trim().replace(/^Bearer\s+/i, '')
  const p = t.split('.')
  if (p.length !== 3) throw new Error(`В JWT три части через точку, здесь ${p.length}`)
  const part = (s: string, name: string) => {
    try {
      const v = JSON.parse(b64decode(s)) as unknown
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('не объект')
      return v as Record<string, unknown>
    } catch (e) {
      throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { header: part(p[0], 'Заголовок'), payload: part(p[1], 'Данные'), signature: p[2], signed: `${p[0]}.${p[1]}` }
}
const HASH: Record<JwtAlg, string> = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' }
async function hmac(alg: JwtAlg, secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: HASH[alg] }, false, ['sign'])
  return b64urlBytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))))
}
/** A token from its parts: signed with the secret (HS*), else with the signature it had (marked invalid). */
export async function jwtEncode(header: Record<string, unknown>, payload: Record<string, unknown>, secret: string, keepSignature = ''): Promise<string> {
  const signed = `${b64encode(JSON.stringify(header), true)}.${b64encode(JSON.stringify(payload), true)}`
  const alg = String(header.alg ?? '') as JwtAlg
  if (alg.toLowerCase() === 'none') return `${signed}.`
  if (JWT_ALGS.includes(alg) && secret) return `${signed}.${await hmac(alg, secret, signed)}`
  return `${signed}.${keepSignature}`
}
/** The signature checked with the secret: true / false; undefined — cannot tell (not HS*, no secret). */
export async function jwtVerify(token: string, secret: string): Promise<boolean | undefined> {
  const j = jwtDecode(token)
  const alg = String(j.header.alg ?? '') as JwtAlg
  if (!JWT_ALGS.includes(alg) || !secret) return undefined
  return (await hmac(alg, secret, j.signed)) === j.signature
}
/** The time claims of a payload, readable. */
export function jwtTimes(payload: Record<string, unknown>, now = Date.now()): Array<{ key: string; at: number; note: string }> {
  const out: Array<{ key: string; at: number; note: string }> = []
  for (const key of ['iat', 'nbf', 'exp', 'auth_time']) {
    const v = payload[key]
    if (typeof v !== 'number') continue
    const at = v * 1000
    const note = key === 'exp' ? (at < now ? 'истёк' : 'действует') : key === 'nbf' ? (at > now ? 'ещё не действует' : '') : ''
    out.push({ key, at, note })
  }
  return out
}

// ---------- UUID ----------
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const fmt = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n))
/** Gregorian 100-ns ticks between 1582-10-15 and 1970-01-01. */
const GREG = 122192928000000000n
let lastV1 = 0n
let seqV1 = Number(new DataView(rnd(2).buffer).getUint16(0) & 0x3fff)
export function uuid(version: 1 | 4 | 7, now = Date.now()): string {
  if (version === 4) {
    const b = rnd(16)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    return fmt(hex(b))
  }
  if (version === 7) {
    const b = rnd(16)
    const ms = BigInt(now)
    for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn)
    b[6] = (b[6] & 0x0f) | 0x70
    b[8] = (b[8] & 0x3f) | 0x80
    return fmt(hex(b))
  }
  // v1: the time in 100 ns since 1582, a clock sequence, a random node (multicast bit set — not a real MAC)
  let t = BigInt(now) * 10000n + GREG
  if (t <= lastV1) t = lastV1 + 1n
  lastV1 = t
  const tl = t & 0xffffffffn
  const tm = (t >> 32n) & 0xffffn
  const th = ((t >> 48n) & 0x0fffn) | 0x1000n
  seqV1 = (seqV1 + 1) & 0x3fff
  const node = rnd(6)
  node[0] |= 0x01
  return `${tl.toString(16).padStart(8, '0')}-${tm.toString(16).padStart(4, '0')}-${th.toString(16).padStart(4, '0')}-${(0x8000 | seqV1).toString(16)}-${hex(node)}`
}
export interface UuidInfo {
  valid: boolean
  /** The canonical form (lower case, dashes). */
  canonical?: string
  version?: number
  variant?: string
  /** When it was made (v1 / v6 / v7). */
  time?: number
  note?: string
}
export function uuidInfo(input: string): UuidInfo {
  const s = input.trim().replace(/^urn:uuid:/i, '').replace(/^\{|\}$/g, '')
  const h = s.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(h) || (s.includes('-') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))) return { valid: false, note: 'Не UUID: нужно 32 шестнадцатеричных знака (обычно 8-4-4-4-12)' }
  const canonical = fmt(h)
  if (/^0{32}$/.test(h)) return { valid: true, canonical, version: 0, variant: '—', note: 'Nil UUID (все нули)' }
  if (/^f{32}$/.test(h)) return { valid: true, canonical, version: 15, variant: '—', note: 'Max UUID (все F)' }
  const version = parseInt(h[12], 16)
  const v = parseInt(h[16], 16)
  const variant = (v & 0x8) === 0 ? 'NCS (устаревший)' : (v & 0xc) === 0x8 ? 'RFC 9562 (стандартный)' : (v & 0xe) === 0xc ? 'Microsoft (GUID старого вида)' : 'зарезервированный'
  let time: number | undefined
  if (version === 7) time = Number(BigInt(`0x${h.slice(0, 12)}`))
  else if (version === 1) time = Number((((BigInt(`0x${h.slice(13, 16)}`) << 48n) | (BigInt(`0x${h.slice(8, 12)}`) << 32n) | BigInt(`0x${h.slice(0, 8)}`)) - GREG) / 10000n)
  else if (version === 6) time = Number((((BigInt(`0x${h.slice(0, 8)}`) << 28n) | (BigInt(`0x${h.slice(8, 12)}`) << 12n) | BigInt(`0x${h.slice(13, 16)}`)) - GREG) / 10000n)
  const known = version >= 1 && version <= 8
  return { valid: known && variant.startsWith('RFC'), canonical, version, variant, time, note: known ? undefined : `Версия ${version} не определена стандартом` }
}
