import { inspectProbeExpression } from '../../../shared/browser/inspect/pageScripts'
import { navTiming, type RawNavEntry } from '../../../shared/browser/inspect/perfMonitor'
import { htmlText, renderInfo, type RenderMark } from '../../../shared/browser/inspect/renderMode'
import { cacheHit, siteFacts, type PageCounts, type SiteCookie, type SiteInput } from '../../../shared/browser/inspect/siteFacts'
import type { TechSignals } from '../../../shared/browser/inspect/techEngine'
import type { SitePassport as Passport, VitalValue } from '../../../shared/browser/inspect/types'
import type { BrowserHost, Tab } from '../tab'
import type { TechDetector } from './techDetector'
import type { TabInspect } from './tabInspect'

/** What the page's probe answers (pageScripts.ts inspectProbeExpression). */
interface ProbeAnswer {
  nav: RawNavEntry | null
  fcp?: number
  js: TechSignals['js']
  dom: TechSignals['dom']
  meta: TechSignals['meta']
  scriptSrc: string[]
  text: string
  textLen: number
  marks: RenderMark[]
  manifest: boolean
  worker: boolean
  counts: PageCounts
}
/** The server's HTML read for the passport, at most (a huge page — its start is enough). */
const MAX_HTML = 2 * 1024 * 1024
/** A page loaded: its passport is made after it settles this long, ms (the page's own work first). */
export const PASSPORT_AFTER_MS = 1500

/**
 * The site's passport, made once its page has loaded (and again on request): the page's probe (globals, selectors,
 * marks, counts, the opening's phases — in the page, yielding to it), the server's HTML, the cookies, the page's
 * memory (the monitor's last reading), the PWA check →
 * how the page is made and its facts at once; the technologies follow from their own process. A newer page of the
 * tab drops what an older one was making.
 */
export class SitePassport {
  constructor(
    private host: BrowserHost,
    private detector: TechDetector,
    private changed: (st: TabInspect) => void,
  ) {}

  /** Made a moment later (a page loaded, the inspector turned on). */
  schedule(tab: Tab, st: TabInspect, ms = PASSPORT_AFTER_MS): void {
    clearTimeout(st.passportTimer)
    st.passportTimer = setTimeout(() => void this.collect(tab, st), ms)
  }
  async collect(tab: Tab, st: TabInspect): Promise<void> {
    if (!st.on || tab.asleep) return
    const seq = ++st.passportSeq
    const wc = tab.view.webContents
    const url = wc.getURL()
    if (!/^https?:/i.test(url)) {
      st.passport = undefined
      return this.changed(st)
    }
    const d = wc.debugger
    const vitals = [...st.vitals.values()]
    st.passport = { url, at: Date.now(), pending: true, tech: st.passport?.url === url ? st.passport.tech : [], facts: [], problems: [], vitals }
    this.changed(st)
    const stale = () => seq !== st.passportSeq || !st.on || wc.isDestroyed()
    try {
      const plan = (await this.detector.probePlan()) ?? { js: [], dom: [] }
      if (stale()) return
      const probe = ((await d.sendCommand('Runtime.evaluate', { expression: inspectProbeExpression(plan), awaitPromise: true, returnByValue: true, silent: true })) as { result: { value?: ProbeAnswer } }).result.value
      if (!probe || stale()) return
      const html = await this.serverHtml(tab, st)
      const cookies = await this.host.ses.cookies.get({ url }).catch(() => [])
      const metrics = st.metrics ?? {}
      const installable = probe.manifest ? await d.sendCommand('Page.getInstallabilityErrors').then((r) => !(r as { installabilityErrors: unknown[] }).installabilityErrors.length).catch(() => undefined) : undefined
      if (stale()) return
      const reqs = [...st.reqs.values()]
      const headers = st.doc?.resHeaders ?? {}
      const render = renderInfo({ ...(html !== undefined ? { serverText: htmlText(html).length } : {}), pageText: probe.textLen, marks: probe.marks, cached: cacheHit(headers), softNavs: st.softNavs, manifest: probe.manifest, worker: probe.worker, ...(installable !== undefined ? { installable } : {}) })
      const siteCookies: SiteCookie[] = cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain ?? '', secure: !!c.secure, httpOnly: !!c.httpOnly, ...(c.sameSite ? { sameSite: c.sameSite } : {}), session: !!c.session }))
      st.factsInput = { url, ...(st.doc ? { doc: st.doc } : {}), reqs, cookies: siteCookies, page: probe.counts, metrics, vitals, errors: st.errors }
      const lcp = st.vitals.get('LCP')?.value
      const timing = probe.nav ? navTiming(probe.nav, { ...(probe.fcp !== undefined ? { fcp: probe.fcp } : {}), ...(lcp !== undefined ? { lcp } : {}) }) : undefined
      st.passport = { ...st.passport, render, ...this.facts(st), ...(timing ? { timing } : {}) }
      if (!st.doc) st.passport.facts.unshift({ group: 'Сеть', label: 'Заголовки ответа', value: 'инспектор включён после загрузки — обновите страницу для полного разбора', level: 'info' })
      this.changed(st)
      const signals: TechSignals = {
        url,
        html: (html ?? '').slice(0, MAX_HTML),
        text: probe.text,
        scriptSrc: [...new Set([...probe.scriptSrc, ...reqs.filter((r) => r.type === 'Script').map((r) => r.url)])].slice(0, 500),
        xhr: [...new Set(reqs.filter((r) => r.type === 'XHR' || r.type === 'Fetch').map((r) => hostOf(r.url)).filter(Boolean))],
        headers,
        cookies: Object.fromEntries(siteCookies.map((c) => [c.name, c.value])),
        meta: probe.meta,
        js: probe.js,
        dom: probe.dom,
      }
      const tech = await this.detector.detect(tab.t.id, signals)
      if (stale()) return
      st.passport = { ...st.passport, tech, pending: false }
      this.changed(st)
    } catch {
      if (!stale() && st.passport) {
        st.passport = { ...st.passport, pending: false }
        this.changed(st)
      }
    }
  }
  /** The facts made again with what came since (the vitals, the errors) — the probe is not asked again. */
  refresh(st: TabInspect): void {
    if (!st.factsInput || !st.passport) return
    st.factsInput = { ...st.factsInput, vitals: [...st.vitals.values()], errors: st.errors }
    st.passport = { ...st.passport, ...this.facts(st) }
    this.changed(st)
  }
  private facts(st: TabInspect): { facts: Passport['facts']; problems: Passport['problems']; vitals: VitalValue[] } {
    const input = st.factsInput as SiteInput
    return { ...siteFacts(input), vitals: input.vitals }
  }
  /** The document as the server sent it (the protocol keeps its body a while) — none when gone. */
  private async serverHtml(tab: Tab, st: TabInspect): Promise<string | undefined> {
    if (!st.docRequestId) return undefined
    try {
      const r = (await tab.view.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: st.docRequestId })) as { body: string; base64Encoded: boolean }
      return r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body
    } catch {
      return undefined
    }
  }
}
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}
