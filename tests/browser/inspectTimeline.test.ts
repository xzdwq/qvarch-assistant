import { describe, expect, it } from 'vitest'
import { ActionLog } from '../../src/shared/browser/inspect/actionLog'
import { AnimStats, animCost } from '../../src/shared/browser/inspect/animStats'
import { initiatorText, packLanes, rangeBusy, rangeHosts } from '../../src/shared/browser/inspect/timeline'
import type { MonitorSample } from '../../src/shared/browser/inspect/types'

describe('the inspector timeline', () => {
  it('lays bars on lanes so none covers another; past the limit — the last lane', () => {
    expect(packLanes([{ start: 0, end: 10 }, { start: 5, end: 8 }, { start: 10, end: 12 }, { start: 6, end: 9 }], 2)).toEqual([0, 1, 0, 1])
  })
  it('a span by what the thread did: scripts, rendering, the rest, idle', () => {
    const s = (at: number, cpu: number, script: number, layout: number, style: number) => ({ at, cpu, script, layout, style }) as MonitorSample
    const b = rangeBusy([s(1000, 50, 300, 50, 50), s(2000, 10, 50, 0, 0), s(5000, 90, 900, 0, 0)], 0, 2000)
    expect(b).toEqual({ script: 350, render: 100, other: 150, idle: 1400, total: 2000 })
  })
  it('the domains of a span: scripts time and bytes, the page own marked', () => {
    const log = new ActionLog()
    log.act({ kind: 'click', label: 'A', at: 0 })
    log.busy({ at: 10, ms: 100, items: [{ kind: 'event', name: 'x', src: 'https://cdn.shop.test/app.js', at: 10, ms: 80 }, { kind: 'callback', name: 'y', src: 'https://ads.other.test/t.js', at: 50, ms: 20 }] })
    log.reqStart({ id: 'r', method: 'GET', url: 'https://ads.other.test/pixel', type: 'Image', start: 20 })
    log.reqUpdate('r', { end: 30, size: 900 })
    expect(rangeHosts(log.groups(), 0, 100, 'https://www.shop.test/')).toEqual([
      { host: 'cdn.shop.test', first: true, ms: 80, bytes: 0 },
      { host: 'ads.other.test', first: false, ms: 20, bytes: 900 },
    ])
  })
  it('who started a request: the nearest script frame (async parents too), the HTML, else the type', () => {
    expect(initiatorText({ type: 'script', stack: { callFrames: [], parent: { callFrames: [{ functionName: 'load', url: 'https://a.test/js/app.js?v=2', lineNumber: 9 }] } } })).toBe('load · app.js:10')
    expect(initiatorText({ type: 'parser', url: 'https://a.test/', lineNumber: 3 })).toBe('HTML a.test:4')
    expect(initiatorText({ type: 'other' })).toBe('')
  })
})

describe('the page animations', () => {
  it('cost by the properties: layout over paint over the compositor', () => {
    expect(animCost(['transform', 'opacity'])).toBe('composite')
    expect(animCost(['background-color'])).toBe('paint')
    expect(animCost(['opacity', 'height'])).toBe('layout')
  })
  it('summed by element and name: count, running, time, the heaviest first', () => {
    const st = new AnimStats()
    const a = (id: string, name: string, props: string[], at: number) => ({ id, kind: 'transition' as const, name, target: '.x', props, cost: animCost(props), at })
    st.start(a('1', 'opacity', ['opacity'], 0))
    st.end('1', 200)
    st.start(a('2', 'opacity', ['opacity'], 300))
    st.start(a('3', 'height', ['height'], 0))
    st.end('3', 100)
    const [first, second] = st.list()
    expect(first).toMatchObject({ name: 'height', cost: 'layout', count: 1, running: 0, total: 100 })
    expect(second).toMatchObject({ name: 'opacity', count: 2, running: 1, total: 200, max: 200 })
  })
})
