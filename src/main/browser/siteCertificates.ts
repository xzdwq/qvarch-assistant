import { createHash, X509Certificate } from 'node:crypto'
import type { CertInfo } from '../../shared/browser'

/** A certificate's names («CN=…\nO=…») as a record. */
const names = (s: string) => Object.fromEntries(s.split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]))

/**
 * The sites' certificates as Chromium checked them (kept to show them — the check itself stays Chromium's) and the
 * hosts whose bad certificate the user accepted (this run only).
 */
export class SiteCertificates {
  private certs = new Map<string, { pem: string; result: string; chain: string[] }>()
  /** Hosts whose bad certificate the user accepted (this run only). */
  private trusted = new Set<string>()

  /** A site's certificate as Chromium checked it: kept (the newest 300 sites). */
  remember(req: Electron.Request): void {
    const chain: string[] = []
    for (let c = req.certificate.issuerCert; c && chain.length < 6; c = c.issuerCert) chain.push(c.subject?.commonName || c.subjectName)
    this.certs.delete(req.hostname)
    this.certs.set(req.hostname, { pem: req.certificate.data, result: req.verificationResult, chain })
    if (this.certs.size > 300) this.certs.delete(this.certs.keys().next().value!)
  }
  isTrusted(host: string): boolean {
    return this.trusted.has(host)
  }
  /** A bad certificate accepted: this host opens (until the app quits). */
  trust(host: string): void {
    this.trusted.add(host)
  }
  /** The site's connection: plain http, or its certificate (who, by whom, until when, fingerprints). */
  info(url: string): CertInfo | undefined {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return undefined
    }
    if (u.protocol === 'http:') return { host: u.host, secure: false }
    if (u.protocol !== 'https:') return undefined
    const c = this.certs.get(u.hostname)
    if (!c) return { host: u.host, secure: true, trusted: this.trusted.has(u.host) }
    try {
      const x = new X509Certificate(c.pem)
      return {
        host: u.host,
        secure: true,
        ok: c.result === 'net::OK',
        result: c.result,
        trusted: this.trusted.has(u.host),
        subject: names(x.subject),
        issuer: names(x.issuer),
        validFrom: Date.parse(x.validFrom),
        validTo: Date.parse(x.validTo),
        san: (x.subjectAltName ?? '').split(/,\s*/).map((s) => s.replace(/^DNS:/, '')).filter(Boolean).slice(0, 30),
        serial: x.serialNumber,
        sha256: createHash('sha256').update(x.raw).digest('hex'),
        keySha256: createHash('sha256').update(x.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
        chain: c.chain,
      }
    } catch {
      return { host: u.host, secure: true, result: c.result }
    }
  }
}
