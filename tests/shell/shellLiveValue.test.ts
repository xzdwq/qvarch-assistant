import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newestLinesFirst, OutputCollector } from '../../src/shared/shell/output'
import { liveValue } from '../../src/notebook/engine/shellValueLive'
import { noteRun, settledItem } from '../../src/notebook/engine/runStore'
import { setRunApi, type RunApi } from '../../src/notebook/engine/runApi'
import { infoMd, parseInfo } from '../../src/notebook/domain/blockInfo'
import { findBlocks } from '../../src/notebook/domain/findBlocks'

describe('a shell value while its run goes on', () => {
  it('a snapshot consumes nothing: a line not ended yet is not cut in two', () => {
    const c = new OutputCollector()
    c.feed('out', 'one\ntw')
    const s = c.snapshot(5)
    expect(s).toMatchObject({ running: true, exitCode: -1, ok: false, lines: ['one'], stdout: 'one\ntw', ms: 5 })
    c.feed('out', 'o\n')
    expect(c.snapshot(6).lines).toEqual(['one', 'two'])
    expect(c.result(0, 7)).toMatchObject({ lines: ['one', 'two'], ok: true })
    expect(c.result(0, 7).running).toBeUndefined()
  })
  it('newest lines first: the ending newline is no empty line', () => {
    expect(newestLinesFirst('a\nb\nc\n')).toBe('c\nb\na')
    expect(newestLinesFirst('a\r\nb')).toBe('b\na\r')
    expect(newestLinesFirst('')).toBe('')
  })
  it('a value saved while its run went on is loaded as partial, never as still running', () => {
    expect(settledItem({ value: 1, at: 1, from: 'shell', block: 'b', running: true })).toEqual({ value: 1, at: 1, from: 'shell', block: 'b', partial: true })
    const done = { value: 1, at: 1, from: 'shell' as const, block: 'b' }
    expect(settledItem(done)).toBe(done)
  })
})

describe('a «Значение» block\'s line', () => {
  it('no variable chosen yet — still a «Значение» (not a data block); watch kept', () => {
    const i = parseInfo('json ref=')
    expect(i.ref).toBe('')
    expect(infoMd(i)).toBe('json ref=')
    expect(findBlocks(['```json ref=', '```']).map((b) => b.kind)).toEqual(['ref'])
    expect(infoMd(parseInfo('json ref=logs.lines watch'))).toBe('json ref=logs.lines watch')
    expect(parseInfo('json name=x').ref).toBeUndefined()
  })
})

describe('liveValue publishes the growing value', () => {
  const path = 't/live.md'
  beforeEach(() => {
    vi.useFakeTimers()
    setRunApi({ runSave: async () => undefined } as unknown as RunApi)
  })
  afterEach(() => {
    vi.useRealTimers()
    setRunApi(undefined)
  })
  it('throttled, marked running; the final value leaves it alone', () => {
    const lv = liveValue(path, 'logs', 'k1')
    lv.feed('out', 'a\n')
    lv.feed('out', 'b\n')
    expect(noteRun(path).ctx.logs).toBeUndefined()
    vi.advanceTimersByTime(300)
    const item = noteRun(path).ctx.logs
    expect(item.running).toBe(true)
    expect((item.value as { lines: string[] }).lines).toEqual(['a', 'b'])
    lv.end({ exitCode: 0, ok: true, stdout: 'a\nb\n', stderr: '', lines: ['a', 'b'], ms: 1 })
    lv.feed('out', 'late\n')
    vi.advanceTimersByTime(1000)
    // (the runner publishes the final value itself; nothing after the end)
    expect((noteRun(path).ctx.logs.value as { lines: string[] }).lines).toEqual(['a', 'b'])
  })
  it('no final value (the run never ended well): what came stays, as partial', () => {
    const lv = liveValue(path, 'tail', 'k2')
    lv.feed('out', 'x\n')
    vi.advanceTimersByTime(300)
    lv.end(undefined)
    const item = noteRun(path).ctx.tail
    expect(item.running).toBeUndefined()
    expect(item.partial).toBe(true)
    expect((item.value as { lines: string[]; running?: boolean }).running).toBeUndefined()
  })
})
