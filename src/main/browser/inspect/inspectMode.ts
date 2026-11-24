import type { WebContents } from 'electron'
import { EMIT_MS, INSPECT_BINDING, INSPECT_WORLD, MONITOR_KEEP, MONITOR_MS } from '../../../shared/browser/inspect/constants'
import { inspectReport } from '../../../shared/browser/inspect/inspectReport'
import { inspectWatchScript } from '../../../shared/browser/inspect/pageScripts'
import { monitorSample, type Metrics } from '../../../shared/browser/inspect/perfMonitor'
import type { InspectNews, InspectReq, InspectView } from '../../../shared/browser/inspect/types'
import { toPage } from '../../ipc/browserPageIpc'
import type { BrowserHost, Tab } from '../tab'
import { inspectCdpHandlers } from './inspectCdp'
import { InspectMenu } from './inspectMenu'
import { PageAsk } from './pageAsk'
import { SitePassport } from './sitePassport'
import { liteReq, newTabInspect, type TabInspect } from './tabInspect'
import type { TechDetector } from './techDetector'

/** The page's network kept for the inspector (its bodies are not read — only the document's, for the passport). */
const NETWORK = { maxTotalBufferSize: 30 * 1024 * 1024, maxResourceBufferSize: 5 * 1024 * 1024 }
/** The facts made again at most this often while the vitals / errors come, ms. */
const REFRESH_MS = 1000
/** The protocol's domains the inspector holds on while on (Performance — the monitor's readings). */
const DOMAINS = ['Runtime', 'Page', 'Log', 'Performance'] as const

/**
 * The inspector on a tab: while on, its page is watched over the protocol (its requests, console, the person's acts,
 * the busy time, the vitals, the performance every second) into a log of groups; the page's preload frames the
 * element under the pointer with its card; the site's passport made when a page loads; the page's menu about an
 * element. All of it only while on, and only on that tab — the window is told of what changed a few times a second.
 */
export class InspectMode {
  private states = new Map<string, TabInspect>()
  private timer?: NodeJS.Timeout
  private monitorTimer?: NodeJS.Timeout
  private refreshTimers = new WeakMap<TabInspect, NodeJS.Timeout>()
  readonly ask = new PageAsk()
  readonly passport: SitePassport
  readonly menu: InspectMenu
  private readonly handlers: ReturnType<typeof inspectCdpHandlers>

  constructor(
    private host: BrowserHost,
    detector: TechDetector,
    openDevTools: (tab: Tab, x: number, y: number) => void,
    /** The frame over the element under the pointer is wanted (the panel's switch). */
    private frameOn: () => boolean,
  ) {
    this.passport = new SitePassport(host, detector, (st) => void (st.dirty = true))
    this.menu = new InspectMenu(host, this.ask, openDevTools)
    this.handlers = inspectCdpHandlers({ passport: this.passport, refreshSoon: (st) => this.refreshSoon(st) })
    host.cdp.listen('inspect', (tab, method, p) => {
      const st = this.states.get(tab.t.id)
      if (st?.on && Object.hasOwn(this.handlers, method)) this.handlers[method](tab, st, p)
    })
  }
  private state(id: string): TabInspect {
    let st = this.states.get(id)
    if (!st) this.states.set(id, (st = newTabInspect()))
    return st
  }
  isOn(id: string): boolean {
    return !!this.states.get(id)?.on
  }
  /** A page asks whether to frame the element under the pointer (its tab's inspector on and the frame wanted). */
  isOnFor(wc: WebContents): boolean {
    const t = this.host.byContents(wc)
    return !!t && this.isOn(t.t.id) && this.frameOn()
  }
  /** The frame's switch turned: every inspected page follows. */
  frameChanged(): void {
    for (const [id, st] of this.states) {
      const t = this.host.tabs.get(id)
      if (st.on && t && !t.asleep) toPage(t.view.webContents, 'inspect', this.frameOn())
    }
  }

  /** The inspector on / off on a tab. */
  set(id: string, on: boolean): void {
    const tab = this.host.tabs.get(id)
    if (!tab) return
    const st = this.state(id)
    if (st.on === on) return
    st.on = on
    tab.t.inspect = on
    this.host.changed()
    if (on) {
      this.host.wake(tab)
      st.reset = true
    }
    toPage(tab.view.webContents, 'inspect', on && this.frameOn())
    st.dirty = true
    void this.sync(tab, true)
    this.ticking()
  }
  /** The watching on a tab as its state says (a tab woken / its page made anew — `renew`: set up again). */
  async sync(tab: Tab, renew = false): Promise<void> {
    const st = this.states.get(tab.t.id)
    const want = !!st?.on && !tab.asleep
    const has = tab.dbg.has('inspect')
    if (!st || !want) {
      if (has && !tab.asleep) await this.takeOff(tab, st)
      else if (has) this.host.cdp.drop(tab, 'inspect')
      return
    }
    if (has && st.script && !renew) return
    const d = tab.view.webContents.debugger
    try {
      this.host.cdp.use(tab, 'inspect')
      st.blocked = undefined
    } catch {
      st.blocked = 'Инструменты разработчика этой вкладки заняли протокол — закройте их, чтобы журнал и паспорт работали (рамка и меню работают и так)'
      st.dirty = true
      return
    }
    try {
      await this.host.cdp.networkOn(tab, 'inspect', NETWORK)
      for (const domain of DOMAINS) await d.sendCommand(`${domain}.enable`)
      await d.sendCommand('Runtime.addBinding', { name: INSPECT_BINDING, executionContextName: INSPECT_WORLD })
      const source = inspectWatchScript()
      if (st.script) await d.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: st.script }).catch(() => undefined)
      st.script = ((await d.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source, worldName: INSPECT_WORLD })) as { identifier: string }).identifier
      // the page open now: the watcher in its own world there too
      const tree = (await d.sendCommand('Page.getFrameTree')) as { frameTree: { frame: { id: string; url: string } } }
      st.mainFrame = tree.frameTree.frame.id
      if (/^https?:|^file:/i.test(tree.frameTree.frame.url)) {
        const w = (await d.sendCommand('Page.createIsolatedWorld', { frameId: st.mainFrame, worldName: INSPECT_WORLD })) as { executionContextId: number }
        st.ownCtx.add(w.executionContextId)
        await d.sendCommand('Runtime.evaluate', { expression: source, contextId: w.executionContextId })
      }
      if (!tab.t.loading) this.passport.schedule(tab, st, 300)
    } catch {
      // the page is going — its next page sets it up (the script is registered for it)
    }
  }
  /** The watching taken off a tab (its script, its binding), the protocol let go. */
  private async takeOff(tab: Tab, st: TabInspect | undefined): Promise<void> {
    const d = tab.view.webContents.debugger
    try {
      if (st?.script) await d.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: st.script }).catch(() => undefined)
      await d.sendCommand('Runtime.removeBinding', { name: INSPECT_BINDING }).catch(() => undefined)
      for (const domain of ['Log', 'Performance']) await d.sendCommand(`${domain}.disable`).catch(() => undefined)
    } finally {
      if (st) {
        st.script = undefined
        st.metrics = undefined
        clearTimeout(st.passportTimer)
      }
      this.host.cdp.drop(tab, 'inspect')
    }
  }
  /** A tab closed. */
  forget(id: string): void {
    const st = this.states.get(id)
    if (st) clearTimeout(st.passportTimer)
    this.states.delete(id)
  }

  // ---------- the window told; the performance read ----------
  private ticking(): void {
    const any = [...this.states.values()].some((s) => s.on || s.dirty)
    if (any && !this.timer) {
      this.timer = setInterval(() => this.tick(), EMIT_MS)
      this.monitorTimer = setInterval(() => void this.sample(), MONITOR_MS)
    } else if (!any && this.timer) {
      clearInterval(this.timer)
      clearInterval(this.monitorTimer)
      this.timer = this.monitorTimer = undefined
    }
  }
  /** Each tab's log goes on (groups end when quiet); what changed goes to the window. */
  private tick(): void {
    const now = Date.now()
    for (const [tabId, st] of this.states) {
      if (st.on) st.log.tick(now)
      const groups = st.log.takeChanged()
      if (!groups.length && !st.dirty && !st.monitorNew.length && !st.anims.changed) continue
      const anims = st.anims.changed ? st.anims.list() : undefined
      st.anims.changed = false
      const news: InspectNews = { tabId, on: st.on, groups: groups.map((g) => ({ ...g, reqs: g.reqs.map(liteReq) })), monitor: st.monitorNew.splice(0), ...(anims ? { anims } : {}), ...(st.blocked ? { blocked: st.blocked } : {}), ...(st.reset ? { reset: true } : {}), ...(st.dirty && st.passport ? { passport: st.passport } : {}) }
      st.dirty = false
      st.reset = false
      this.host.emit('inspect', news)
    }
    this.ticking()
  }
  /** The performance of every watched page read once (as DevTools' «Performance monitor» does). */
  private async sample(): Promise<void> {
    for (const [id, st] of this.states) {
      const tab = this.host.tabs.get(id)
      if (!st.on || !tab || tab.asleep || !tab.dbg.has('inspect')) continue
      try {
        const r = (await tab.view.webContents.debugger.sendCommand('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }
        const cur: Metrics = Object.fromEntries(r.metrics.map((m) => [m.name, m.value]))
        const s = st.metrics && monitorSample(st.metrics, cur, Date.now())
        st.metrics = cur
        if (!s) continue
        st.monitor.push(s)
        if (st.monitor.length > MONITOR_KEEP) st.monitor.splice(0, st.monitor.length - MONITOR_KEEP)
        st.monitorNew.push(s)
      } catch {
        // (the page going)
      }
    }
  }
  private refreshSoon(st: TabInspect): void {
    if (this.refreshTimers.has(st)) return
    this.refreshTimers.set(
      st,
      setTimeout(() => {
        this.refreshTimers.delete(st)
        this.passport.refresh(st)
      }, REFRESH_MS),
    )
  }
  /** A tab's inspector as a whole (the window opening the panel). */
  view(id: string): InspectView | undefined {
    const st = this.states.get(id)
    if (!st) return undefined
    return { tabId: id, on: st.on, monitor: st.monitor, anims: st.anims.list(), ...(st.blocked ? { blocked: st.blocked } : {}), ...(st.passport ? { passport: st.passport } : {}), groups: st.log.groups().map((g) => ({ ...g, reqs: g.reqs.map(liteReq) })) }
  }
  /** The log starts anew. */
  clear(id: string): void {
    const st = this.states.get(id)
    if (!st) return
    st.log.reset()
    st.anims.reset()
    st.reset = true
    st.dirty = true
    this.ticking()
  }
  /** A request with its headers (opened in the log). */
  request(id: string, reqId: string): InspectReq | undefined {
    const st = this.states.get(id)
    return st?.reqs.get(reqId) ?? st?.log.groups().flatMap((g) => g.reqs).find((r) => r.id === reqId)
  }
  /** The passport made again now. */
  refreshPassport(id: string): void {
    const tab = this.host.tabs.get(id)
    const st = this.states.get(id)
    if (tab && st?.on) void this.passport.collect(tab, st)
  }
  report(id: string): string {
    const v = this.view(id)
    const tab = this.host.tabs.get(id)
    return v ? inspectReport(v, tab?.t.title || tab?.t.url || '') : 'Инспектор на этой вкладке не включён.'
  }
  /** An element of the log (its CSS path) shown on the page (`scroll` — brought into view; none — the mark taken off). */
  async show(id: string, selector: string | undefined, scroll: boolean): Promise<boolean> {
    const tab = this.host.tabs.get(id)
    if (!tab || tab.asleep) return false
    const wc = tab.view.webContents
    if (!selector) {
      await this.ask.ask(wc, { t: 'unmark' })
      return true
    }
    return !!(await this.ask.ask<boolean>(wc, { t: 'mark', selector, scroll }))
  }
  /** The page's menu about the element right-clicked. */
  menuFor(tab: Tab, p: Electron.ContextMenuParams): Promise<Electron.MenuItemConstructorOptions[]> {
    return this.menu.items(tab, p, this.isOn(tab.t.id))
  }
}
