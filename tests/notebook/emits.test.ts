import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPart, BatchOrder, EMIT_BATCH_SIZE, EMIT_FLUSH_MS, EMIT_VAR_MAX, keepOf, keptOf, startValue, type EmitBatch } from '../../src/notebook/domain/emits'
import { Emitter } from '../../src/main/runner/emitter'
import { plain } from '../../src/main/runner/loopCore'
import { parseInfo, infoMd } from '../../src/notebook/domain/blockInfo'
import { parseLoopInfo, loopOpenMd } from '../../src/notebook/domain/loop'

describe('gathered values: the model', () => {
  it('starts anew — or (keep) from the last run, its last N, when it fits the way', () => {
    expect(startValue('append', [1, 2, 3])).toEqual([])
    expect(startValue('append', [1, 2, 3], 2)).toEqual([2, 3])
    expect(startValue('text', 'a\nb\nc', 2)).toBe('b\nc')
    expect(startValue('merge', { a: 1 }, 5)).toEqual({ a: 1 })
    // (the last value of another shape — anew)
    expect(startValue('append', 'текст', 5)).toEqual([])
    expect(startValue('text', [1], 5)).toBe('')
  })
  it('a part added: a list in place, a text longer, an object merged; kept to N at the end', () => {
    const list: unknown[] = []
    expect(addPart(list, 'append', 1)).toBe(list)
    expect(list).toEqual([1])
    expect(addPart('ab', 'text', 'c')).toBe('abc')
    expect(addPart({ a: 1, b: 1 }, 'merge', { b: 2 })).toEqual({ a: 1, b: 2 })
    expect(keptOf([1, 2, 3, 4], 'append', 2)).toEqual([3, 4])
    expect(keptOf([1, 2, 3, 4], 'append', undefined)).toEqual([1, 2, 3, 4])
  })
  it('batches in their order: an early one waits, none twice', () => {
    const o = new BatchOrder()
    const b = (seq: number): EmitBatch => ({ seq, parts: [] })
    expect(o.push(b(2))).toEqual([])
    expect(o.push(b(3))).toEqual([])
    expect(o.push(b(1)).map((x) => x.seq)).toEqual([1, 2, 3])
    expect(o.push(b(2))).toEqual([])
    expect(o.done).toBe(3)
    expect(o.push(b(5))).toEqual([])
    expect(o.done).toBe(3)
  })
  it('keep=N written and read: a block and a loop', () => {
    expect(parseInfo('js run name=x keep=30').keep).toBe(30)
    expect(parseInfo('js run keep=0').keep).toBeUndefined()
    expect(infoMd(parseInfo('js run name=x keep=30'))).toBe('js run name=x keep=30')
    expect(parseLoopInfo('name=p keep=5').keep).toBe(5)
    expect(loopOpenMd(parseLoopInfo('name=p keep=5'))).toBe('<!-- qa:loop name=p keep=5 -->')
    expect(keepOf('999999')).toBe(100_000)
  })
})

describe('gathered values: sent from a run', () => {
  let sent: EmitBatch[]
  let out: Emitter
  beforeEach(() => {
    vi.useFakeTimers()
    sent = []
    out = new Emitter((b) => sent.push(structuredClone(b)), plain)
  })
  afterEach(() => vi.useRealTimers())

  it('a thousand parts in a moment — a few batches, numbered, nothing lost, in order', () => {
    for (let i = 0; i < 1000; i++) out.emit('rows', { i })
    out.emit.text('log', 'a')
    out.emit.text('log', 'b')
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(EMIT_FLUSH_MS)
    expect(sent).toHaveLength(1)
    expect(sent[0].seq).toBe(1)
    expect(sent[0].parts.filter((p) => p.name === 'rows').map((p) => (p.value as { i: number }).i)).toEqual([...Array(1000).keys()])
    expect(out.close()).toBe(1)
  })
  it('a big part goes at once; close sends what is left and says how many batches', () => {
    out.emit.text('big', 'x'.repeat(EMIT_BATCH_SIZE))
    expect(sent.map((b) => b.seq)).toEqual([1])
    out.emit('small', 1)
    expect(out.close()).toBe(2)
    expect(sent.map((b) => b.seq)).toEqual([1, 2])
    // (after the end — a timer of the code left behind: nothing goes)
    out.emit('small', 2)
    vi.advanceTimersByTime(EMIT_FLUSH_MS * 2)
    expect(sent).toHaveLength(2)
  })
  it('a part is copied when put (changed later in the code — not what was sent)', () => {
    const o = { n: 1 }
    out.emit('x', o)
    o.n = 2
    out.close()
    expect(sent[0].parts[0].value).toEqual({ n: 1 })
  })
  it('one way per name; not a name, not an object for merge, past the limit — errors at once', () => {
    out.emit('x', 1)
    expect(() => out.emit.text('x', 'a')).toThrow('уже накапливается через emit')
    expect(() => out.emit('1bad', 1)).toThrow('не имя переменной')
    expect(() => out.emit.merge('m', [1])).toThrow('нужен объект')
    const chunk = 'x'.repeat(4 * 1024 * 1024)
    for (let i = 0; i < EMIT_VAR_MAX / chunk.length; i++) out.emit.text('huge', chunk)
    expect(() => out.emit.text('huge', 'x')).toThrow('переполнение')
  })
})
