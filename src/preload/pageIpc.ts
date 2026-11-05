import { ipcRenderer } from 'electron'
import { PAGE_CHANNELS, type PageAsks, type PageEvents, type PageSends } from '../shared/browser/pageChannels'

/** A browser page's preload ↔ main, by the names and payloads of shared/browser/pageChannels.ts. */

/** A message from main listened to. */
export function onMain<K extends keyof PageEvents>(name: K, fn: (...a: PageEvents[K]) => void): void {
  ipcRenderer.on(PAGE_CHANNELS[name], (_e, ...a: unknown[]) => fn(...(a as PageEvents[K])))
}
/** A message to main (no answer). */
export function sendMain<K extends keyof PageSends>(name: K, ...a: PageSends[K]): void {
  ipcRenderer.send(PAGE_CHANNELS[name], ...a)
}
/** A question to main. */
export function askMain<K extends keyof PageAsks>(name: K): Promise<PageAsks[K]> {
  return ipcRenderer.invoke(PAGE_CHANNELS[name]) as Promise<PageAsks[K]>
}
