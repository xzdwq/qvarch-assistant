import type { CdpOwner, Tab } from './tab'

/** A protocol message of a tab's page, for the part that keeps the protocol on it. */
export type CdpListener = (tab: Tab, method: string, params: Record<string, any>) => void

/**
 * The protocol (Chrome DevTools) on the tabs' pages: shared by the recording, the device mode, the hooks' search,
 * «Проверка» and a scenario's recording — attached while any of them needs it. Each message goes to the parts that
 * hold it on that tab (in the order they signed up). Detached from outside (the page gone): they all stop.
 */
export class TabCdp {
  private listeners: Array<{ owner: CdpOwner; fn: CdpListener }> = []

  constructor(private onDetach: (tab: Tab) => void) {}

  /** A part listens to the pages it holds the protocol on. */
  listen(owner: CdpOwner, fn: CdpListener): void {
    this.listeners.push({ owner, fn })
  }
  /** The protocol on a tab's page for `who` (attached now if no one had it). Throws when the page's DevTools hold it. */
  use(tab: Tab, who: CdpOwner): Electron.Debugger {
    const d = tab.view.webContents.debugger
    if (!d.isAttached()) {
      d.attach('1.3')
      d.removeAllListeners('message')
      d.removeAllListeners('detach')
      d.on('message', (_e, method, params) => {
        for (const l of this.listeners) if (tab.dbg.has(l.owner)) l.fn(tab, method, params as Record<string, any>)
      })
      d.on('detach', () => this.onDetach(tab))
    }
    tab.dbg.add(who)
    return d
  }
  /** `who` needs the protocol no more; the last one gone — detached. */
  drop(tab: Tab, who: CdpOwner): void {
    tab.dbg.delete(who)
    if (tab.dbg.size) return
    const d = tab.view.webContents.debugger
    try {
      d.removeAllListeners('message')
      d.removeAllListeners('detach')
      if (d.isAttached()) d.detach()
    } catch {
      // gone
    }
  }
}
