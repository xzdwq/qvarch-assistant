import { describe, expect, it } from 'vitest'
import { bodyVars, findLoops, loopAt, loopOpenMd, parseLoopInfo, parsePause, pauseMs, pauseText, LOOP_CLOSE_MD } from '../src/notebook/domain/loop'
import { findBlocks } from '../src/notebook/domain/findBlocks'
import { fenceKindOfInfoLine } from '../src/notebook/domain/findBlocks'
import { runLoopHead } from '../src/main/runner/loopCore'
import type { LoopJob, PassResult } from '../src/notebook/domain/loop'
import type { EmitBatch } from '../src/notebook/domain/emits'

const note = [
  '# Заметка',
  '<!-- qa:loop name=outer parallel=4 -->',
  '```js loop',
  'for (const u of users) await body({ u })',
  '```',
  '```http name=user',
  'GET https://example.com/u/{{u.id}}',
  '```',
  '<!-- qa:loop -->',
  '```ts loop',
  'for (const k in user.body) await body({ k })',
  '```',
  '```md template name=line',
  '{{k}}',
  '```',
  '<!-- /qa:loop -->',
  'текст в цикле',
  '<!-- /qa:loop -->',
  '```js',
  '<!-- qa:loop -->',
  '```',
]

describe('loop: the note', () => {
  it('finds loops, their heads, their ends, nesting (not inside other code)', () => {
    const ls = findLoops(note)
    expect(ls).toHaveLength(2)
    expect(ls[0]).toMatchObject({ key: 'outer', line0: 2, headEnd: 5, end: 18, depth: 0, head: 'for (const u of users) await body({ u })', ts: false })
    expect(ls[0].info).toMatchObject({ name: 'outer', parallel: 4, max: 1000 })
    expect(ls[1]).toMatchObject({ key: '_loop9', line0: 9, headEnd: 12, end: 16, depth: 1, parent: 'outer', ts: true })
    expect(loopAt(ls, 6)?.key).toBe('outer')
    expect(loopAt(ls, 13)?.key).toBe('_loop9')
    expect(loopAt(ls, 17)?.key).toBe('outer')
    expect(loopAt(ls, 4)).toBeUndefined()
    expect(loopAt(ls, 19)).toBeUndefined()
  })
  it('blocks: a start with its head, an end, a template', () => {
    const kinds = findBlocks(note).map((b) => `${b.kind}:${b.line0}-${b.line1}`)
    expect(kinds).toEqual(['loop:2-5', 'http:6-8', 'loop:9-12', 'tpl:13-15', 'loopEnd:16-16', 'loopEnd:18-18'])
    expect(fenceKindOfInfoLine('md template name=x')).toBe('tpl')
    expect(fenceKindOfInfoLine('md name=x')).toBeUndefined()
  })
  it('a start with no head; no end — no body', () => {
    const ls = findLoops(['<!-- qa:loop name=a -->', 'text'])
    expect(ls[0]).toMatchObject({ line0: 1, headEnd: 1, head: '' })
    expect(ls[0].end).toBeUndefined()
    expect(loopAt(ls, 2)).toBeUndefined()
  })
  it('a pause between passes: fixed or random within a range, written back', () => {
    expect(parsePause('5')).toEqual({ min: 5, max: 5 })
    expect(parsePause(' 8 - 2 ')).toEqual({ min: 2, max: 8 })
    expect(parsePause('0,5-1.5')).toEqual({ min: 0.5, max: 1.5 })
    expect(parsePause('99999')).toEqual({ min: 3600, max: 3600 })
    for (const bad of ['', '0', 'abc', '-3', '2-', '1-2-3']) expect(parsePause(bad)).toBeUndefined()
    expect(pauseMs({ min: 2, max: 8 }, () => 0)).toBe(2000)
    expect(pauseMs({ min: 2, max: 8 }, () => 0.5)).toBe(5000)
    expect(pauseMs({ min: 3, max: 3 }, () => 0.9)).toBe(3000)
    const info = parseLoopInfo('name=p pause=2-8')
    expect(info.pause).toEqual({ min: 2, max: 8 })
    expect(loopOpenMd(info)).toBe('<!-- qa:loop name=p pause=2-8 -->')
    expect(pauseText({ min: 0.5, max: 0.5 })).toBe('0.5')
  })
  it('settings: limits kept, written back', () => {
    expect(parseLoopInfo('parallel=99 max=0 timeout=5 soft name=1bad')).toEqual({ parallel: 16, max: 1000, timeout: 5, soft: true })
    expect(loopOpenMd({ name: 'p', parallel: 3, max: 50, timeout: 600 })).toBe('<!-- qa:loop name=p parallel=3 max=50 -->')
    expect(LOOP_CLOSE_MD).toBe('<!-- /qa:loop -->')
    expect(bodyVars('for (const [i, u] of xs.entries()) await body({ i, u, id: u.id })\nbody({page})')).toEqual(['i', 'u', 'id', 'page'])
  })
})

const job = (head: string, over: Partial<LoopJob> = {}): LoopJob => ({ head, ts: false, libs: [], ctx: { items: [1, 2, 3, 4, 5] }, parallel: 1, max: 1000, ...over })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('loop: the head', () => {
  it('for…of with await: passes one by one, in order; body() gives back what they published', async () => {
    const seen: number[] = []
    const r = await runLoopHead(job('const out = []\nfor (const x of items) { const v = await body({ x }); out.push(v.sq) }\nreturn out'), async (n, vars) => {
      seen.push(n)
      await wait(5)
      return { ok: true, values: { sq: (vars.x as number) ** 2 } }
    })
    expect(r).toMatchObject({ ok: true, value: [1, 4, 9, 16, 25], hasValue: true, passes: 5 })
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })
  it('the head\'s emit(): its parts sent in batches, their count in the result', async () => {
    const batches: EmitBatch[] = []
    const r = await runLoopHead(job('for (const x of items) { const v = await body({ x }); emit("sq", v.sq); emit.text("log", `${x};`) }'), async (_n, vars) => ({ ok: true, values: { sq: (vars.x as number) ** 2 } }), (b) => batches.push(b))
    expect(r).toMatchObject({ ok: true, emits: batches.length })
    const parts = batches.flatMap((b) => b.parts)
    expect(parts.filter((p) => p.name === 'sq').map((p) => p.value)).toEqual([1, 4, 9, 16, 25])
    expect(parts.filter((p) => p.name === 'log').map((p) => p.value).join('')).toBe('1;2;3;4;5;')
  })
  it('Promise.all: at most `parallel` passes at a time, results in order', async () => {
    let active = 0
    let most = 0
    const r = await runLoopHead(job('return (await Promise.all(items.map((x) => body({ x })))).map((v) => v.x)', { parallel: 2 }), async (_n, vars) => {
      most = Math.max(most, ++active)
      await wait(10)
      active--
      return { ok: true, values: { x: vars.x } }
    })
    expect(r.value).toEqual([1, 2, 3, 4, 5])
    expect(most).toBe(2)
  })
  it('for…in, Object.entries, while with a counter, break on an answer', async () => {
    const got: unknown[] = []
    const pass = async (_n: number, vars: Record<string, unknown>): Promise<PassResult> => (got.push(vars), { ok: true, values: { next: (vars.page as number) < 3 } })
    await runLoopHead(job('const o = { a: 1, b: 2 }\nfor (const k in o) await body({ k })\nfor (const [k, v] of Object.entries(o)) await body({ k, v })'), pass)
    expect(got).toEqual([{ k: 'a' }, { k: 'b' }, { k: 'a', v: 1 }, { k: 'b', v: 2 }])
    got.length = 0
    const r = await runLoopHead(job('let page = 1\nwhile (true) { const r = await body({ page }); if (!r.next) break; page++ }\nreturn page'), pass)
    expect(r.value).toBe(3)
    expect(got).toHaveLength(3)
  })
  it('a failed pass throws where awaited; try/catch keeps the loop going', async () => {
    const pass = async (n: number): Promise<PassResult> => (n === 2 ? { ok: false, error: 'блок «user»: 404' } : { ok: true, values: {} })
    const bad = await runLoopHead(job('for (const x of items) await body({ x })'), pass)
    expect(bad).toMatchObject({ ok: false, error: 'Проход 2: блок «user»: 404', passes: 2 })
    const caught = await runLoopHead(job('let e = 0\nfor (const x of items) { try { await body({ x }) } catch { e++ } }\nreturn e'), pass)
    expect(caught).toMatchObject({ ok: true, value: 1, passes: 5 })
  })
  it('forEach: not awaited (as in JS) — the loop still ends with its passes; a failure nobody looked at fails it', async () => {
    let done = 0
    const ok = await runLoopHead(job('items.forEach((x) => body({ x }))'), async () => (await wait(5), done++, { ok: true, values: {} }))
    expect(ok.ok).toBe(true)
    expect(done).toBe(5)
    const lost = await runLoopHead(job('items.forEach((x) => body({ x }))'), async (n) => (n === 3 ? { ok: false, error: 'нет' } : { ok: true, values: {} }))
    expect(lost.ok).toBe(false)
    expect(lost.error).toMatch(/^Проход 3: нет \(ошибка прохода не обработана/)
  })
  it('more than `max` passes — stopped, even when the head catches it', async () => {
    const r = await runLoopHead(job('let i = 0\nwhile (true) { try { await body({ i: i++ }) } catch (e) { if (i > 20) break } }', { max: 10 }), async () => ({ ok: true, values: {} }))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Больше 10 проходов/)
    expect(r.passes).toBe(10)
  })
  it('the head\'s own errors: a line, a wrong body() call, TypeScript', async () => {
    const r = await runLoopHead(job('const a = 1\nnope()'), async () => ({ ok: true, values: {} }))
    expect(r.error).toMatch(/nope is not defined \(строка 2\)/)
    const b = await runLoopHead(job('await body(5)'), async () => ({ ok: true, values: {} }))
    expect(b.error).toMatch(/передайте объект/)
    const t = await runLoopHead(job('const xs: number[] = items\nlet s: number = 0\nfor (const x of xs) s += ((await body({ x })) as { v: number }).v\nreturn s', { ts: true }), async (_n, v) => ({ ok: true, values: { v: v.x as number } }))
    expect(t).toMatchObject({ ok: true, value: 15 })
  })
  it('set() from the head; the values given are copies (a pass cannot change the head\'s objects)', async () => {
    const r = await runLoopHead(job('const o = { n: 1 }\nawait body({ o })\nset("total", o.n)'), async (_n, vars) => {
      ;(vars.o as { n: number }).n = 99
      return { ok: true, values: {} }
    })
    expect(r.sets).toEqual({ total: 1 })
  })
})

describe('loop: a failed head', () => {
  it('passes still waiting for their turn are not run', async () => {
    let ran = 0
    const r = await runLoopHead(job('await Promise.all(items.map((x) => body({ x })))', { parallel: 1 }), async (n) => (ran++, n === 1 ? { ok: false, error: 'нет' } : { ok: true, values: {} }))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/^Проход 1: нет/)
    expect(ran).toBe(1)
  })
})
