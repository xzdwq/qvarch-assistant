import { animCost } from '../../../shared/browser/inspect/animStats'
import { ACTION_KINDS, ACTION_WORDS, INSPECT_BINDING, INSPECT_WORLD, rateVital, taskKind, VITALS, type ActionKind, type NoteLevel, type VitalName } from '../../../shared/browser/inspect/constants'
import { initiatorText } from '../../../shared/browser/inspect/timeline'
import type { AnimEvent, InspectReq, ScrollInfo } from '../../../shared/browser/inspect/types'
import type { Tab } from '../tab'
import type { SitePassport } from './sitePassport'
import { PAGE_REQS_MAX, type TabInspect } from './tabInspect'

/** What the protocol's and the page's events reach. */
export interface InspectEventsHost {
  passport: SitePassport
  /** The facts made again a moment later (the vitals, the errors come in bursts). */
  refreshSoon(st: TabInspect): void
}
type CdpHandler = (tab: Tab, st: TabInspect, p: Record<string, any>) => void

/** The acts the page's watcher may tell (the opening and the routes are main's own). */
const PAGE_ACTS: readonly ActionKind[] = ACTION_KINDS.filter((k) => k === 'click' || k === 'input' || k === 'submit' || k === 'key' || k === 'scroll')
/** The browser's own messages kept as the page's notes (the network's are in the requests, the console's come on their own). */
const LOG_SOURCES = new Set(['security', 'violation', 'intervention', 'deprecation', 'recommendation', 'other', 'rendering', 'storage', 'worker'])
const LEVEL_OF: Record<string, NoteLevel | undefined> = { error: 'error', assert: 'error', warning: 'warning' }

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, n = 500) => String(v ?? '').slice(0, n)
/** A page's address in a few words (its host and path). */
export function pageWords(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 120)
  } catch {
    return url.slice(0, 120)
  }
}
/** The protocol's seconds as the wall clock. */
const wallOf = (st: TabInspect, ts: unknown) => Math.round((st.clockOffset ?? Date.now() - num(ts) * 1000) + num(ts) * 1000)

/** A page opened in the tab: a new group, the page's requests and vitals anew. */
function pageOpened(st: TabInspect, req: InspectReq, protocolId: string): void {
  st.reqs.clear()
  st.alias.clear()
  st.vitals.clear()
  st.errors = 0
  st.softNavs = 0
  st.doc = req
  st.docRequestId = protocolId
  st.factsInput = undefined
  st.anims.reset()
  st.passportSeq++
  st.log.act({ kind: 'nav', label: `${ACTION_WORDS.nav}: ${pageWords(req.url)}`, at: req.start, url: req.url })
}

/** The protocol's events the inspector listens to: the method → what it does. */
export function inspectCdpHandlers(h: InspectEventsHost): Record<string, CdpHandler> {
  const local = (st: TabInspect, id: string) => st.alias.get(id) ?? id
  const update = (st: TabInspect, id: string, patch: Partial<InspectReq>) => {
    const lid = local(st, id)
    const r = st.reqs.get(lid)
    if (r) Object.assign(r, patch)
    st.log.reqUpdate(lid, patch)
  }
  return {
    'Network.requestWillBeSent': (_tab, st, p) => {
      st.clockOffset = num(p.wallTime) * 1000 - num(p.timestamp) * 1000
      const id = str(p.requestId, 200)
      const at = wallOf(st, p.timestamp)
      // a redirect: the hop before ends here, the next one is a request of its own
      if (p.redirectResponse) {
        update(st, id, { end: at, status: num(p.redirectResponse.status), resHeaders: p.redirectResponse.headers ?? {} })
        st.alias.set(id, `${id}~${at}`)
      }
      const req: InspectReq = { id: local(st, id), method: str(p.request?.method, 20) || 'GET', url: str(p.request?.url, 4000), type: str(p.type, 40) || 'Other', start: at, reqHeaders: p.request?.headers ?? {}, ...(initiatorText(p.initiator) ? { initiator: initiatorText(p.initiator).slice(0, 300) } : {}) }
      const main = p.type === 'Document' && p.requestId === p.loaderId && (!st.mainFrame || p.frameId === st.mainFrame)
      if (main && !p.redirectResponse) pageOpened(st, req, id)
      else if (main) {
        st.doc = req
        st.docRequestId = id
      }
      if (st.reqs.size < PAGE_REQS_MAX) st.reqs.set(req.id, req)
      st.log.reqStart(req)
    },
    'Network.responseReceived': (_tab, st, p) => {
      const r = p.response ?? {}
      update(st, str(p.requestId, 200), { status: num(r.status), mime: str(r.mimeType, 100), proto: str(r.protocol, 20), resHeaders: r.headers ?? {}, ...(r.requestHeaders ? { reqHeaders: r.requestHeaders } : {}), ...(r.fromDiskCache || r.fromServiceWorker || r.fromPrefetchCache ? { cached: true } : {}) })
    },
    'Network.requestServedFromCache': (_tab, st, p) => update(st, str(p.requestId, 200), { cached: true }),
    'Network.loadingFinished': (_tab, st, p) => update(st, str(p.requestId, 200), { end: wallOf(st, p.timestamp), size: num(p.encodedDataLength) }),
    'Network.loadingFailed': (_tab, st, p) => update(st, str(p.requestId, 200), { end: wallOf(st, p.timestamp), failed: p.canceled ? 'отменён' : str(p.blockedReason ? `заблокирован: ${p.blockedReason}` : p.corsErrorStatus ? `CORS: ${p.corsErrorStatus.corsError}` : p.errorText, 200) }),
    'Network.webSocketCreated': (_tab, st, p) => {
      const req: InspectReq = { id: str(p.requestId, 200), method: 'GET', url: str(p.url, 4000), type: 'WebSocket', start: Date.now() }
      st.log.reqStart(req)
      if (st.reqs.size < PAGE_REQS_MAX) st.reqs.set(req.id, req)
    },
    'Network.webSocketClosed': (_tab, st, p) => update(st, str(p.requestId, 200), { end: wallOf(st, p.timestamp) }),
    'Runtime.consoleAPICalled': (_tab, st, p) => {
      const level = LEVEL_OF[String(p.type)]
      if (!level || st.ownCtx.has(num(p.executionContextId))) return
      const text = ((p.args ?? []) as Array<{ value?: unknown; description?: string }>).map((a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description ?? ''))).join(' ')
      const f = p.stackTrace?.callFrames?.[0]
      st.log.note({ at: Math.round(num(p.timestamp, Date.now())), level, text: text.slice(0, 2000), ...(f ? { where: `${f.url}:${num(f.lineNumber) + 1}` } : {}) })
      if (level === 'error') (st.errors++, h.refreshSoon(st))
    },
    'Runtime.exceptionThrown': (_tab, st, p) => {
      const e = p.exceptionDetails ?? {}
      if (st.ownCtx.has(num(e.executionContextId))) return
      st.log.note({ at: Math.round(num(p.timestamp, Date.now())), level: 'error', text: str(e.exception?.description ?? e.text ?? 'Исключение', 2000), ...(e.url ? { where: `${e.url}:${num(e.lineNumber) + 1}` } : {}) })
      st.errors++
      h.refreshSoon(st)
    },
    'Log.entryAdded': (_tab, st, p) => {
      const e = p.entry ?? {}
      const level = LEVEL_OF[String(e.level)]
      if (!level || !LOG_SOURCES.has(String(e.source))) return
      st.log.note({ at: Math.round(num(e.timestamp, Date.now())), level, text: `[${e.source}] ${str(e.text, 2000)}`, ...(e.url ? { where: `${e.url}:${num(e.lineNumber) + 1}` } : {}) })
    },
    'Runtime.executionContextCreated': (_tab, st, p) => {
      if (p.context?.name === INSPECT_WORLD) st.ownCtx.add(num(p.context.id))
    },
    'Runtime.executionContextsCleared': (_tab, st) => st.ownCtx.clear(),
    'Page.frameNavigated': (_tab, st, p) => {
      if (!p.frame?.parentId) st.mainFrame = str(p.frame?.id, 200)
    },
    'Page.navigatedWithinDocument': (_tab, st, p) => {
      if (st.mainFrame && p.frameId !== st.mainFrame) return
      st.softNavs++
      st.log.act({ kind: 'route', label: `${ACTION_WORDS.route}: ${pageWords(str(p.url, 4000))}`, at: Date.now(), url: str(p.url, 4000) })
    },
    'Page.loadEventFired': (tab, st) => h.passport.schedule(tab, st),
    'Runtime.bindingCalled': (tab, st, p) => {
      if (p.name !== INSPECT_BINDING) return
      let m: Record<string, any>
      try {
        m = JSON.parse(String(p.payload)) as Record<string, any>
      } catch {
        return
      }
      if (Object.hasOwn(PAGE_MESSAGES, m.t)) PAGE_MESSAGES[m.t](h, tab, st, m)
    },
  }
}

/** The page watcher's messages (the page's word — checked): the type → what it does. */
const PAGE_MESSAGES: Record<string, (h: InspectEventsHost, tab: Tab, st: TabInspect, m: Record<string, any>) => void> = {
  act: (_h, _tab, st, m) => {
    if (!PAGE_ACTS.includes(m.kind as ActionKind)) return
    st.log.act({ kind: m.kind as ActionKind, label: `${ACTION_WORDS[m.kind as ActionKind]}: ${str(m.label, 80) || '—'}`, at: Math.round(num(m.at, Date.now())), ...(m.target ? { target: str(m.target, 400) } : {}) })
  },
  busy: (_h, _tab, st, m) =>
    st.log.busy({
      at: num(m.at),
      ms: num(m.ms),
      items: (Array.isArray(m.items) ? (m.items as Array<Record<string, unknown>>) : []).slice(0, 8).map((s) => ({ kind: taskKind(str(s.type, 40)), name: str(s.name, 200), ...(s.fn ? { fn: str(s.fn, 120) } : {}), ...(s.src ? { src: str(s.src, 300) } : {}), at: num(s.at), ms: num(s.ms) })),
    }),
  scroll: (_h, _tab, st, m) => {
    const i = (m.info ?? {}) as Record<string, unknown>
    const info: ScrollInfo = { target: str(i.target, 400), distance: num(i.distance), dir: i.dir === 'up' || i.dir === 'side' ? i.dir : 'down', ms: num(i.ms), fps: num(i.fps), slow: num(i.slow), maxFrame: num(i.maxFrame), added: num(i.added), removed: num(i.removed) }
    st.log.scroll(num(m.at), info)
  },
  anim: (_h, _tab, st, m) => {
    for (const s of Array.isArray(m.starts) ? (m.starts as Array<Record<string, unknown>>).slice(0, 100) : []) {
      const props = (Array.isArray(s.props) ? s.props : []).map((p) => str(p, 60)).slice(0, 20)
      const a: AnimEvent = { id: str(s.id, 40), kind: s.kind === 'transition' ? 'transition' : 'animation', name: str(s.name, 120), target: str(s.target, 400), props, cost: animCost(props), at: num(s.at), ...(s.infinite ? { infinite: true } : {}) }
      st.anims.start(a)
      st.log.anim(a)
    }
    for (const e of Array.isArray(m.ends) ? (m.ends as Array<Record<string, unknown>>).slice(0, 200) : []) {
      st.anims.end(str(e.id, 40), num(e.at))
      st.log.animEnd(str(e.id, 40), num(e.at))
    }
  },
  resp: (_h, _tab, st, m) => st.log.response(num(m.at), { total: num(m.total), delay: num(m.delay), processing: num(m.processing), presentation: num(m.presentation) }),
  shift: (_h, _tab, st, m) => st.log.shift(num(m.at), num(m.value)),
  vitals: (h, _tab, st, m) => {
    for (const v of Array.isArray(m.list) ? (m.list as Array<Record<string, unknown>>) : []) {
      const name = String(v.name) as VitalName
      if (!Object.hasOwn(VITALS, name)) continue
      const value = num(v.value)
      st.vitals.set(name, { name, value, rating: rateVital(name, value), ...(v.target ? { target: str(v.target, 400) } : {}) })
    }
    h.refreshSoon(st)
  },
}
