import type { ApiEndpoint } from '../apiMap'
import type { CheckProblem, CheckSettings, CheckState } from '../check'
import type { BrowserHook, HookHit, HookStatus } from '../hooks'
import type { DeviceMode } from './devices'
import type { PwRecState, RecFull, RecItem, RecState } from './recording'
import type { Bookmark, BrowserSettings, BrowserTab, CertInfo, PasswordInfo, Visit } from './tabs'

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
  nav(id: string, action: 'back' | 'fwd' | 'reload' | 'hard' | 'stop' | 'devtools'): void
  zoom(id: string, percent: number): void
  trust(id: string, host: string): void
  loginReply(reqId: string, user?: string, pass?: string): void
  cover(on: boolean): Promise<Record<string, string>>
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
  pwAnswer(askId: string, answer: 'save' | 'no' | 'never'): void
  pwReveal(id: string): string
  pwDelete(id: string): void
  pwFill(tabId: string, id: string): void
  neverList(): string[]
  neverRemove(origin: string): void
  certInfo(id: string): CertInfo | undefined
  ruler(id: string, on: boolean): void
  savePage(id: string): Promise<void>
  viewSource(id: string): void
  swaggerFind(id: string): Promise<{ url: string; text: string } | { error: string; tried: string[] }>
  /** «Проверка»: on / off and its settings, the tabs it could not watch. */
  apiMapHosts(): Array<{ host: string; endpoints: number; calls: number; last: number }>
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
export const BROWSER_METHODS: Array<keyof BrowserApi> = ['pwRecStart', 'pwRecStop', 'pwRecState', 'hooksList', 'hookPut', 'hookRemove', 'hookHits', 'hookClearHits', 'hookSkip', 'hookPause', 'hookStatus', 'hookReapply', 'list', 'create', 'close', 'go', 'nav', 'zoom', 'trust', 'loginReply', 'cover', 'bookmarks', 'setBookmarks', 'suggest', 'clearHistory', 'visits', 'visitsDelete', 'settings', 'setSettings', 'defaultUa', 'device', 'folderMenu', 'choose', 'recState', 'rec', 'recClear', 'recList', 'recFull', 'reveal', 'resetSite', 'passwords', 'pwAnswer', 'pwReveal', 'pwDelete', 'pwFill', 'neverList', 'neverRemove', 'certInfo', 'ruler', 'swaggerFind', 'savePage', 'viewSource', 'apiMapHosts', 'apiMapList', 'apiMapAuth', 'apiMapClear', 'checkState', 'checkList', 'checkSet', 'checkClear', 'checkMute', 'checkNote', 'checkShow', 'checkShot']
