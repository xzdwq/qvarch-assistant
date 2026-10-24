import { createHash, createHmac, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'

/**
 * A device's key math, shared with the transport server (server/src/auth.ts) — so no Electron here. The app's
 * Ed25519 key pair is made once; the device is known by the public key's fingerprint; the server's challenge is
 * signed with the private key; the access code is proved by an HMAC of the challenge (the code never travels).
 */
export interface DeviceKeys {
  /** SPKI DER, base64. */
  publicKey: string
  /** PKCS#8 DER, base64. */
  privateKey: string
}

export function makeKeys(): DeviceKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') }
}

/** A device's id: its public key's SHA-256, the first 32 hex digits. */
export const deviceIdOf = (publicKey: string): string => createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 32)

/** The proof of an access code for a challenge ('' — no code). */
export const codeProof = (code: string, nonce: string): string => (code ? createHmac('sha256', code).update(nonce).digest('base64') : '')

/** What the connection signs in with. */
export interface Signer {
  publicKey: string
  sign(nonce: string): string
  proof(nonce: string): string
}
export function signerOf(keys: DeviceKeys, code: () => string): Signer {
  const key = createPrivateKey({ key: Buffer.from(keys.privateKey, 'base64'), format: 'der', type: 'pkcs8' })
  return {
    publicKey: keys.publicKey,
    sign: (nonce) => sign(null, Buffer.from(nonce), key).toString('base64'),
    proof: (nonce) => codeProof(code(), nonce),
  }
}
