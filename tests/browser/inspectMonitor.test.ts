import { describe, expect, it } from 'vitest'
import { clockText, monitorSample, navTiming } from '../../src/shared/browser/inspect/perfMonitor'

describe('the page performance monitor', () => {
  it('a sample per second from two readings: busy share, what it did, how often; the memory and DOM now', () => {
    const a = { Timestamp: 10, TaskDuration: 1, ScriptDuration: 0.5, LayoutDuration: 0.1, RecalcStyleDuration: 0.05, LayoutCount: 10, RecalcStyleCount: 20 }
    const b = { Timestamp: 12, TaskDuration: 1.6, ScriptDuration: 0.9, LayoutDuration: 0.14, RecalcStyleDuration: 0.07, LayoutCount: 13, RecalcStyleCount: 25, JSHeapUsedSize: 5e6, Nodes: 900, JSEventListeners: 40, Documents: 2, Frames: 1 }
    expect(monitorSample(a, b, 1000)).toEqual({ at: 1000, cpu: 30, script: 200, layout: 20, style: 10, heap: 5e6, nodes: 900, listeners: 40, layouts: 1.5, recalcs: 2.5, documents: 2, frames: 1 })
    expect(monitorSample(b, b, 1000)).toBeUndefined()
  })
  it('the opening by phases (no redirect, TLS on its own)', () => {
    const t = navTiming(
      { redirectStart: 0, redirectEnd: 0, domainLookupStart: 5, domainLookupEnd: 25, connectStart: 25, secureConnectionStart: 45, connectEnd: 80, requestStart: 81, responseStart: 281, responseEnd: 300, domContentLoadedEventEnd: 900, loadEventEnd: 1500, nextHopProtocol: 'h2' },
      { fcp: 700.4 },
    )
    expect(t).toEqual({ redirect: 0, dns: 20, connect: 20, tls: 35, wait: 200, download: 19, dcl: 900, load: 1500, fcp: 700, protocol: 'h2' })
  })
  it('an event time to the millisecond; another day with its date', () => {
    const now = new Date(2026, 10, 24, 15, 0, 0).getTime()
    expect(clockText(new Date(2026, 10, 24, 9, 5, 7, 42).getTime(), now)).toBe('09:05:07.042')
    expect(clockText(new Date(2026, 10, 23, 23, 59, 59, 999).getTime(), now)).toBe('23.11 23:59:59.999')
    expect(clockText(new Date(2025, 0, 2, 1, 2, 3, 4).getTime(), now)).toBe('02.01.2025 01:02:03.004')
  })
})
