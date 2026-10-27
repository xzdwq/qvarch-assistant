import type { BrowserWindow, Session, WebContents, WebContentsView } from 'electron'
import type { BrowserTab, Visit } from '../../shared/browser'
import type { UaMetadata } from '../../shared/browser/chromeIdentity'
import type { TabCdp } from './tabCdp'

/**
 * Who keeps a tab's DevTools protocol attached (the recording, the device mode, a hook's search, «Проверка», a
 * scenario; `chrome` — the page told it is Chrome, all its life).
 */
export type CdpOwner = 'rec' | 'device' | 'hook' | 'check' | 'pw' | 'chrome'

/** A tab of the Браузер section as the main process keeps it: its page (a view of its own) and what is on it. */
export interface Tab {
  t: BrowserTab
  view: WebContentsView
  /** Recording: the protocol is attached. */
  rec: boolean
  /** The developer tools, docked under the page (a view of their own). */
  dev?: WebContentsView
  /** The rulers over the page: on, and the guides pulled out of them (px from the left / the top). */
  ruler: { on: boolean; v: number[]; h: number[] }
  /** Who keeps the protocol attached (the recording, the device mode, a hook's search). */
  dbg: Set<CdpOwner>
  /** «Проверка»: its watcher's script registered for the tab's new pages. */
  checkScript?: string
  /** The contexts of the watcher's own world — what goes wrong there is not the page's. */
  checkCtx?: Set<number>
  /** A hook's search: the page's requests so far (id → what it is). */
  hookReq?: Map<string, { url: string; method: string; type?: string; mime?: string; status?: number }>
  /** The page's own HTML (its request): Chromium tells no «loadingFinished» for it — taken when the page has loaded. */
  hookDoc?: string
  /** The device mode's scale as last told to the page. */
  devScale?: number
  /** This tab's last visit (its title comes later). */
  visit?: Visit
  /** Its page unloaded (the view closed) — made again when it is shown. */
  asleep?: boolean
  /** When it was last on the screen. */
  seen: number
}
export type Box = { x: number; y: number; w: number; h: number }
/** Where a visible tab's page goes (the renderer's rectangle), its docked tools, its device-mode scale. */
export type Rect = Box & { id: string; dev?: Box; scale?: number }

/** What the browser's parts share: the tabs, the profile's session, the window, the news to the renderer. */
export interface BrowserHost {
  readonly tabs: Map<string, Tab>
  readonly ses: Session
  readonly cdp: TabCdp
  /** The main window (none before the first one is made). */
  window(): BrowserWindow | undefined
  emit(type: string, payload: unknown): void
  /** The tabs' list told to the renderer. */
  changed(): void
  /** The tab whose page sent an IPC message (an asleep one has none). */
  byContents(wc: WebContents): Tab | undefined
  /** A tab asleep made again. */
  wake(t: Tab): void
  /** A tab opened by the app itself, made the shown one of its pane. */
  open(url: string): BrowserTab
  create(url?: string, opener?: string): BrowserTab
  /** The User-Agent the pages get ('' in the settings — the built-in one). */
  userAgent(): string
  /**
   * The page told it is Chrome (Emulation.setUserAgentOverride's parameters): the User-Agent (`ua` — a device's own)
   * with Chrome's metadata — the Client Hints and navigator.userAgentData say the same (not Chrome's — the User-Agent alone).
   */
  uaOverride(ua?: string, mobile?: boolean): { userAgent: string; userAgentMetadata?: UaMetadata }
}

/** An http(s) page's origin, or '' (any other address). */
export function originOf(url: string): string {
  try {
    const o = new URL(url).origin
    return /^https?:/.test(o) ? o : ''
  } catch {
    return ''
  }
}
export function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}
