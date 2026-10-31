import { CdpUndoLog } from './cdpUndo'

/**
 * Playwright on a page of the app's own browser (a tab of the Браузер section, a browser in a note): Playwright
 * speaks to a whole browser (connectOverCDP), the app has one page's protocol to give. This is that browser — with
 * one page: the browser's own commands answered here (its version, the page attached, the cookies through the
 * page), the page's ones passed to it, its iframes' and workers' sessions as they are. What the browser cannot do
 * for a borrowed page (a new tab, a new context, all the cookies cleared — the person's sign-ins) is refused with
 * the reason. When the run ends, what it set on the page is undone (CdpUndoLog).
 */

/** The page's protocol as the bridge uses it (Electron's webContents.debugger — or a test's fake). */
export interface BridgePage {
  /** A command to the page itself (no session) or to one of its iframes' / workers' sessions. */
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>
}
/** The page the browser shows. */
export interface BridgeTarget {
  targetId: string
  url: string
  title: string
  /** The browser's product (Chrome/<version>) and its User-Agent. */
  product: string
  userAgent: string
}
/** A message from Playwright. */
export interface ClientMessage {
  id: number
  method: string
  params?: Record<string, unknown>
  sessionId?: string
}
type Params = Record<string, any>

/** The session Playwright knows the page by. */
export const PAGE_SESSION = 'qvarch-page'
/** A session on the browser itself (Playwright takes one to open newCDPSession through it). */
const BROWSER_SESSION = 'qvarch-browser'
/** The browser context the page is in (Playwright asks for one; there is only the default). */
const CONTEXT_ID = 'qvarch-context'
/** A refusal: the browser cannot do it for a borrowed page — said in the person's words. */
export class BridgeRefusal extends Error {}

/** The browser's own commands: what each answers (a refusal — thrown). */
const BROWSER_COMMANDS: Record<string, (b: CdpBridge, p: Params) => Promise<unknown> | unknown> = {
  'Browser.getVersion': (b) => ({ protocolVersion: '1.3', product: b.target.product, revision: '', userAgent: b.target.userAgent, jsVersion: '' }),
  'Browser.close': () => ({}),
  'Browser.setDownloadBehavior': () => ({}),
  'Browser.resetPermissions': () => ({}),
  'Browser.grantPermissions': () => {
    throw new BridgeRefusal('Разрешения (геолокация, буфер обмена…) в браузере Qvarch сценарий не выдаёт — выберите Edge или Chrome')
  },
  'Browser.getWindowForTarget': () => ({ windowId: 1, bounds: { windowState: 'normal' } }),
  'Target.setDiscoverTargets': () => ({}),
  'Target.setAutoAttach': (b) => b.attachPage(),
  'Target.getTargetInfo': (b, p) => ({ targetInfo: p.targetId === b.target.targetId ? b.pageInfo() : { targetId: 'qvarch-browser', type: 'browser', title: '', url: '', attached: true, canAccessOpener: false } }),
  'Target.getTargets': (b) => ({ targetInfos: [b.pageInfo()] }),
  'Target.attachToBrowserTarget': () => ({ sessionId: BROWSER_SESSION }),
  'Target.attachToTarget': (b, p) => b.extraSession(String(p.targetId ?? '')),
  'Target.detachFromTarget': (b, p) => b.dropSession(String(p.sessionId ?? '')),
  'Target.activateTarget': () => ({}),
  'Target.createTarget': () => {
    throw new BridgeRefusal('В браузере Qvarch сценарий идёт в одной вкладке: новую он не открывает — используйте page.goto(…)')
  },
  'Target.createBrowserContext': () => {
    throw new BridgeRefusal('В браузере Qvarch один профиль (вход из раздела «Браузер»): browser.newContext() недоступен — выберите Edge или Chrome')
  },
  'Target.closeTarget': () => {
    throw new BridgeRefusal('Вкладку браузера Qvarch сценарий не закрывает: page.close() недоступен')
  },
  // the cookies — the page's profile's (the Браузер's sign-ins): read and set through the page
  'Storage.getCookies': (b) => b.page.send('Network.getAllCookies'),
  'Storage.setCookies': (b, p) => b.page.send('Network.setCookies', { cookies: p.cookies ?? [] }),
  'Storage.clearCookies': () => {
    throw new BridgeRefusal('context.clearCookies() в браузере Qvarch стёр бы вход на всех сайтах раздела «Браузер» — удаляйте нужные cookie по одной или выберите Edge / Chrome')
  },
}
/** The page's commands answered here: the browser window it is in (a tab of the app has none of Chrome's). */
const PAGE_COMMANDS: Record<string, (b: CdpBridge, p: Params) => unknown> = {
  'Browser.getWindowForTarget': () => ({ windowId: 1, bounds: { windowState: 'normal' } }),
  'Browser.getWindowBounds': () => ({ bounds: { windowState: 'normal' } }),
  'Browser.setWindowBounds': () => ({}),
  'Target.closeTarget': BROWSER_COMMANDS['Target.closeTarget'],
}

/**
 * The domains that, enabled, tell what is there already (the page's execution contexts, its log, its style sheets,
 * its scripts) — and only when they were off.
 */
const TOLD_ON_ENABLE: ReadonlySet<string> = new Set(['Runtime.enable', 'Log.enable', 'CSS.enable', 'Debugger.enable'])

export class CdpBridge {
  private attached = false
  /** The sessions on the page itself: its own and the ones Playwright asked for apart (newCDPSession). */
  private aliases = new Set<string>([PAGE_SESSION])
  private aliasSeq = 0
  /** The sessions of the page's iframes and workers (attached by the page's own Target.setAutoAttach). */
  private children = new Set<string>()
  private undo = new CdpUndoLog()
  private gone = false

  constructor(
    readonly page: BridgePage,
    readonly target: BridgeTarget,
    /** A message to Playwright (a reply or an event). */
    private out: (msg: Record<string, unknown>) => void,
  ) {}

  pageInfo(): Record<string, unknown> {
    return { targetId: this.target.targetId, type: 'page', title: this.target.title, url: this.target.url, attached: this.attached, canAccessOpener: false, browserContextId: CONTEXT_ID }
  }
  /** Playwright asks to be told of the pages: the one page, attached (told before the answer — as Chrome does). */
  attachPage(): Record<string, never> {
    if (this.attached) return {}
    this.attached = true
    this.out({ method: 'Target.attachedToTarget', params: { sessionId: PAGE_SESSION, targetInfo: this.pageInfo(), waitingForDebugger: false } })
    return {}
  }
  /** One more session on the page (Playwright's newCDPSession): the same page, by another name. */
  extraSession(targetId: string): { sessionId: string } {
    if (targetId !== this.target.targetId) throw new BridgeRefusal('В браузере Qvarch сценарию доступна только его вкладка')
    const sessionId = `qvarch-extra-${++this.aliasSeq}`
    this.aliases.add(sessionId)
    return { sessionId }
  }
  dropSession(sessionId: string): Record<string, never> {
    if (sessionId !== PAGE_SESSION) this.aliases.delete(sessionId)
    return {}
  }

  /** A message from Playwright: answered (the browser's own), or passed to the page / the session it names. */
  async handle(msg: ClientMessage): Promise<void> {
    const reply = (body: Record<string, unknown>) => this.out({ id: msg.id, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}), ...body })
    try {
      reply({ result: (await this.run(msg)) ?? {} })
    } catch (e) {
      reply({ error: { code: e instanceof BridgeRefusal ? -32601 : -32000, message: e instanceof Error ? e.message : String(e) } })
    }
  }
  private async run(msg: ClientMessage): Promise<unknown> {
    const p = msg.params ?? {}
    if (this.gone) throw new Error('Вкладка закрыта')
    if (!msg.sessionId || msg.sessionId === BROWSER_SESSION) {
      if (!Object.hasOwn(BROWSER_COMMANDS, msg.method)) throw new BridgeRefusal(`«${msg.method}» в браузере Qvarch недоступен`)
      return BROWSER_COMMANDS[msg.method](this, p)
    }
    if (this.aliases.has(msg.sessionId)) {
      if (Object.hasOwn(PAGE_COMMANDS, msg.method)) return PAGE_COMMANDS[msg.method](this, p)
      // a domain enabled already (the page's protocol is shared: a run before, the app's parts) tells nothing on
      // enabling again — turned off first, it tells what is there (the run waits for it: the page's contexts…)
      if (TOLD_ON_ENABLE.has(msg.method)) await this.page.send(msg.method.replace(/\.enable$/, '.disable'), {}).catch(() => undefined)
      const result = (await this.page.send(msg.method, p)) as Params | undefined
      this.undo.note(msg.method, p, result)
      return result
    }
    // an iframe's / a worker's session (what it sets dies with it — it is detached at the end)
    return this.page.send(msg.method, p, msg.sessionId)
  }

  /** A message of the page's protocol: on to Playwright, under the session it knows it by. */
  event(method: string, params: Params, sessionId?: string): void {
    if (this.gone) return
    if (!sessionId) {
      // the page's iframes and workers as they come and go (their sessions are the page's own)
      if (method === 'Target.attachedToTarget' && params.sessionId) this.children.add(String(params.sessionId))
      if (method === 'Target.detachedFromTarget' && params.sessionId) this.children.delete(String(params.sessionId))
      for (const s of this.aliases) this.out({ method, params, sessionId: s })
      return
    }
    this.out({ method, params, sessionId })
  }
  /** The page is gone (its tab closed, its note closed): Playwright told, the rest refused. */
  pageGone(): void {
    if (this.gone) return
    if (this.attached) this.out({ method: 'Target.detachedFromTarget', params: { sessionId: PAGE_SESSION, targetId: this.target.targetId } })
    this.gone = true
  }
  /** The run is over: the page's iframes and workers let go, what the run set on the page undone. */
  async restore(): Promise<void> {
    const children = [...this.children]
    this.children.clear()
    this.gone = true
    for (const s of children) await this.page.send('Target.detachFromTarget', { sessionId: s }).catch(() => undefined)
    for (const c of this.undo.drain()) await this.page.send(c.method, c.params).catch(() => undefined)
  }
}
