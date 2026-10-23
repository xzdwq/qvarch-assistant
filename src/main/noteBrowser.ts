import { app, clipboard, Menu, shell, webContents, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { NetItem, NetPage } from '../shared/noteBrowser'

/**
 * The browser component of the notes: a <webview> in the note (it scrolls with the text), on the Браузер
 * section's profile (its cookies, sign-ins, certificates). Every webview is held to that: no preload, no Node,
 * sandboxed, http(s) only. A page's new window becomes a tab of its component; the requests of a tab are
 * listened to over the DevTools protocol while its «Запросы» panel is open.
 */
export const NOTE_PARTITION = 'persist:qa-browser'
const MAX_ITEMS = 1000

interface Listen {
  host: WebContents
  items: Map<string, NetItem>
  order: string[]
  page: NetPage
  preserve: boolean
  timer?: NodeJS.Timeout
  dirty: boolean
  touch: () => void
}
const listening = new Map<number, Listen>()

export function setupNoteBrowser(emit: (host: WebContents, type: string, payload: unknown) => void): void {
  const guard = (wc: WebContents) => {
    wc.on('will-attach-webview', (ev, prefs, params) => {
      delete prefs.preload
      prefs.nodeIntegration = false
      prefs.nodeIntegrationInSubFrames = false
      prefs.contextIsolation = true
      prefs.sandbox = true
      prefs.webSecurity = true
      if (params.partition !== NOTE_PARTITION || !/^(https?:|about:blank)/i.test(params.src || 'about:blank')) ev.preventDefault()
    })
    wc.on('did-attach-webview', (_ev, guest) => wireGuest(wc, guest, emit))
  }
  // the windows there already and every one made later
  for (const wc of webContents.getAllWebContents()) if (wc.getType() === 'window') guard(wc)
  app.on('web-contents-created', (_e, wc) => guard(wc))
}

function wireGuest(host: WebContents, guest: WebContents, emit: (host: WebContents, type: string, payload: unknown) => void): void {
  // a new window → a new tab of the same component
  guest.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) emit(host, 'open', { id: guest.id, url })
    return { action: 'deny' }
  })
  guest.on('will-navigate', (e, url) => {
    if (!/^(https?:|about:)/i.test(url)) e.preventDefault()
  })
  guest.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = []
    if (p.linkURL) {
      items.push({ label: 'Открыть в новой вкладке', click: () => emit(host, 'open', { id: guest.id, url: p.linkURL }) }, { label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' })
    }
    if (p.isEditable) items.push({ label: 'Вырезать', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Копировать', role: 'copy', enabled: p.editFlags.canCopy }, { label: 'Вставить', role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' })
    else if (p.selectionText) items.push({ label: 'Копировать', role: 'copy' }, { type: 'separator' })
    items.push(
      { label: 'Назад', enabled: guest.navigationHistory.canGoBack(), click: () => guest.navigationHistory.goBack() },
      { label: 'Вперёд', enabled: guest.navigationHistory.canGoForward(), click: () => guest.navigationHistory.goForward() },
      { label: 'Обновить', click: () => guest.reload() },
      { type: 'separator' },
      { label: 'Копировать адрес страницы', click: () => clipboard.writeText(guest.getURL()) },
      { label: 'Открыть в системном браузере', click: () => void shell.openExternal(guest.getURL()) },
      { type: 'separator' },
      { label: 'Посмотреть код', click: () => guest.inspectElement(p.x, p.y) },
    )
    Menu.buildFromTemplate(items).popup()
  })
  guest.once('destroyed', () => stopNet(guest.id))
}

/** A webview of this window (not anything else). */
function guestOf(host: WebContents, id: number): WebContents {
  const g = webContents.fromId(Number(id))
  if (!g || g.isDestroyed() || g.getType() !== 'webview' || g.hostWebContents !== host) throw new Error('Нет такой вкладки')
  return g
}

/** The requests of a tab: listened to (the list sent to its window as it changes), or no more. */
export function netListen(host: WebContents, id: number, on: boolean, preserve: boolean, emit: (host: WebContents, type: string, payload: unknown) => void): void {
  const g = guestOf(host, id)
  if (!on) return stopNet(g.id)
  const had = listening.get(g.id)
  if (had) return void (had.preserve = preserve)
  const L: Listen = { host, items: new Map(), order: [], page: {}, preserve, dirty: true, touch: () => undefined }
  listening.set(g.id, L)
  const flush = () => {
    L.timer = undefined
    if (!L.dirty || host.isDestroyed()) return
    L.dirty = false
    emit(host, 'net', { id: g.id, page: L.page, items: L.order.map((k) => L.items.get(k)!).filter(Boolean) })
  }
  const touch = () => {
    L.dirty = true
    if (!L.timer) L.timer = setTimeout(flush, 300)
  }
  L.touch = touch
  try {
    g.debugger.attach('1.3')
  } catch (e) {
    listening.delete(g.id)
    throw new Error(`Не удалось подключиться к странице: ${e instanceof Error ? e.message : String(e)}`)
  }
  let mainFrame: string | undefined
  /** Finds the request and ends it (when it is in the list): its time, `done`; the block told. */
  const ended = (p: Record<string, any>, fill: (it: NetItem) => void) => {
    const it = L.items.get(p.requestId)
    if (!it) return
    fill(it)
    it.ms = Math.round((p.timestamp - it.t0) * 1000)
    it.done = true
    touch()
  }
  /** The protocol's events the network list follows: the method → its change to the list (the block told). */
  const onEvent: Record<string, (p: Record<string, any>) => void> = {
    'Page.frameNavigated': (p) => {
      if (p.frame?.parentId) return
      mainFrame = p.frame.id
      L.page.url = p.frame.url
      touch()
    },
    'Network.requestWillBeSent': (p) => {
      // the main frame's new page (its document's request): the list starts over (unless kept)
      if (p.type === 'Document' && p.requestId === p.loaderId && (!mainFrame || p.frameId === mainFrame) && !p.redirectResponse) {
        if (!L.preserve) {
          L.items.clear()
          L.order = []
        }
        L.page = { url: p.request.url }
      }
      const was = L.items.get(p.requestId)
      // a redirect: the earlier hop ends here
      if (was && p.redirectResponse) {
        was.status = p.redirectResponse.status
        was.ms = Math.round((p.timestamp - was.t0) * 1000)
        was.done = true
        L.items.set(`${p.requestId}~${was.t0}`, was)
        L.order[L.order.indexOf(p.requestId)] = `${p.requestId}~${was.t0}`
      }
      if (L.order.length >= MAX_ITEMS) L.items.delete(L.order.shift()!)
      L.items.set(p.requestId, { id: p.requestId, method: p.request.method, url: p.request.url, type: p.type ?? 'Other', t0: p.timestamp, wall: Math.round(p.wallTime * 1000), done: false })
      L.order.push(p.requestId)
      touch()
    },
    'Network.responseReceived': (p) => {
      const it = L.items.get(p.requestId)
      if (!it) return
      it.status = p.response.status
      it.mime = p.response.mimeType
      it.fromCache = !!(p.response.fromDiskCache || p.response.fromServiceWorker || p.response.fromPrefetchCache)
      const t = p.response.timing
      if (t) it.ttfb = Math.round(t.receiveHeadersEnd - t.sendEnd)
      touch()
    },
    'Network.loadingFinished': (p) => ended(p, (it) => (it.size = p.encodedDataLength)),
    'Network.loadingFailed': (p) => ended(p, (it) => (it.error = p.canceled ? 'отменён' : p.blockedReason ? `заблокирован (${p.blockedReason})` : p.errorText)),
    'Page.domContentEventFired': (p) => {
      L.page.dcl = p.timestamp
      touch()
    },
    'Page.loadEventFired': (p) => {
      L.page.load = p.timestamp
      touch()
    },
  }
  g.debugger.on('message', (_e, method: string, p: Record<string, any>) => {
    if (Object.hasOwn(onEvent, method)) onEvent[method](p)
  })
  g.debugger.on('detach', () => {
    clearTimeout(L.timer)
    listening.delete(g.id)
  })
  void g.debugger.sendCommand('Network.enable').catch(() => undefined)
  void g.debugger
    .sendCommand('Page.enable')
    .then(() => g.debugger.sendCommand('Page.getFrameTree'))
    .then((r: { frameTree?: { frame?: { id?: string } } }) => (mainFrame = r.frameTree?.frame?.id ?? mainFrame))
    .catch(() => undefined)
  L.page = { url: g.getURL() }
  touch()
}
function stopNet(id: number): void {
  const L = listening.get(id)
  if (!L) return
  clearTimeout(L.timer)
  listening.delete(id)
  const g = webContents.fromId(id)
  try {
    if (g && !g.isDestroyed() && g.debugger.isAttached()) g.debugger.detach()
  } catch {
    // gone
  }
}
/** The list of a tab cleared (the next requests start it again). */
export function netClear(host: WebContents, id: number): void {
  const g = guestOf(host, id)
  const L = listening.get(g.id)
  if (!L) return
  L.items.clear()
  L.order = []
  L.touch()
}
