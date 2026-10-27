import type { WebContents } from 'electron'
import { asFirefox, FIREFOX_PAGE_SCRIPT, FIREFOX_UA } from '../../shared/browser/chromeIdentity'

/** How a page is told it is Chrome (Emulation.setUserAgentOverride's parameters). */
export type ChromeOverride = { userAgent: string; userAgentMetadata?: unknown }

/** The script taking Firefox's missing parts away, as put on each page (its id: put anew, never twice). */
const scripts = new WeakMap<WebContents, string>()

/**
 * A page told what browser it is, by where it goes (a main-frame navigation's start): a sign-in host met as Firefox —
 * Firefox's User-Agent, its scripts finding no navigator.userAgentData / window.chrome; anywhere else — Chrome
 * (`chrome`). Told before a page has a document, Chromium drops it — hence at each navigation's start.
 */
export async function tellIdentity(wc: WebContents, d: Electron.Debugger, url: string, chrome: () => ChromeOverride): Promise<void> {
  if (asFirefox(url)) {
    const was = scripts.get(wc)
    if (was) await d.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: was }).catch(() => undefined)
    const r = (await d.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: FIREFOX_PAGE_SCRIPT })) as { identifier: string }
    scripts.set(wc, r.identifier)
    await d.sendCommand('Emulation.setUserAgentOverride', { userAgent: FIREFOX_UA })
    return
  }
  await d.sendCommand('Emulation.setUserAgentOverride', chrome())
}
