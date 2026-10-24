import { createPublicKey, timingSafeEqual, verify } from 'node:crypto'
import { codeProof, deviceIdOf } from '../../src/main/transport/keys'

/**
 * Who a connection is, without accounts: the app's Ed25519 public key signs the server's challenge; the device is
 * the key's fingerprint; the access code (when the server has one) is proved by an HMAC of the challenge. The key
 * math is the app's (src/main/transport/keys.ts) — one definition for both ends.
 */
export { deviceIdOf }

/** The challenge signed by this key (a key that is not an Ed25519 one — no). */
export function checkSignature(keyB64: string, nonce: string, sigB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(keyB64, 'base64'), format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519') return false
    return verify(null, Buffer.from(nonce), key, Buffer.from(sigB64, 'base64'))
  } catch {
    return false
  }
}

/** The access code proved (the server without one — anyone passes). */
export function checkProof(code: string, nonce: string, proofB64: string): boolean {
  if (!code) return true
  const want = Buffer.from(codeProof(code, nonce), 'base64')
  const got = Buffer.from(proofB64, 'base64')
  return got.length === want.length && timingSafeEqual(got, want)
}

/** A token bucket: `burst` at once, then `perSec` a second (a connection flooding the server is cut off). */
export class Bucket {
  private tokens: number
  private at: number
  constructor(
    private readonly burst: number,
    private readonly perSec: number,
    now = Date.now(),
  ) {
    this.tokens = burst
    this.at = now
  }
  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.perSec)
    this.at = now
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}
