import type { ApiEndpoint } from '../apiMap'
import type { CheckProblem, CheckSettings, CheckState } from '../check'
import type { BrowserHook, HookHit, HookStatus } from '../hooks'
import type { DeviceMode } from './devices'
import type { ImportSource } from './browserImport'
import type { PwRecState, RecFull, RecItem, RecState } from './recording'
import type { Bookmark, BrowserSettings, BrowserTab, CertInfo, PasswordInfo, Visit } from './tabs'
import type { DownloadState, NavAction, PageKeyCommand, PwAnswer } from './constants'

/** An «Карта API» site as its list shows it. */
export type ApiMapHost = { host: string; endpoints: number; calls: number; last: number }

/** The browser's news to the window, by name → what it carries (one map: the main side's emit and the window's handlers). */
export interface BrowserEvents {
  tabs: BrowserTab[]
  /** A tab the app opened (a recording, a link, a run): shown in the current pane. */
  activate: { id: string }
  /** A page opened a tab (target=_blank): next to it. */
  opened: { id: string; opener: string }
  /** A page took the focus (a click on it). */
  pageFocus: { id: string }
  /** A key pressed in a page that is the section's own. */
  key: { id: string; key: PageKeyCommand }
  /** A bookmark folder's pick. */
  open: { url: string; newTab: boolean }
  /** A site asks to sign in (Windows / basic auth). */
  login: { reqId: string; tabId: string; host: string; realm: string }
  download: { name: string; path: string; state: DownloadState }
  settings: BrowserSettings
  bookmarks: Bookmark[]
  /** The history changed (the window reads it again if shown). */
  history: null
  rec: { state: RecState; items: RecItem[] }
  /** The requests' recording could not start in a tab. */
  recError: string
  /** A tab's device mode could not be applied. */
  deviceError: string
  pwrec: PwRecState | undefined
  /** A page's login sent: keep it? */
  pwAsk: { askId: string; origin: string; username: string; update: boolean }
  passwords: PasswordInfo[]
  check: { state: CheckState; problems: CheckProblem[] }
  apimap: { hosts: ApiMapHost[] }
  hooks: BrowserHook[]
  hookHits: { hookId: string; hits: HookHit[] }
  hookStatus: HookStatus
}
export type BrowserEventName = keyof BrowserEvents
/** One event as the IPC carries it: its name, then its payload (a callback's parameters narrow by the name). */
export type BrowserEventArgs = { [K in BrowserEventName]: [type: K, payload: BrowserEvents[K]] }[BrowserEventName]
/** The main side's sender of the browser's news. */
export type BrowserEmit = <K extends BrowserEventName>(type: K, payload: BrowserEvents[K]) => void
/** A window's handlers of some of the browser's news: each named one handled, its payload typed. */
export type BrowserEventTable<K extends BrowserEventName> = { [P in K]: (payload: BrowserEvents[P]) => void }
/** An event given to its handler in a table (one not in the table — nothing). */
export function dispatchBrowserEvent<K extends BrowserEventName>(table: BrowserEventTable<K>, ...[type, payload]: BrowserEventArgs): void {
  if (!Object.hasOwn(table, type)) return
  // (the name and the payload come as a pair: the handler of this name takes this payload)
  ;(table[type as K] as (p: BrowserEvents[BrowserEventName]) => void)(payload)
}

/** What the window may ask the browser for (one IPC channel, the method's name first). */
export interface BrowserApi {
  /** Recording a scenario: a new tab at `url`; its clicks and typing become Playwright lines. */
  pwRecStart(note: string, key: string, url: string, screen?: { w: number; h: number }): BrowserTab
  /** Recording stopped: what was recorded (cancelled — nothing). */
  pwRecStop(cancel?: boolean): Promise<{ note: string; key: string; url: string; lines: string[] } | undefined>
  pwRecState(): PwRecState | undefined
  hooksList(): BrowserHook[]
  hookPut(h: Partial<BrowserHook>): BrowserHook
  hookRemove(id: string): void
  hookHits(id: string): HookHit[]
  hookClearHits(id: string): void
  hookSkip(): void
  hookPause(on: boolean): HookStatus
  hookStatus(): HookStatus
  hookReapply(id: string): void
  list(): BrowserTab[]
  create(url?: string, opener?: string): BrowserTab
  close(id: string): void
  go(id: string, url: string): void
  nav(id: string, action: NavAction): void
  zoom(id: string, percent: number): void
  trust(id: string, host: string): void
  loginReply(reqId: string, user?: string, pass?: string): void
  /** The shown pages' pictures (by tab id; `id:dev` — its docked tools'), JPEG in base64. */
  shots(): Promise<Record<string, string>>
  /** The shown pages hidden while something of the app is over them (their pictures in their place), or back. */
  cover(on: boolean): void
  bookmarks(): Bookmark[]
  setBookmarks(list: Bookmark[]): void
  suggest(q: string): Array<{ url: string; title: string; bookmark: boolean }>
  clearHistory(): void
  /** Every page opening kept, newest first. */
  visits(): Visit[]
  /** Visits forgotten: these, or all from `from` to `to` (ms). */
  visitsDelete(ids: string[] | { from: number; to: number }): void
  settings(): BrowserSettings
  setSettings(patch: Partial<BrowserSettings>): BrowserSettings
  /** The built-in User-Agent (what '' means). */
  defaultUa(): string
  /** A tab as a device (undefined — as itself). */
  device(id: string, d?: DeviceMode): void
  folderMenu(id: string, x: number, y: number): void
  choose(items: Array<{ id: string; label: string; checked?: boolean }>, x: number, y: number): Promise<string | undefined>
  recState(): RecState
  rec(on: boolean, documents?: boolean): RecState
  recClear(): void
  recList(): RecItem[]
  recFull(ids: string[]): RecFull[]
  /** A downloaded file shown in its folder. */
  reveal(path: string): void
  /** Drops everything the site keeps (cache, cookies, storage) and reloads. */
  resetSite(id: string): Promise<void>
  passwords(): PasswordInfo[]
  pwAnswer(askId: string, answer: PwAnswer): void
  pwReveal(id: string): string
  pwDelete(id: string): void
  pwFill(tabId: string, id: string): void
  /** Moving in: the other browsers' profiles found here; one's bookmarks taken; an exported passwords file taken. */
  importSources(): ImportSource[]
  importBookmarks(sourceId: string): { added: number; skipped: number }
  importPasswords(): Promise<{ added: number; updated: number; skipped: number } | undefined>
  neverList(): string[]
  neverRemove(origin: string): void
  certInfo(id: string): CertInfo | undefined
  ruler(id: string, on: boolean): void
  savePage(id: string): Promise<void>
  viewSource(id: string): void
  swaggerFind(id: string): Promise<{ url: string; text: string } | { error: string; tried: string[] }>
  /** «Проверка»: on / off and its settings, the tabs it could not watch. */
  apiMapHosts(): ApiMapHost[]
  apiMapList(host?: string): ApiEndpoint[]
  /** The site's login as its requests carried it (token headers — the latest seen, kept in memory only; the session's cookies). */
  apiMapAuth(url: string): Promise<Array<[string, string]>>
  apiMapClear(host?: string): void
  checkState(): CheckState
  checkList(): CheckProblem[]
  checkSet(patch: Partial<CheckSettings>): CheckState
  /** These findings (none given — all) forgotten. */
  checkClear(ids?: string[]): void
  /** Such findings no more (or again). */
  checkMute(key: string, on?: boolean): void
  /** The findings that went into a bug note. */
  checkNote(ids: string[], note: string): void
  checkShow(tabId: string, sel: string): Promise<boolean>
  checkShot(tabId: string): Promise<Uint8Array | undefined>
}
export const BROWSER_METHODS: Array<keyof BrowserApi> = ['pwRecStart', 'pwRecStop', 'pwRecState', 'hooksList', 'hookPut', 'hookRemove', 'hookHits', 'hookClearHits', 'hookSkip', 'hookPause', 'hookStatus', 'hookReapply', 'list', 'create', 'close', 'go', 'nav', 'zoom', 'trust', 'loginReply', 'shots', 'cover', 'bookmarks', 'setBookmarks', 'suggest', 'clearHistory', 'visits', 'visitsDelete', 'settings', 'setSettings', 'defaultUa', 'device', 'folderMenu', 'choose', 'recState', 'rec', 'recClear', 'recList', 'recFull', 'reveal', 'resetSite', 'passwords', 'pwAnswer', 'pwReveal', 'pwDelete', 'pwFill', 'importSources', 'importBookmarks', 'importPasswords', 'neverList', 'neverRemove', 'certInfo', 'ruler', 'swaggerFind', 'savePage', 'viewSource', 'apiMapHosts', 'apiMapList', 'apiMapAuth', 'apiMapClear', 'checkState', 'checkList', 'checkSet', 'checkClear', 'checkMute', 'checkNote', 'checkShow', 'checkShot']
