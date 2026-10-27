import { describe, expect, it } from 'vitest'
import { asFirefox, chromeMetadata, FIREFOX_UA, identityHeaders, windowsPlatformVersion, withClientHints } from '../../src/shared/browser/chromeIdentity'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.97 Safari/537.36'
const SYS = { platformVersion: '15.0.0', architecture: 'x86' as const, bitness: '64' as const }

describe('the built-in browser as Google Chrome', () => {
  const meta = chromeMetadata(UA, SYS)!
  it('Chrome’s brands and versions by its User-Agent', () => {
    expect(meta.brands.map((b) => b.brand)).toContain('Google Chrome')
    expect(meta.brands.find((b) => b.brand === 'Google Chrome')?.version).toBe('138')
    expect(meta.fullVersionList.find((b) => b.brand === 'Chromium')?.version).toBe('138.0.7204.97')
    expect(meta).toMatchObject({ platform: 'Windows', platformVersion: '15.0.0', mobile: false, bitness: '64' })
  })
  it('a User-Agent that is not Chrome’s (one’s own) — no brands to contradict it', () => {
    expect(chromeMetadata('Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0', SYS)).toBeUndefined()
    expect(chromeMetadata(`${UA} Edg/138.0.0.0`, SYS)).toBeUndefined()
  })
  it('Windows 11 by its build', () => {
    expect(windowsPlatformVersion('10.0.26200')).toBe('15.0.0')
    expect(windowsPlatformVersion('10.0.19045')).toBe('10.0.0')
  })
  it('a secure request: the hints always sent set, the asked ones said Chrome’s way, the rest as they were', () => {
    const h = withClientHints({ 'User-Agent': UA, 'sec-ch-ua': '"Chromium";v="138"', 'Sec-CH-UA-Full-Version-List': '"Chromium";v="138.0.7204.97"', Accept: '*/*' }, 'https://accounts.google.com/', UA, meta)
    expect(h['sec-ch-ua']).toContain('"Google Chrome";v="138"')
    expect(h['Sec-CH-UA-Full-Version-List']).toContain('"Google Chrome";v="138.0.7204.97"')
    expect(h['sec-ch-ua-platform']).toBe('"Windows"')
    expect(h['sec-ch-ua-mobile']).toBe('?0')
    expect(h.Accept).toBe('*/*')
  })
  it('plain http, a device mode’s own User-Agent, no metadata — left as they are', () => {
    const plain = { 'User-Agent': UA }
    expect(withClientHints(plain, 'http://x.test/', UA, meta)).toBe(plain)
    const phone = { 'User-Agent': 'Mozilla/5.0 (iPhone…)' }
    expect(withClientHints(phone, 'https://x.test/', UA, meta)).toBe(phone)
    expect(withClientHints(plain, 'https://x.test/', UA, undefined)).toBe(plain)
  })
})

describe('Google sign-in as Firefox', () => {
  const meta = chromeMetadata(UA, SYS)!
  it('only the sign-in host', () => {
    expect(asFirefox('https://accounts.google.com/v3/signin')).toBe(true)
    expect(asFirefox('https://www.google.com/')).toBe(false)
    expect(asFirefox('not a url')).toBe(false)
  })
  it('its requests: Firefox’s User-Agent, no Client Hints', () => {
    const h = identityHeaders({ 'User-Agent': UA, 'sec-ch-ua': '"Chromium";v="138"', 'Sec-CH-UA-Platform': '"Windows"', Accept: '*/*' }, 'https://accounts.google.com/', UA, meta)
    expect(h).toEqual({ 'User-Agent': FIREFOX_UA, Accept: '*/*' })
  })
  it('anywhere else — Chrome’s hints as before', () => {
    const h = identityHeaders({ 'User-Agent': UA }, 'https://mail.google.com/', UA, meta)
    expect(h['User-Agent']).toBe(UA)
    expect(h['sec-ch-ua']).toContain('"Google Chrome"')
  })
})
