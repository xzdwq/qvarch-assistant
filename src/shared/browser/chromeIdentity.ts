/**
 * The built-in browser as Google Chrome everywhere — its User-Agent, the Client Hints its requests carry (Sec-CH-UA…)
 * and what a page's script reads (navigator.userAgentData) all saying the same: Chrome of this version on this system.
 * Electron's Chromium names itself «Chromium» there (or nothing at all once the User-Agent is overridden). A
 * User-Agent of one's own (the settings) that is not Chrome's — no brands added: they would contradict it. Google's
 * sign-in pages — as Firefox (AS_FIREFOX): an embedded Chrome is refused there whatever it says.
 */
export interface UaBrand {
  brand: string
  version: string
}
/** As the DevTools protocol takes it (Emulation.setUserAgentOverride's userAgentMetadata). */
export interface UaMetadata {
  brands: UaBrand[]
  fullVersionList: UaBrand[]
  fullVersion: string
  platform: string
  platformVersion: string
  architecture: string
  model: string
  mobile: boolean
  bitness: string
  wow64: boolean
}
export interface UaSystem {
  /** Windows' version as Chrome reports it (10 — «10.0.0», 11 — «15.0.0»). */
  platformVersion: string
  architecture: 'x86' | 'arm'
  bitness: '64' | '32'
}
/** Windows' version as Chrome reports it, by the system's build (11 from build 22000 on). */
export const windowsPlatformVersion = (release: string): string => (Number(release.split('.')[2] ?? 0) >= 22000 ? '15.0.0' : '10.0.0')

/** The brands Chrome names itself by (the meaningless one first — as Chrome puts one in, so no site keys on the list's order). */
const brandsOf = (v: string): UaBrand[] => [
  { brand: 'Not)A;Brand', version: '8' },
  { brand: 'Chromium', version: v },
  { brand: 'Google Chrome', version: v },
]

/** Chrome's metadata by a User-Agent (not Chrome's — none: the User-Agent alone is told). */
export function chromeMetadata(ua: string, sys: UaSystem, mobile = false): UaMetadata | undefined {
  const m = /\bChrome\/(\d+)\.(\d+\.\d+\.\d+)/.exec(ua)
  if (!m || /\b(Edg|OPR|Firefox|YaBrowser)\//.test(ua)) return undefined
  const major = m[1]
  const full = `${m[1]}.${m[2]}`
  const fullBrands = brandsOf(major).map((b) => ({ brand: b.brand, version: b.brand === 'Not)A;Brand' ? `${b.version}.0.0.0` : full }))
  return {
    brands: brandsOf(major),
    fullVersionList: fullBrands,
    fullVersion: full,
    platform: /Android/.test(ua) ? 'Android' : /iPhone|iPad|Mac OS/.test(ua) ? 'macOS' : 'Windows',
    platformVersion: sys.platformVersion,
    architecture: sys.architecture,
    model: '',
    mobile,
    bitness: sys.bitness,
    wow64: false,
  }
}

const list = (bs: readonly UaBrand[]) => bs.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')
const str = (s: string) => `"${s}"`
/** Each Client Hint's header — its value by the metadata. */
const HINTS: Record<string, (m: UaMetadata) => string> = {
  'sec-ch-ua': (m) => list(m.brands),
  'sec-ch-ua-mobile': (m) => (m.mobile ? '?1' : '?0'),
  'sec-ch-ua-platform': (m) => str(m.platform),
  'sec-ch-ua-full-version-list': (m) => list(m.fullVersionList),
  'sec-ch-ua-full-version': (m) => str(m.fullVersion),
  'sec-ch-ua-platform-version': (m) => str(m.platformVersion),
  'sec-ch-ua-arch': (m) => str(m.architecture),
  'sec-ch-ua-bitness': (m) => str(m.bitness),
  'sec-ch-ua-model': (m) => str(m.model),
  'sec-ch-ua-wow64': (m) => (m.wow64 ? '?1' : '?0'),
}
/** The ones Chrome sends with every secure request (the rest — only to a site that asked for them). */
const ALWAYS = new Set(['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'])

// ---------- the sign-in pages that refuse an embedded Chrome: met as Firefox ----------
/**
 * The hosts the browser comes to as Firefox: Google's sign-in tells an embedded Chromium by what a real Chrome has and
 * Electron's has not (window.chrome's parts and more) and refuses it; Firefox is not judged by those. Everywhere else —
 * Chrome. One line per host.
 */
export const AS_FIREFOX: readonly string[] = ['accounts.google.com']
/** Firefox's User-Agent on Windows (a version of these days: an old one is refused as unsupported). */
export const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:146.0) Gecko/20100101 Firefox/146.0'
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}
/** A page / a request of a host met as Firefox. */
export const asFirefox = (url: string): boolean => AS_FIREFOX.includes(hostOf(url))
/**
 * What a Firefox page's script has not (navigator.userAgentData, window.chrome) taken away before the page's own
 * scripts run — on those hosts only (it is run in every document of the page; the others keep everything).
 */
export const FIREFOX_PAGE_SCRIPT = `(() => {
  if (!${JSON.stringify(AS_FIREFOX)}.includes(location.hostname)) return
  try { delete Navigator.prototype.userAgentData } catch {}
  try { delete window.chrome } catch {}
})()`

/**
 * A request's headers as the browser it comes as: to a host met as Firefox — Firefox's User-Agent, no Client Hints
 * (Firefox sends none); anywhere else — Chrome's Client Hints (withClientHints).
 */
export function identityHeaders(headers: Record<string, string>, url: string, ua: string, meta: UaMetadata | undefined): Record<string, string> {
  if (!asFirefox(url)) return withClientHints(headers, url, ua, meta)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase()
    if (key.startsWith('sec-ch-ua')) continue
    out[k] = key === 'user-agent' ? FIREFOX_UA : v
  }
  if (!Object.keys(out).some((k) => k.toLowerCase() === 'user-agent')) out['User-Agent'] = FIREFOX_UA
  return out
}

/**
 * A request's headers with Chrome's Client Hints: the ones it always sends set, the ones a site asked for (there in the
 * request) said Chrome's way. Only a secure request (Chrome sends none over http) and only with this User-Agent (a
 * device mode's own — left as it is).
 */
export function withClientHints(headers: Record<string, string>, url: string, ua: string, meta: UaMetadata | undefined): Record<string, string> {
  if (!meta || !/^https:/i.test(url)) return headers
  const sent = Object.entries(headers).find(([k]) => k.toLowerCase() === 'user-agent')?.[1]
  if (sent !== undefined && sent !== ua) return headers
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    const hint = k.toLowerCase()
    out[k] = Object.hasOwn(HINTS, hint) ? HINTS[hint](meta) : v
  }
  for (const hint of ALWAYS) if (!Object.keys(out).some((k) => k.toLowerCase() === hint)) out[hint] = HINTS[hint](meta)
  return out
}
