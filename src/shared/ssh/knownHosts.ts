/**
 * OpenSSH's known_hosts: which key each server is known by. Lines: `[@marker] hosts keytype base64key [comment]`;
 * hosts — comma-separated names or patterns (* ?, !negation), `[host]:port` for a port other than 22, or hashed
 * `|1|salt|hash` (HMAC-SHA1 of the host's token under the salt — `hmac` does it, the caller has the crypto).
 */

/** HMAC-SHA1 of `data` under `key`, both base64 / text as given → the base64 digest. */
export type HostHmac = (saltBase64: string, data: string) => string

/** How a host is written in known_hosts: the name for port 22, else `[name]:port`. */
export const hostToken = (host: string, port: number) => (port === 22 ? host.toLowerCase() : `[${host.toLowerCase()}]:${port}`)

/** A shell-style pattern (* ?) against a token, case-insensitive. */
function patternMatches(pattern: string, token: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
  return re.test(token)
}

/** The hosts field of a line against a host: one positive match and no negated one. */
function hostsMatch(field: string, token: string, hmac: HostHmac): boolean {
  let hit = false
  for (const raw of field.split(',')) {
    const neg = raw.startsWith('!')
    const p = neg ? raw.slice(1) : raw
    const hashed = p.match(/^\|1\|([^|]+)\|([^|]+)$/)
    const m = hashed ? safeHmac(hmac, hashed[1], token) === hashed[2] : patternMatches(p, token)
    if (m && neg) return false
    if (m) hit = true
  }
  return hit
}
function safeHmac(hmac: HostHmac, salt: string, data: string): string {
  try {
    return hmac(salt, data)
  } catch {
    return ''
  }
}

export interface KnownKey {
  keyType: string
  key: string
  revoked: boolean
}
/** The keys the file knows a host by (a CA's lines are not keys of the host — skipped). */
export function keysOf(text: string, host: string, port: number, hmac: HostHmac): KnownKey[] {
  const token = hostToken(host, port)
  const out: KnownKey[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const parts = t.split(/\s+/)
    const marker = parts[0].startsWith('@') ? parts.shift() : undefined
    if (marker === '@cert-authority' || parts.length < 3) continue
    if (hostsMatch(parts[0], token, hmac)) out.push({ keyType: parts[1], key: parts[2], revoked: marker === '@revoked' })
  }
  return out
}

export const HOST_KEY_VERDICTS = ['known', 'unknown', 'changed', 'revoked'] as const
export type HostKeyVerdict = (typeof HOST_KEY_VERDICTS)[number]
/**
 * A server's key against what is known of it: the same key — known; revoked — refused; another key of the same type —
 * changed (a possible attack); nothing of that type — unknown (asked once).
 */
export function hostKeyVerdict(known: readonly KnownKey[], keyType: string, key: string): HostKeyVerdict {
  if (known.some((k) => k.revoked && k.key === key)) return 'revoked'
  if (known.some((k) => !k.revoked && k.key === key)) return 'known'
  if (known.some((k) => !k.revoked && k.keyType === keyType)) return 'changed'
  return 'unknown'
}

/** The line that makes a host known by its key. */
export const knownHostLine = (host: string, port: number, keyType: string, key: string) => `${hostToken(host, port)} ${keyType} ${key}`

/** A key blob's type: its first SSH string (uint32 length, then the name — 'ssh-ed25519', 'rsa-sha2-512'…). */
export function keyTypeOfBlob(blob: Uint8Array): string {
  if (blob.length < 4) return ''
  const len = ((blob[0] << 24) | (blob[1] << 16) | (blob[2] << 8) | blob[3]) >>> 0
  if (len === 0 || len > 64 || 4 + len > blob.length) return ''
  let s = ''
  for (let i = 4; i < 4 + len; i++) s += String.fromCharCode(blob[i])
  return /^[\x21-\x7e]+$/.test(s) ? s : ''
}
