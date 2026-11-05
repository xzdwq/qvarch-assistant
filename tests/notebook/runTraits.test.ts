import { describe, expect, it, vi } from 'vitest'
import type { QaApi } from '../../src/shared/api'
import { parseInfo } from '../../src/notebook/domain/blockInfo'
import { findLoops } from '../../src/notebook/domain/loop'
import { dataValueOf } from '../../src/notebook/blocks/data/model'
import { runnableSpec } from '../../src/notebook/blocks/specs'
import { setRunApi } from '../../src/notebook/engine/runApi'
import { NoteEnv, PassEnv } from '../../src/notebook/engine/runEnv'
import { loopGoesSerial } from '../../src/notebook/engine/runItems'
import { runBlockAt } from '../../src/notebook/engine/runNote'
import { noteRun, publishGathered } from '../../src/notebook/engine/runStore'
import { syncNoteData, syncTemplates } from '../../src/notebook/engine/unrunValues'

/** What the run engine reads from the kinds' specs and envs instead of their names; a block's late answer dropped. */

const fence = (info: string, ...body: string[]) => ['```' + info, ...body, '```']
const note = (...parts: string[][]) => parts.flat().join('\n')
let seq = 0
const fresh = () => `traits/note${++seq}.md`

describe('run traits from the specs', () => {
  it('a loop goes pass by pass when a block whose files are its own is inside it', () => {
    const loop = (...inner: string[][]) => note(['<!-- qa:loop name=l parallel=4 -->'], fence('js loop', 'await body({})'), ...inner, ['<!-- /qa:loop -->'])
    const withPw = loop(fence('ts playwright name=s', 'await page.goto("x")'))
    const withCode = loop(fence('js run name=c', 'return 1'))
    expect(loopGoesSerial(withPw, findLoops(withPw.split('\n'))[0])).toBe(true)
    expect(loopGoesSerial(withCode, findLoops(withCode.split('\n'))[0])).toBe(false)
    expect(runnableSpec('pw').test).toBeTruthy()
    expect(runnableSpec('http').test).toBe(false)
  })
  it('a data block gives its value as it parses — or why not', () => {
    expect(dataValueOf('json', '[1,2]')).toEqual({ value: [1, 2] })
    expect(dataValueOf('yaml', 'a: 1')).toEqual({ value: { a: 1 } })
    expect(dataValueOf('json', '')).toEqual({ value: null })
    expect(dataValueOf('json', '{')).toHaveProperty('error')
  })
  it('data and templates published with no run; a template in a loop — not (its passes fill it)', () => {
    const path = fresh()
    const text = note(
      fence('json name=cfg', '{"who":"Ann"}'),
      fence('md template name=hi', 'Hi {{cfg.who}}'),
      ['<!-- qa:loop name=l -->'],
      fence('js loop', 'await body({ i: 1 })'),
      fence('md template name=inner', 'Pass {{cfg.who}}'),
      ['<!-- /qa:loop -->'],
    )
    syncNoteData(path, text)
    syncTemplates(path, text)
    const ctx = noteRun(path).ctx
    expect(ctx.cfg.value).toEqual({ who: 'Ann' })
    expect(ctx.cfg.from).toBe('data')
    expect(ctx.hi.value).toBe('Hi Ann')
    expect(ctx.hi.from).toBe('tpl')
    expect(ctx.inner).toBeUndefined()
  })
})

describe('run envs', () => {
  it('a pass knows its number; a value is partial by where it is seen', () => {
    const path = fresh()
    const env = new NoteEnv(path)
    publishGathered(path, 'rows', [1], 'code', 'c', true)
    expect(env.passNumber).toBeUndefined()
    expect(env.isPartial('rows')).toBe(true)
    const pass = { n: 3, vars: { rows: [9] }, state: 'run' as const, at: 1, values: {} }
    const lr = { state: 'run' as const, at: 1, passes: [pass] }
    const pe = new PassEnv(env, 'l', pass, true, lr)
    expect(pe.passNumber).toBe(3)
    // (the pass was given its own `rows`: whole)
    expect(pe.isPartial('rows')).toBe(false)
    expect(new PassEnv(env, 'l', { ...pass, vars: {} }, true, lr).isPartial('rows')).toBe(true)
  })
})

describe('a block run again before its first run answered', () => {
  it('code: the first answer is dropped — never written over the second', async () => {
    let release!: () => void
    const slow = new Promise<void>((r) => (release = r))
    let call = 0
    const qa = {
      runLoad: vi.fn(async () => undefined),
      runSave: vi.fn(async () => undefined),
      onRunEmit: vi.fn(() => () => undefined),
      runCode: vi.fn(async (): ReturnType<QaApi['runCode']> => {
        const my = ++call
        if (my === 1) await slow
        return { ok: my !== 1, value: my, hasValue: true, logs: [], ms: 1, ...(my === 1 ? { error: 'Остановлено' } : {}) }
      }),
    }
    setRunApi(qa as unknown as Parameters<typeof setRunApi>[0])
    const path = fresh()
    const block = { kind: 'code' as const, info: parseInfo('js run name=c'), body: 'return 1', line: 1 }
    const first = runBlockAt(path, '', block)
    const second = await runBlockAt(path, '', block)
    release()
    expect(second).toBe(true)
    expect(await first).toBe(false)
    const n = noteRun(path)
    expect(n.runs.c.state).toBe('ok')
    expect(n.ctx.c.value).toBe(2)
    setRunApi(undefined)
  })
})
