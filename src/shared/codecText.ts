import { b64ToBytes, bytesToB64 } from './codec'

/** The codec tool's formatting and hash-text helpers (pure): times, sizes, hashes as hex / Base64. */

/** A moment as dd.mm.yyyy, hh:mm:ss (local time). */
export const fmtTime = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** A byte count in Б / КБ / МБ. */
export const fmtSize = (n: number) => (n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(2)} МБ`)

/** A hex digest as Base64. */
export const hexToB64 = (hex: string) => bytesToB64(Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)))

/** A pasted hash without spaces / line breaks. */
export const normHash = (s: string) => s.trim().replace(/\s+/g, '')

/** Bytes as lower-case hex. */
const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/** A hash given as hex (any case) or Base64 → lower-case hex (Base64 that does not decode throws). */
export function hashHex(s: string): string {
  return /^[0-9a-f]+$/i.test(s) ? s.toLowerCase() : toHex(b64ToBytes(s).bytes)
}

/** The expected hash typed by the user → hex ('' — nothing typed, '?' — neither hex nor Base64). */
export function expectedHex(typed: string): string {
  const e = normHash(typed)
  if (!e) return ''
  try {
    return hashHex(e)
  } catch {
    return '?'
  }
}

/** A digest as shown: Base64, or hex (upper case if asked). */
export const showDigest = (hex: string, b64: boolean, upper: boolean) => (b64 ? hexToB64(hex) : upper ? hex.toUpperCase() : hex)
