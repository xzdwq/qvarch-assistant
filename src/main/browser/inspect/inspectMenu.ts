import { clipboard, ClipboardItem, type MenuItemConstructorOptions } from 'electron'
import { COPY_GROUP_STARTS, COPY_KINDS, COPY_WORDS, type CopyKind } from '../../../shared/browser/inspect/constants'
import { HIDE_WAYS, HIDE_WORDS, type TargetInfo } from '../../../shared/browser/inspect/pageCommands'
import type { BrowserHost, Tab } from '../tab'
import { copyElement, type CdpCopyKind } from './inspectCopy'
import type { PageAsk } from './pageAsk'

/** How the element is found again over the protocol: the element at a point, then parents up. */
type Reach = { point: { x: number; y: number }; up: number }
/** A copy's context: the tab, the target as the page told it, how to reach it. */
interface CopyCtx {
  tab: Tab
  target: TargetInfo | null
  reach: Reach
}
/** A copy: a text, or a picture (PNG). */
type Copied = string | Buffer
/** Walks a node up `n` parents (through shadow roots) — callFunctionOn. */
const UP = 'function (n) { let e = this; for (let i = 0; i < n && e; i++) e = e.parentElement || (e.getRootNode && e.getRootNode().host) || null; return e }'

/**
 * The page's menu about an element: the element in words, its copies (HTML, text, CSS, computed, the whole component,
 * selector, XPath, JS path, Playwright locator, its picture), hiding it (three ways) and bringing the hidden back,
 * editing its text, its parent pinned, DevTools at it. With the inspector off — its copies and hiding in a submenu.
 */
export class InspectMenu {
  constructor(
    private host: BrowserHost,
    private ask: PageAsk,
    private openDevTools: (tab: Tab, x: number, y: number) => void,
  ) {}

  async items(tab: Tab, p: Electron.ContextMenuParams, inspecting: boolean): Promise<MenuItemConstructorOptions[]> {
    const wc = tab.view.webContents
    const target = await this.ask.ask<TargetInfo>(wc, { t: 'target' })
    const z = wc.getZoomFactor() || 1
    const reach: Reach = target ? { point: target.point, up: target.up } : { point: { x: p.x / z, y: p.y / z }, up: 0 }
    const ctx: CopyCtx = { tab, target, reach }
    const copies: MenuItemConstructorOptions[] = COPY_KINDS.flatMap((k) => [...(COPY_GROUP_STARTS.includes(k) ? [{ type: 'separator' as const }] : []), { label: COPY_WORDS[k], click: () => void this.copy(ctx, k) }])
    const cmd = (c: Parameters<PageAsk['ask']>[1]) => () => void this.ask.ask(wc, c)
    const hide: MenuItemConstructorOptions[] = [
      ...HIDE_WAYS.map((how) => ({ label: HIDE_WORDS[how], enabled: !!target, click: cmd({ t: 'hide', how }) })),
      { label: `Вернуть скрытые${target?.hidden ? ` (${target.hidden})` : ''}`, enabled: !!target?.hidden, click: cmd({ t: 'restore' }) },
    ]
    if (!inspecting) return [{ label: 'Инспектор', submenu: [{ label: 'Скопировать', submenu: copies }, { type: 'separator' }, ...hide] }, { type: 'separator' }]
    return [
      { label: target ? `${target.label}  ·  ${target.width} × ${target.height}` : 'Элемент', enabled: false },
      { label: 'Скопировать', submenu: copies },
      { type: 'separator' },
      ...hide,
      { label: 'Редактировать текст на странице', type: 'checkbox', checked: !!target?.editing, enabled: !!target, click: cmd({ t: 'edit' }) },
      { type: 'separator' },
      { label: 'Выделить родителя', accelerator: 'Alt+Up', enabled: !!target, click: cmd({ t: 'pin', to: 'parent' }) },
      target?.pinned ? { label: 'Снять закрепление', accelerator: 'Esc', click: cmd({ t: 'pin', to: 'none' }) } : { label: 'Закрепить элемент', enabled: !!target, click: cmd({ t: 'pin', to: 'here' }) },
      { label: 'Открыть в DevTools', click: () => this.openDevTools(tab, p.x, p.y) },
      { type: 'separator' },
    ]
  }

  /** Each copy: where it comes from — the protocol, the page's inspector, or the page's picture. */
  private readonly sources: Record<CopyKind, (c: CopyCtx) => Promise<Copied>> = {
    html: (c) => this.byProtocol(c, 'html'),
    css: (c) => this.byProtocol(c, 'css'),
    computed: (c) => this.byProtocol(c, 'computed'),
    component: (c) => this.byProtocol(c, 'component'),
    selector: (c) => this.byProtocol(c, 'selector'),
    jspath: async (c) => `document.querySelector(${JSON.stringify(await this.byProtocol(c, 'selector'))})`,
    text: (c) => this.byPage(c, 'text'),
    xpath: (c) => this.byPage(c, 'xpath'),
    locator: (c) => this.byPage(c, 'locator'),
    shot: (c) => this.shot(c),
  }
  private async copy(c: CopyCtx, kind: CopyKind): Promise<void> {
    const what = COPY_WORDS[kind]
    try {
      const out = await this.sources[kind](c)
      if (typeof out === 'string') await clipboard.writeText(out)
      else await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(out)], { type: 'image/png' }) })])
      this.host.emit('inspectCopied', { tabId: c.tab.t.id, what, chars: typeof out === 'string' ? out.length : 0 })
    } catch (e) {
      this.host.emit('inspectCopied', { tabId: c.tab.t.id, what, error: e instanceof Error ? e.message : String(e) })
    }
  }
  private async byPage(c: CopyCtx, t: 'text' | 'xpath' | 'locator'): Promise<string> {
    const v = await this.ask.ask<string>(c.tab.view.webContents, { t })
    if (typeof v !== 'string') throw new Error('страница не ответила')
    return v
  }
  /** The protocol taken for the copy only (`copy`), let go after. */
  private async withProtocol<T>(tab: Tab, fn: (d: Electron.Debugger) => Promise<T>): Promise<T> {
    const d = this.host.cdp.use(tab, 'copy')
    try {
      return await fn(d)
    } finally {
      this.host.cdp.drop(tab, 'copy')
    }
  }
  private byProtocol(c: CopyCtx, kind: CdpCopyKind): Promise<string> {
    if (c.reach.up < 0) throw new Error('элемент закрыт другим — закрепите его родителя или прокрутите страницу')
    return this.withProtocol(c.tab, async (d) => {
      await d.sendCommand('DOM.enable')
      try {
        await d.sendCommand('DOM.getDocument', { depth: 0 })
        const backendNodeId = await this.nodeOf(d, c.reach)
        return await copyElement(
          {
            d,
            pageUrl: c.tab.view.webContents.getURL(),
            onScript: (fn) => this.host.cdp.listen('copy', (t, method, p) => t === c.tab && method === 'Debugger.scriptParsed' && fn(p)),
            fetchText: (url) =>
              this.host.ses
                .fetch(url)
                .then((r) => (r.ok ? r.text() : undefined))
                .catch(() => undefined),
          },
          kind,
          backendNodeId,
        )
      } finally {
        void d.sendCommand('DOM.disable').catch(() => undefined)
      }
    })
  }
  /** The target's node: the element at its point, then its parents up as the page counted them. */
  private async nodeOf(d: Electron.Debugger, r: Reach): Promise<number> {
    const at = (await d.sendCommand('DOM.getNodeForLocation', { x: Math.round(r.point.x), y: Math.round(r.point.y), includeUserAgentShadowDOM: false, ignorePointerEventsNone: true })) as { backendNodeId: number }
    if (!r.up) return at.backendNodeId
    const group = 'qa-inspect-reach'
    try {
      const o = (await d.sendCommand('DOM.resolveNode', { backendNodeId: at.backendNodeId, objectGroup: group })) as { object: { objectId: string } }
      const up = (await d.sendCommand('Runtime.callFunctionOn', { functionDeclaration: UP, objectId: o.object.objectId, arguments: [{ value: r.up }], objectGroup: group })) as { result: { objectId?: string } }
      if (!up.result.objectId) throw new Error('элемент не найден')
      return ((await d.sendCommand('DOM.describeNode', { objectId: up.result.objectId })) as { node: { backendNodeId: number } }).node.backendNodeId
    } finally {
      void d.sendCommand('Runtime.releaseObjectGroup', { objectGroup: group }).catch(() => undefined)
    }
  }
  /** The element's picture (the whole of it, even past the screen's edge). */
  private shot(c: CopyCtx): Promise<Buffer> {
    const r = c.target?.doc
    if (!r || r.width < 1 || r.height < 1) throw new Error('у элемента нет размеров')
    return this.withProtocol(c.tab, async (d) => {
      const shot = (await d.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } })) as { data: string }
      return Buffer.from(shot.data, 'base64')
    })
  }
}
