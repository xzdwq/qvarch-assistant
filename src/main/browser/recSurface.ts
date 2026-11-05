import type { WebContents } from 'electron'
import type { BrowserHost } from './tab'

/**
 * Where a scenario is recorded: a tab of the Браузер section, or a browser in a note (a webview) — its page now,
 * its protocol (the upload's request is looked for in its traffic), what the recording set taken back at its end.
 */
export interface RecSurface {
  /** The section's tab recorded in (none — a note's browser). */
  tabId?: string
  /** A note's browser: its name (the block's bar says where the recording goes on). */
  name?: string
  /** The page now (a tab asleep — none). */
  contents(): WebContents | undefined
  /** The page's own protocol messages from now on (the network told) — till the end. */
  watchNet(fn: (method: string, params: Record<string, any>) => void): void
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  end(): void
}

/** A tab of the Браузер section: its protocol held as the recording's (shared with the tab's other parts). */
export function tabSurface(host: BrowserHost, tabId: string): RecSurface {
  const tab = () => {
    const t = host.tabs.get(tabId)
    return t && !t.asleep ? t : undefined
  }
  let off: (() => void) | undefined
  return {
    tabId,
    contents: () => tab()?.view.webContents,
    watchNet(fn) {
      const t = tab()
      if (!t) return
      try {
        void host.cdp.networkOn(t, 'pw', { maxPostDataSize: 4 * 1024 * 1024 }).catch(() => undefined)
        off = host.cdp.listen('pw', (x, method, p) => x.t.id === tabId && fn(method, p))
      } catch {
        // the page's DevTools hold the protocol: no binding, the run finds the request by the file's content
      }
    },
    send: (method, params) => {
      const t = tab()
      return t ? t.view.webContents.debugger.sendCommand(method, params) : Promise.reject(new Error('Вкладка спит'))
    },
    end() {
      off?.()
      const t = tab()
      if (t) host.cdp.drop(t, 'pw')
    },
  }
}

/** A browser in a note: its protocol is kept on it all its life (the page told it is Chrome) — only listened to. */
export function guestSurface(guest: WebContents, name: string): RecSurface {
  let off: (() => void) | undefined
  const alive = () => (guest.isDestroyed() ? undefined : guest)
  return {
    name,
    contents: alive,
    watchNet(fn) {
      try {
        const dbg = guest.debugger
        if (!dbg.isAttached()) dbg.attach('1.3')
        void dbg.sendCommand('Network.enable', { maxPostDataSize: 4 * 1024 * 1024 }).catch(() => undefined)
        const h = (_e: Electron.Event, method: string, params: Record<string, any>, sessionId: string) => !sessionId && fn(method, params)
        dbg.on('message', h)
        off = () => void dbg.off('message', h)
      } catch {
        // its DevTools hold the protocol: no binding
      }
    },
    send: (method, params) => (alive() ? guest.debugger.sendCommand(method, params) : Promise.reject(new Error('Браузер закрыт'))),
    end: () => off?.(),
  }
}
