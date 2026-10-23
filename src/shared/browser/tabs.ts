import type { DeviceMode } from './devices'

/**
 * Браузер: tabs (each a page of its own, a profile apart from the app), one or two panes, bookmarks, the history,
 * saved logins, the section's settings — the data the main process and the window share.
 */
export interface BrowserTab {
  id: string
  url: string
  title: string
  favicon?: string
  loading: boolean
  canBack: boolean
  canFwd: boolean
  /** The page's zoom, %. */
  zoom: number
  /** The developer tools are open (docked under the page). */
  devtools?: boolean
  /** The rulers are shown over the page. */
  ruler?: boolean
  /** The device mode: the page as on that device. */
  device?: DeviceMode
  /** Asleep: not looked at for a while, its page unloaded (it loads again when shown). */
  asleep?: boolean
  /** The page did not open (no network, a bad certificate…). */
  error?: { code: number; desc: string; url: string; cert?: boolean; host?: string }
}
export interface Bookmark {
  id: string
  title: string
  /** None — a folder. */
  url?: string
  /** The site's icon (data:) — saved with it. */
  icon?: string
  children?: Bookmark[]
}
/** A page's connection: plain http, or its certificate. */
export interface CertInfo {
  host: string
  secure: boolean
  /** Chromium found the certificate fine. */
  ok?: boolean
  /** The check's result (net::OK, net::ERR_CERT_…). */
  result?: string
  /** Opened anyway (the user accepted a bad one). */
  trusted?: boolean
  subject?: Record<string, string>
  issuer?: Record<string, string>
  validFrom?: number
  validTo?: number
  san?: string[]
  serial?: string
  sha256?: string
  keySha256?: string
  /** The issuers up to the root. */
  chain?: string[]
}
/** A saved login (the password itself is asked for one by one). */
export interface PasswordInfo {
  id: string
  origin: string
  username: string
  saved: number
  used?: number
}
export interface HistoryItem {
  url: string
  title: string
  last: number
  count: number
}
/** One opening of a page (the history, by days). */
export interface Visit {
  id: string
  url: string
  title: string
  at: number
}
export interface BrowserSettings {
  /** Pages opened are remembered (the history, the address line's suggestions). */
  history: boolean
  /** The User-Agent the pages see; '' — the built-in one (Chrome). */
  ua: string
  /**
   * Sites with a bad certificate (own / expired / for another name) open without asking — internal sites. The
   * lock before the address turns red; the connection is not proven safe then.
   */
  acceptBadCerts: boolean
  /** A tab not looked at for this many minutes falls asleep — its page process is freed (0 — never). */
  sleepMin: number
}
export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = { history: true, ua: '', acceptBadCerts: true, sleepMin: 15 }

export const browserId = () => Math.random().toString(36).slice(2, 10)
/** What the address line turns into a URL: a host → https, words → a search. */
export function toUrl(text: string): string {
  const t = text.trim()
  if (!t) return 'about:blank'
  if (/^(https?|file|about|data|view-source):/i.test(t)) return t
  if (/^localhost(:\d+)?(\/|$)/i.test(t) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(t)) return `http://${t}`
  if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t)) return `https://${t}`
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`
}
