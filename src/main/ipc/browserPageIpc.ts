import { ipcMain, type WebContents } from 'electron'
import { PAGE_CHANNELS, type PageAsks, type PageEvents, type PageSends } from '../../shared/browser/pageChannels'
import type { Browser } from '../browser'

/**
 * The browser's pages ↔ main (their preload, not the app's window): the channels of shared/browser/pageChannels.ts,
 * registered here once, each answered by its part. What a page says arrives unchecked — the part checks it.
 */

/** The page's word as it came: every argument checked before use. */
type Unchecked<T extends unknown[]> = { [I in keyof T]: unknown }

/** A message to a page (a page gone — nothing is sent). */
export function toPage<K extends keyof PageEvents>(wc: WebContents | undefined, name: K, ...a: PageEvents[K]): void {
  if (wc && !wc.isDestroyed()) wc.send(PAGE_CHANNELS[name], ...a)
}
/** A page's message listened to (`from` — the page that sent it). */
function onPage<K extends keyof PageSends>(name: K, fn: (from: WebContents, ...a: Unchecked<PageSends[K]>) => void): void {
  ipcMain.on(PAGE_CHANNELS[name], (e, ...a: unknown[]) => fn(e.sender, ...(a as Unchecked<PageSends[K]>)))
}
/** A page's question answered (it asks with no arguments: who asks is the answer's key). */
function answerPage<K extends keyof PageAsks>(name: K, fn: (from: WebContents) => PageAsks[K]): void {
  ipcMain.handle(PAGE_CHANNELS[name], (e) => fn(e.sender))
}

/** The pages' channels answered by the browser's parts: the scenario's recorder, the passwords, the rulers, a look. */
export function registerBrowserPageIpc(browser: Browser): void {
  answerPage('recGet', (wc) => browser.scenario.pageState(wc))
  onPage('recAct', (wc, act) => browser.scenario.onPageAct(wc, act))
  onPage('recFlushed', (wc, ackId) => browser.scenario.onFlushed(wc, ackId))
  answerPage('pwGet', (wc) => browser.passwordVault.loginFor(wc))
  onPage('pwSubmit', (wc, login) => browser.passwordVault.onSubmit(wc, login))
  answerPage('rulerGet', (wc) => browser.rulers.of(wc))
  onPage('rulerSet', (wc, ruler) => browser.rulers.onPageSet(wc, ruler))
  onPage('lookReply', (wc, id, look) => browser.lookReply(wc, id, look))
}
