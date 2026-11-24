import { taskWhere } from './actionLog'
import type { ActionGroup, MonitorSample } from './types'

/**
 * The timeline (as DevTools' Performance shows it, lightly): bars laid on lanes so none covers another; what a span
 * of time went on (scripts, layout and styles, the rest, idle — from the monitor's seconds); the main thread's time
 * and the bytes by domain (first party marked); who started a request.
 */

/** Each span's lane (the first free one); past the lanes' limit — the last lane (they overlap there). */
export function packLanes(spans: Array<{ start: number; end: number }>, maxLanes: number): number[] {
  const ends: number[] = []
  return spans.map((s) => {
    let lane = ends.findIndex((e) => e <= s.start)
    if (lane < 0) lane = ends.length < maxLanes ? ends.length : maxLanes - 1
    ends[lane] = Math.max(ends[lane] ?? 0, s.end)
    return lane
  })
}

/** What a span of time went on, ms (the monitor's seconds within it). */
export interface RangeBusy {
  script: number
  render: number
  other: number
  idle: number
  total: number
}
export function rangeBusy(samples: MonitorSample[], from: number, to: number): RangeBusy {
  const inside = samples.filter((s) => s.at > from && s.at <= to + 1000)
  const sec = (s: MonitorSample, i: number) => Math.min(1000, s.at - (i ? inside[i - 1].at : s.at - 1000))
  let script = 0
  let render = 0
  let busy = 0
  inside.forEach((s, i) => {
    const k = sec(s, i) / 1000
    script += s.script * k
    render += (s.layout + s.style) * k
    busy += s.cpu * 10 * k
  })
  const total = Math.max(0, to - from)
  const other = Math.max(0, busy - script - render)
  return { script: Math.round(script), render: Math.round(render), other: Math.round(other), idle: Math.max(0, Math.round(total - busy)), total }
}

/** A domain's share of a span: the main thread's time of its scripts, the bytes of its files. */
export interface HostShare {
  host: string
  first: boolean
  ms: number
  bytes: number
}
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}
const siteOf = (h: string) => h.split('.').slice(-2).join('.')
/** The domains of a span, the busiest first (scripts with no address — «[без адреса]»). */
export function rangeHosts(groups: ActionGroup[], from: number, to: number, pageUrl: string): HostShare[] {
  const own = siteOf(hostOf(pageUrl))
  const m = new Map<string, HostShare>()
  const at = (host: string) => m.get(host) ?? m.set(host, { host, first: !!host && siteOf(host) === own, ms: 0, bytes: 0 }).get(host)!
  for (const g of groups) {
    for (const t of g.tasks) for (const i of t.items) if (i.at >= from && i.at <= to) at(hostOf(i.src ?? '') || '[без адреса]').ms += i.ms
    for (const r of g.reqs) if (r.start >= from && r.start <= to) at(hostOf(r.url) || '[без адреса]').bytes += r.size ?? 0
  }
  return [...m.values()].sort((a, b) => b.ms - a.ms || b.bytes - a.bytes)
}

/** A request's starter as the protocol tells it (Network.Initiator), in a few words. */
export function initiatorText(i: { type?: string; url?: string; lineNumber?: number; stack?: { callFrames?: Array<{ functionName?: string; url?: string; lineNumber?: number }>; parent?: unknown } } | undefined): string {
  if (!i) return ''
  const file = (u?: string) => {
    if (!u) return ''
    try {
      const p = new URL(u)
      return p.pathname.split('/').pop() || p.hostname
    } catch {
      return u
    }
  }
  // (the nearest frame with an address — through the async parents)
  for (let s: typeof i.stack | undefined = i.stack; s; s = s.parent as typeof i.stack) {
    const f = s.callFrames?.find((c) => c.url)
    if (f) return `${f.functionName || '(анонимная)'} · ${file(f.url)}:${(f.lineNumber ?? 0) + 1}`
  }
  if (i.type === 'parser') return `HTML${i.url ? ` ${file(i.url)}:${(i.lineNumber ?? 0) + 1}` : ''}`
  return i.type && i.type !== 'other' ? i.type : ''
}

/** The scripts of a group's long frames in words (the timeline's tooltips). */
export const taskLabel = taskWhere
