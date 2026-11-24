import type { CopyKind } from '../../../shared/browser/inspect/constants'

/** The copies made over the protocol (the rest — by the page's inspector or as a picture). */
export const CDP_COPY_KINDS = ['html', 'selector', 'css', 'computed', 'component'] as const satisfies readonly CopyKind[]
export type CdpCopyKind = (typeof CDP_COPY_KINDS)[number]
import { componentMarkdown, type ComponentInfo, type HandlerInfo } from '../../../shared/browser/inspect/componentBundle'
import { computedCss, cssOfElements, type CdpMatched } from '../../../shared/browser/inspect/cssBundle'
import { FRAMEWORK_FUNCTION, LABEL_FUNCTION, SELECTOR_FUNCTION } from '../../../shared/browser/inspect/pageScripts'
import { originalPlace, sourceAround, sourceMapUrl, type RawSourceMap } from '../../../shared/browser/inspect/sourceMap'

/** What a copy needs: the page's protocol, its scripts as the debugger tells them, a fetch with the site's cookies. */
export interface CopyDeps {
  d: Electron.Debugger
  pageUrl: string
  /** The debugger's «scriptParsed» heard while the copy goes (the listener taken off by what it returns). */
  onScript(fn: (p: Record<string, any>) => void): () => void
  fetchText(url: string): Promise<string | undefined>
}
/** A component's elements read at most (their styles one by one), and its handlers. */
const MAX_NODES = 300
const MAX_HANDLERS = 60
const GROUP = 'qa-inspect-copy'

/** One copy: the element and what is read of it once (its object, node id, path). */
class Target {
  private obj?: Promise<string>
  private node?: Promise<number>
  constructor(
    readonly deps: CopyDeps,
    readonly backendNodeId: number,
  ) {}
  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.deps.d.sendCommand(method, params) as Promise<T>
  }
  objectId(): Promise<string> {
    this.obj ??= this.send<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId: this.backendNodeId, objectGroup: GROUP }).then((r) => r.object.objectId)
    return this.obj
  }
  nodeId(): Promise<number> {
    this.node ??= this.send('DOM.getDocument', { depth: 0 }).then(() => this.send<{ nodeIds: number[] }>('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [this.backendNodeId] }).then((r) => r.nodeIds[0]))
    return this.node
  }
  async call<T>(fn: string, objectId?: string): Promise<T> {
    const r = await this.send<{ result: { value?: T } }>('Runtime.callFunctionOn', { functionDeclaration: fn, objectId: objectId ?? (await this.objectId()), returnByValue: true, silent: true })
    return r.result.value as T
  }
  selector(): Promise<string> {
    return this.call<string>(SELECTOR_FUNCTION)
  }
  html(): Promise<string> {
    return this.send<{ outerHTML: string }>('DOM.getOuterHTML', { backendNodeId: this.backendNodeId }).then((r) => r.outerHTML)
  }
  /** The CSS domain on for what is asked of it, off after (it follows every stylesheet while on). */
  async withCss<T>(fn: () => Promise<T>): Promise<T> {
    await this.send('CSS.enable')
    try {
      return await fn()
    } finally {
      void this.send('CSS.disable').catch(() => undefined)
    }
  }
  matched(nodeId: number): Promise<CdpMatched> {
    return this.send<CdpMatched>('CSS.getMatchedStylesForNode', { nodeId })
  }
}

/** Each kind of copy: what it reads and how it is written. */
const COPIES: Record<CdpCopyKind, (t: Target) => Promise<string>> = {
  html: (t) => t.html(),
  selector: (t) => t.selector(),
  css: async (t) => {
    const [sel, nodeId] = await Promise.all([t.selector(), t.nodeId()])
    return t.withCss(async () => cssOfElements([await t.matched(nodeId)], sel))
  },
  computed: async (t) => {
    const [sel, nodeId] = await Promise.all([t.selector(), t.nodeId()])
    return t.withCss(async () => computedCss((await t.send<{ computedStyle: Array<{ name: string; value: string }> }>('CSS.getComputedStyleForNode', { nodeId })).computedStyle, sel))
  },
  component: (t) => component(t),
}

/** An element copied as asked (`backendNodeId` — the protocol's id of it). */
export async function copyElement(deps: CopyDeps, kind: CdpCopyKind, backendNodeId: number): Promise<string> {
  const t = new Target(deps, backendNodeId)
  try {
    return await COPIES[kind](t)
  } finally {
    void t.send('Runtime.releaseObjectGroup', { objectGroup: GROUP }).catch(() => undefined)
  }
}

/** The whole component: its HTML, the CSS of all its elements, its handlers (with their source), what its framework says. */
async function component(t: Target): Promise<string> {
  const notes: string[] = []
  const [sel, html, nodeId] = await Promise.all([t.selector(), t.html(), t.nodeId()])
  const inside = (await t.send<{ nodeIds: number[] }>('DOM.querySelectorAll', { nodeId, selector: '*' })).nodeIds
  if (inside.length > MAX_NODES) notes.push(`Стили прочитаны у первых ${MAX_NODES} из ${inside.length} вложенных элементов`)
  const css = await t.withCss(async () => {
    const all: CdpMatched[] = [await t.matched(nodeId)]
    const ids = inside.slice(0, MAX_NODES)
    // (a few at a time: the page's renderer answers them one by one anyway)
    for (let i = 0; i < ids.length; i += 20) all.push(...(await Promise.all(ids.slice(i, i + 20).map((id) => t.matched(id).catch(() => ({}) as CdpMatched)))))
    return cssOfElements(all, sel)
  })
  const info = (await t.call<ComponentInfo[]>(FRAMEWORK_FUNCTION).catch(() => [])) ?? []
  if (!info.length) notes.push('Фреймворк компонента не определён (или сборка без отладочных имён)')
  const handlers = await handlersOf(t, notes)
  return componentMarkdown({ page: t.deps.pageUrl, selector: sel, html, css, info, handlers, notes })
}

type Listener = { type: string; useCapture: boolean; passive: boolean; once: boolean; scriptId: string; lineNumber: number; columnNumber: number; handler?: { objectId?: string }; backendNodeId?: number }

/**
 * The event handlers on the element and inside it, each with its code; its place in the source when the site's
 * source map shows it. The debugger is on for the moment (it names the scripts and their maps), off after.
 */
async function handlersOf(t: Target, notes: string[]): Promise<HandlerInfo[]> {
  const scripts = new Map<string, { url: string; map?: string }>()
  const off = t.deps.onScript((p) => scripts.set(String(p.scriptId), { url: String(p.url ?? ''), ...(p.sourceMapURL ? { map: String(p.sourceMapURL) } : {}) }))
  try {
    await t.send('Debugger.enable')
    // (the page never stops on a `debugger;` of its own meanwhile)
    await t.send('Debugger.setSkipAllPauses', { skip: true }).catch(() => undefined)
    const { listeners } = await t.send<{ listeners: Listener[] }>('DOMDebugger.getEventListeners', { objectId: await t.objectId(), depth: -1, pierce: true })
    if (listeners.length > MAX_HANDLERS) notes.push(`Показаны ${MAX_HANDLERS} обработчиков из ${listeners.length}`)
    const labels = new Map<number, string>()
    const maps = new Map<string, Promise<RawSourceMap | undefined>>()
    const out: HandlerInfo[] = []
    for (const l of listeners.slice(0, MAX_HANDLERS)) {
      const s = scripts.get(l.scriptId)
      const on = l.backendNodeId === undefined || l.backendNodeId === t.backendNodeId ? 'сам элемент' : await labelOf(t, l.backendNodeId, labels)
      const code = l.handler?.objectId ? await t.call<string>('function () { return Function.prototype.toString.call(this) }', l.handler.objectId).catch(() => undefined) : undefined
      const h: HandlerInfo = { type: l.type, on, capture: l.useCapture, once: l.once, passive: l.passive, ...(s?.url ? { script: s.url } : {}), line: l.lineNumber, ...(code ? { code } : {}) }
      const mapUrl = s ? sourceMapUrl(s.url, s.map) : undefined
      if (mapUrl) {
        if (!maps.has(mapUrl)) maps.set(mapUrl, readMap(t.deps, mapUrl))
        const map = await maps.get(mapUrl)
        const place = map && originalPlace(map, l.lineNumber, l.columnNumber)
        if (place) h.source = { file: place.source, line: place.line, ...(sourceAround(map, place) ? { code: sourceAround(map, place) } : {}) }
      }
      out.push(h)
    }
    if (out.some((h) => h.script) && !out.some((h) => h.source)) notes.push('Source maps у скриптов сайта не найдены — код обработчиков из сборки')
    return out
  } catch (e) {
    notes.push(`Обработчики не прочитаны: ${e instanceof Error ? e.message : String(e)}`)
    return []
  } finally {
    off()
    void t.send('Debugger.disable').catch(() => undefined)
  }
}
async function labelOf(t: Target, backendNodeId: number, cache: Map<number, string>): Promise<string> {
  const had = cache.get(backendNodeId)
  if (had) return had
  const label = await t
    .send<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId, objectGroup: GROUP })
    .then((r) => t.call<string>(LABEL_FUNCTION, r.object.objectId))
    .catch(() => 'вложенный элемент')
  cache.set(backendNodeId, label)
  return label
}
/** A source map read (inline data: or fetched with the site's cookies); one not read — none. */
async function readMap(deps: CopyDeps, url: string): Promise<RawSourceMap | undefined> {
  try {
    if (url.startsWith('data:')) {
      const body = url.slice(url.indexOf(',') + 1)
      return JSON.parse(/;base64,/.test(url) ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body)) as RawSourceMap
    }
    const text = await deps.fetchText(url)
    return text ? (JSON.parse(text) as RawSourceMap) : undefined
  } catch {
    return undefined
  }
}
