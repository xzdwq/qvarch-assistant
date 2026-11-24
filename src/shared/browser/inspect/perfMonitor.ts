import type { MonitorSample, NavTiming } from './types'

/**
 * The page's performance as DevTools' «Performance monitor» shows it: from two readings of Performance.getMetrics
 * (counters and seconds spent since the page started) — the share of time the main thread was busy, what it did
 * (scripts, layout, styles) and how often, the memory and the DOM now. And the page's opening by phases.
 */

/** A reading of Performance.getMetrics, by name. */
export type Metrics = Record<string, number>

const per = (a: Metrics, b: Metrics, k: string, secs: number) => Math.max(0, ((b[k] ?? 0) - (a[k] ?? 0)) / secs)

/** One sample from the reading before and now (`at` — the wall clock); none when no time passed. */
export function monitorSample(prev: Metrics, cur: Metrics, at: number): MonitorSample | undefined {
  const secs = (cur.Timestamp ?? 0) - (prev.Timestamp ?? 0)
  if (!(secs > 0)) return undefined
  return {
    at,
    cpu: Math.min(100, Math.round(per(prev, cur, 'TaskDuration', secs) * 100)),
    script: Math.round(per(prev, cur, 'ScriptDuration', secs) * 1000),
    layout: Math.round(per(prev, cur, 'LayoutDuration', secs) * 1000),
    style: Math.round(per(prev, cur, 'RecalcStyleDuration', secs) * 1000),
    heap: cur.JSHeapUsedSize ?? 0,
    nodes: cur.Nodes ?? 0,
    listeners: cur.JSEventListeners ?? 0,
    layouts: Math.round(per(prev, cur, 'LayoutCount', secs) * 10) / 10,
    recalcs: Math.round(per(prev, cur, 'RecalcStyleCount', secs) * 10) / 10,
    documents: cur.Documents ?? 0,
    frames: cur.Frames ?? 0,
  }
}

/** A PerformanceNavigationTiming as the page's probe reads it (its fields, ms from the navigation's start). */
export interface RawNavEntry {
  redirectStart: number
  redirectEnd: number
  domainLookupStart: number
  domainLookupEnd: number
  connectStart: number
  connectEnd: number
  secureConnectionStart: number
  requestStart: number
  responseStart: number
  responseEnd: number
  domContentLoadedEventEnd: number
  loadEventEnd: number
  nextHopProtocol?: string
}
const span = (a: number, b: number) => Math.max(0, Math.round(b - a))
/** The opening's phases from its entry (a phase that did not happen — 0). */
export function navTiming(e: RawNavEntry, paints: { fcp?: number; lcp?: number } = {}): NavTiming {
  const tlsFrom = e.secureConnectionStart > 0 ? e.secureConnectionStart : e.connectEnd
  return {
    redirect: span(e.redirectStart, e.redirectEnd),
    dns: span(e.domainLookupStart, e.domainLookupEnd),
    connect: span(e.connectStart, tlsFrom),
    tls: span(tlsFrom, e.connectEnd),
    wait: span(e.requestStart, e.responseStart),
    download: span(e.responseStart, e.responseEnd),
    dcl: Math.round(e.domContentLoadedEventEnd),
    load: Math.round(e.loadEventEnd),
    ...(paints.fcp !== undefined ? { fcp: Math.round(paints.fcp) } : {}),
    ...(paints.lcp !== undefined ? { lcp: Math.round(paints.lcp) } : {}),
    ...(e.nextHopProtocol ? { protocol: e.nextHopProtocol } : {}),
  }
}

const two = (n: number) => String(n).padStart(2, '0')
/** When an event was: the time to the millisecond; another day — its date first. */
export function clockText(at: number, now = Date.now()): string {
  const d = new Date(at)
  const n = new Date(now)
  const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return sameDay ? time : `${two(d.getDate())}.${two(d.getMonth() + 1)}${d.getFullYear() === n.getFullYear() ? '' : `.${d.getFullYear()}`} ${time}`
}
