import type { CdpOwner, Tab } from './tab'

/**
 * A protocol message of a tab's page, for the part that keeps the protocol on it (`sessionId` — an iframe's / a
 * worker's session, given only to a part that asked for them).
 */
export type CdpListener = (tab: Tab, method: string, params: Record<string, any>, sessionId?: string) => void

/**
 * The protocol (Chrome DevTools) on the tabs' pages: shared by the recording, the device mode, the hooks' search,
 * «Проверка», a scenario's recording and a scenario's run — attached while any of them needs it. Each message goes
 * to the parts that hold it on that tab (in the order they signed up). Detached from outside (the page gone): they
 * all stop.
 */
export class TabCdp {
  private listeners: Array<{ owner: CdpOwner; fn: CdpListener; sessions: boolean }> = []
  /** The parts that need the page's network events on each tab (the domain is shared: off only when none does). */
  private network = new WeakMap<Tab, Set<CdpOwner>>()

  constructor(private onDetach: (tab: Tab) => void) {}

  /**
   * A part listens to the pages it holds the protocol on — to the page's own messages; `sessions` — also to those of
   * the page's iframes and workers (the ones a part attached). The listener taken off by what it returns.
   */
  listen(owner: CdpOwner, fn: CdpListener, sessions = false): () => void {
    const l = { owner, fn, sessions }
    this.listeners.push(l)
    return () => void (this.listeners = this.listeners.filter((x) => x !== l))
  }
  /** The protocol on a tab's page for `who` (attached now if no one had it). Throws when the page's DevTools hold it. */
  use(tab: Tab, who: CdpOwner): Electron.Debugger {
    const d = tab.view.webContents.debugger
    if (!d.isAttached()) {
      d.attach('1.3')
      d.removeAllListeners('message')
      d.removeAllListeners('detach')
      d.on('message', (_e, method, params, sessionId) => {
        for (const l of this.listeners) if (tab.dbg.has(l.owner) && (l.sessions || !sessionId)) l.fn(tab, method, params as Record<string, any>, sessionId || undefined)
      })
      d.on('detach', () => this.onDetach(tab))
    }
    tab.dbg.add(who)
    return d
  }
  /**
   * The page's network events on for `who` (the protocol taken for it first). Each part asks with its own buffer
   * sizes; the domain stays on while any part holds it.
   */
  networkOn(tab: Tab, who: CdpOwner, params: Record<string, unknown> = {}): Promise<unknown> {
    const d = this.use(tab, who)
    const holders = this.network.get(tab) ?? new Set()
    this.network.set(tab, holders.add(who))
    return d.sendCommand('Network.enable', params)
  }
  /** `who` lets the network go: off when no part holds it — and no scenario runs there (Playwright enabled it itself). */
  private networkOff(tab: Tab, who: CdpOwner): void {
    const holders = this.network.get(tab)
    if (!holders?.delete(who) || holders.size || tab.dbg.has('run') || tab.view.webContents.isDestroyed()) return
    void tab.view.webContents.debugger.sendCommand('Network.disable').catch(() => undefined)
  }
  /** `who` needs the protocol no more (its network events too); the last one gone — detached. */
  drop(tab: Tab, who: CdpOwner): void {
    this.networkOff(tab, who)
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
