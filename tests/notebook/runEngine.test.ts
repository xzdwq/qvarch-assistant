import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QaApi } from '../../src/shared/api'
import type { HttpRunResult } from '../../src/shared/http'
import * as engine from '../../src/notebook/engine'
import { setRunApi } from '../../src/notebook/engine/runApi'
import { parseInfo } from '../../src/notebook/domain/blockInfo'
import type { EmitBatch, EmitMode } from '../../src/notebook/domain/emits'

/**
 * A stand-in for `window.qa` (the preload bridge): every run channel answers from a handler a test may replace;
 * the loop channel drives passes like the main process does (one after another).
 */
type Handlers = {
  httpRun: QaApi['httpRun']
  sql: (m: string, ...a: unknown[]) => Promise<unknown>
  runCode: QaApi['runCode']
  runPw: QaApi['runPw']
  /** The passes a loop's head asks for (their vars, in order); undefined — the loop's head fails. */
  loopPasses: (runId: string) => Array<Record<string, unknown>> | undefined
  runLoad: QaApi['runLoad']
}
function okHttp(url: string, body: string, status = 200): HttpRunResult {
  return { response: { status, statusText: status === 200 ? 'OK' : 'ERR', headers: [['Content-Type', 'application/json']], body, time: 5, size: body.length, url }, hasResult: false, logs: [], vars: {}, chain: [] }
}
function makeFakeQa() {
  let passCb: ((runId: string, n: number, vars: Record<string, unknown>) => void) | undefined
  let emitCb: ((runId: string, batch: EmitBatch) => void) | undefined
  const passWaiters = new Map<string, (r: unknown) => void>()
  const h: Handlers = {
    httpRun: async (req) => okHttp(req.url, '{"id":7}'),
    sql: async (m) => (m === 'conns' ? [{ name: 'main', kind: 'pg' }] : m === 'run' ? { ok: true, ms: 3, run: { result: { columns: [{ name: 'id' }], rows: [[7]], more: false, ms: 3 } } } : undefined),
    runCode: async () => ({ ok: true, value: 42, hasValue: true, logs: [], ms: 1 }),
    runPw: async () => ({ ok: true, value: 'title', hasValue: true, logs: [], ms: 2, steps: [], files: [] }),
    loopPasses: () => [],
    runLoad: async () => undefined,
  }
  const qa = {
    runLoad: vi.fn((p: string) => h.runLoad(p)),
    runSave: vi.fn(async (_path: string, _json: string) => undefined),
    httpLoad: vi.fn(async () => ({ items: [], vars: [] })),
    httpRun: vi.fn((req: Parameters<QaApi['httpRun']>[0], doc: Parameters<QaApi['httpRun']>[1], runId?: string) => h.httpRun(req, doc, runId)),
    httpAbort: vi.fn(async (_runId: string) => undefined),
    sql: vi.fn((m: string, ...a: unknown[]) => h.sql(m, ...a)),
    runCode: vi.fn((runId: string, job: Parameters<QaApi['runCode']>[1]) => h.runCode(runId, job)),
    runCodeStop: vi.fn((_runId: string) => undefined),
    runPw: vi.fn((runId: string, job: Parameters<QaApi['runPw']>[1]) => h.runPw(runId, job)),
    runPwStop: vi.fn((_runId: string) => undefined),
    onPwProgress: vi.fn(() => () => undefined),
    onLoopPass: vi.fn((cb: typeof passCb) => {
      passCb = cb
      return () => undefined
    }),
    // (a file «written»: its hash — the value and the mark; the same as the last — unchanged)
    valueFile: vi.fn(async (_m: string, job: { name: string; value: unknown; partial: boolean; lastHash?: string; format: string }) => {
      const hash = `${job.format}|${job.partial}|${JSON.stringify(job.value)}`
      return job.lastHash === hash ? { hash, unchanged: true } : { file: `C:\\exports\\${job.name}${job.partial ? ' (частично)' : ''}.${job.format}`, hash }
    }),
    onRunEmit: vi.fn((cb: typeof emitCb) => {
      emitCb = cb
      return () => undefined
    }),
    runLoopPass: vi.fn((runId: string, n: number, r: unknown) => passWaiters.get(`${runId}|${n}`)?.(r)),
    runLoopStop: vi.fn((_runId: string) => undefined),
    runLoop: vi.fn(async (runId: string, _job: Parameters<QaApi['runLoop']>[1]) => {
      const passes = h.loopPasses(runId)
      if (!passes) return { ok: false, error: 'head failed', logs: [], passes: 0, ms: 1 }
      for (const [i, vars] of passes.entries()) {
        const n = i + 1
        const done = new Promise((r) => passWaiters.set(`${runId}|${n}`, r))
        passCb?.(runId, n, vars)
        await done
      }
      return { ok: true, logs: [], passes: passes.length, ms: 1 }
    }),
  }
  /** A run's emit() batch, as main sends it. */
  const sendEmit = (runId: string, batch: EmitBatch) => emitCb?.(runId, batch)
  return { qa, h, sendEmit }
}

/**
 * The run engine's behaviour (characterization): «Выполнить всё», what blocks publish, soft errors, loops and
 * their passes, run ids, stale answers, loading saved runs, reports. Written against the engine before the
 * refactor; the refactored engine must pass it unchanged.
 */
const { qa, h, sendEmit } = makeFakeQa()
setRunApi(qa as unknown as Parameters<typeof setRunApi>[0])

/** The engine as the app uses it (and a request run where it stands — the stale-answer case). */
const E = {
  ...engine,
  runHttp: (path: string, _key: string, name: string, body: string) => engine.runBlockAt(path, '', { kind: 'http', info: parseInfo(`http name=${name}`), body, line: 1 }),
}
beforeEach(() => {
  vi.clearAllMocks()
})
const fence = (info: string, ...body: string[]) => ['```' + info, ...body, '```']
const note = (...parts: string[][]) => parts.flat().join('\n')
let seq = 0
const fresh = () => `t/note${++seq}.md`
async function loaded(path: string) {
  const n = E.noteRun(path)
  for (let i = 0; i < 50 && !n.loaded; i++) await new Promise((r) => setTimeout(r, 1))
  return n
}

describe('run engine: «Выполнить всё»', () => {
  const TEXT = note(
    fence('json name=cfg', '{"base":"https://x.test"}'),
    fence('http name=user', 'GET {{cfg.base}}/u'),
    fence('ts run name=total', 'return 1'),
    fence('md template name=msg', 'Status {{user.status}}'),
    fence('sql db=main name=rows', 'select * from t where id = {{user.body.id}}'),
    fence('ts playwright name=shot', 'await page.goto(cfg.base)'),
  )
  it('runs every block in order and publishes what each gives', async () => {
    const path = fresh()
    await loaded(path)
    h.runCode = async () => ({ ok: true, value: 42, hasValue: true, sets: { extra: 1 }, logs: [], ms: 1 })
    await E.runAll(path, TEXT)
    const n = E.noteRun(path)
    expect(n.all).toBeUndefined()
    const vals = Object.fromEntries(Object.entries(n.ctx).map(([k, v]) => [k, v.value]))
    expect(vals).toMatchObject({ cfg: { base: 'https://x.test' }, total: 42, extra: 1, msg: 'Status 200', rows: [{ id: 7 }], shot: 'title' })
    expect((vals.user as { body: unknown }).body).toEqual({ id: 7 })
    expect(Object.fromEntries(Object.entries(n.ctx).map(([k, v]) => [k, `${v.from}:${v.block}`]))).toEqual({ trigger: 'run:trigger', cfg: 'data:cfg', user: 'http:user', total: 'code:total', extra: 'set:total', msg: 'tpl:msg', rows: 'sql:rows', shot: 'pw:shot' })
    expect(Object.fromEntries(Object.entries(n.runs).map(([k, r]) => [k, r.state]))).toEqual({ user: 'ok', total: 'ok', msg: 'ok', rows: 'ok', shot: 'ok' })
    // the request with its templates filled, the run ids as the main process sees them
    expect(qa.httpRun.mock.calls[0][0].url).toBe('https://x.test/u')
    expect(qa.httpRun.mock.calls[0][2]).toMatch(new RegExp(`^${path}#user#\\d+$`))
    expect(qa.runCode.mock.calls[0][0]).toBe(`${path}#total`)
    const sqlRun = qa.sql.mock.calls.find((c) => c[0] === 'run')!
    expect(sqlRun.slice(2)).toEqual(['main', 'select * from t where id = $1', [7], 'run'])
    expect(sqlRun[1]).toMatch(new RegExp(`^${path}#rows#\\d+$`))
    const pw = qa.runPw.mock.calls[0]
    expect(pw[0]).toBe(`${path}#shot`)
    expect(pw[1]).toMatchObject({ note: path, key: 'shot', name: 'shot', browser: 'msedge', headed: false, trace: true, session: false, ts: true })
    // `runs` given to code: the other runnable blocks (not itself), their state
    const runs = qa.runCode.mock.calls[0][1].runs as Record<string, { kind: string; state: string }>
    expect(Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, `${r.kind}:${r.state}`]))).toEqual({ user: 'http:ok', msg: 'tpl:none', rows: 'sql:none', shot: 'pw:none' })
  })
  it('a «soft» failure goes on, the first hard one stops the run', async () => {
    const path = fresh()
    await loaded(path)
    const t = note(fence('js run name=a soft', '1'), fence('js run name=b', '2'), fence('js run name=c', '3'))
    h.runCode = async (_id, job) => (job.code === '3' ? { ok: true, value: 3, hasValue: true, logs: [], ms: 1 } : { ok: false, error: `boom ${job.code}`, logs: [], ms: 1 })
    await E.runAll(path, t)
    const n = E.noteRun(path)
    expect(n.all).toEqual({ at: 'b', done: 1, total: 3, error: 'boom 2' })
    expect(n.runs.a.state).toBe('error')
    expect(n.runs.c).toBeUndefined()
  })
  it('an unnamed block is kept as _<kind><line>; lib blocks never run alone', async () => {
    const path = fresh()
    await loaded(path)
    h.runCode = async () => ({ ok: true, value: 1, hasValue: true, logs: [], ms: 1 })
    await E.runAll(path, note(fence('ts lib', 'const f = 1'), fence('js run', 'return f')))
    expect(Object.keys(E.noteRun(path).runs)).toEqual(['_code4'])
    expect(qa.runCode.mock.calls[0][1].libs).toEqual([{ code: 'const f = 1', ts: true }])
  })
})

describe('run engine: what started a run, a text sent into the chat', () => {
  const ROOM = '0f8a3c2e-1b7d-4e5f-9a6b-2c3d4e5f6a7b'
  const sent: Array<[string, string]> = []
  engine.setChatSend((room, text) => (sent.push([room, text]), true))
  beforeEach(() => void (sent.length = 0))
  const withChat = (...parts: string[][]) => note(['```chat', `room: ${ROOM}`, '```'], ...parts)

  it('«Выполнить всё» gives {{trigger}}: by hand unless told; a template sees it', async () => {
    const path = fresh()
    await loaded(path)
    await E.runAll(path, note(fence('md template name=msg', 'by {{trigger.by}}')))
    expect(E.noteRun(path).ctx.msg.value).toBe('by hand')
    await E.runAll(path, note(fence('md template name=msg', 'by {{trigger.by}} «{{trigger.cron.title}}»')), { by: 'cron', at: 1, cron: { id: 'j', title: 'Утро', expr: '0 9 * * *' } })
    expect(E.noteRun(path).ctx.msg.value).toBe('by cron «Утро»')
    expect(E.noteRun(path).ctx.trigger.from).toBe('run')
  })
  it('a template with `chat` sends its text into the note\'s chat — a scheduled one marked', async () => {
    const path = fresh()
    await loaded(path)
    const text = withChat(fence('md template name=msg chat', '@ИИ · Я сводка на {{trigger.by}}'))
    await E.runAll(path, text)
    expect(sent).toEqual([[ROOM, '@ИИ · Я сводка на hand']])
    await E.runAll(path, text, { by: 'cron', at: 1, cron: { id: 'j', title: 'Утро', expr: '0 9 * * *' } })
    expect(sent[1]).toEqual([ROOM, '@ИИ · Я сводка на cron\n\n_⏰ по расписанию «Утро» (0 9 * * *)_'])
  })
  it('no chat in the note — the template fails, saying why; without `chat` nothing is sent', async () => {
    const path = fresh()
    await loaded(path)
    await E.runAll(path, note(fence('md template name=msg chat', 'привет')))
    expect(E.noteRun(path).runs.msg).toMatchObject({ state: 'error' })
    expect(E.noteRun(path).runs.msg.error).toContain('нет чата')
    await E.runAll(path, withChat(fence('md template name=msg', 'привет')))
    expect(sent).toEqual([])
  })
})

describe('run engine: values gathered as a run goes (emit)', () => {
  const part = (name: string, value: unknown, mode: EmitMode = 'append') => ({ name, mode, value })
  /** Code that sends these batches (in this order) and then ends, saying how many it sent. */
  const emitting = (batches: EmitBatch[], end: { ok?: boolean; sent?: number } = {}) =>
    (h.runCode = async (runId) => {
      for (const b of batches) {
        sendEmit(runId, b)
        await new Promise((r) => setTimeout(r, 1))
      }
      return { ok: end.ok ?? true, ...(end.ok === false ? { error: 'boom' } : {}), logs: [], ms: 1, emits: end.sent ?? batches.length }
    })

  it('a list grows as the batches come; a text, an object too; batches out of order put in order', async () => {
    const path = fresh()
    await loaded(path)
    const seen: number[] = []
    h.runCode = async (runId) => {
      sendEmit(runId, { seq: 2, parts: [part('rows', 3), part('log', 'c', 'text')] })
      sendEmit(runId, { seq: 1, parts: [part('rows', 1), part('rows', 2), part('log', 'ab', 'text'), part('meta', { a: 1 }, 'merge')] })
      seen.push((E.noteRun(path).ctx.rows.value as unknown[]).length)
      sendEmit(runId, { seq: 3, parts: [part('meta', { b: 2 }, 'merge')] })
      return { ok: true, logs: [], ms: 1, emits: 3 }
    }
    await E.runAll(path, note(fence('js run name=x', '1')))
    const n = E.noteRun(path)
    expect(seen).toEqual([3])
    expect(n.ctx.rows.value).toEqual([1, 2, 3])
    expect(n.ctx.log.value).toBe('abc')
    expect(n.ctx.meta.value).toEqual({ a: 1, b: 2 })
    expect(n.ctx.rows.partial).toBeUndefined()
    expect(n.runs.x.state).toBe('ok')
  })
  it('what is shown is a new value on every show — the one a block holds never changes under it (else it is not seen to change)', async () => {
    const path = fresh()
    await loaded(path)
    const shown: unknown[][] = []
    h.runCode = async (runId) => {
      sendEmit(runId, { seq: 1, parts: [part('rows', 1)] })
      shown.push(E.noteRun(path).ctx.rows.value as unknown[])
      await new Promise((r) => setTimeout(r, 70))
      sendEmit(runId, { seq: 2, parts: [part('rows', 2)] })
      await new Promise((r) => setTimeout(r, 70))
      shown.push(E.noteRun(path).ctx.rows.value as unknown[])
      // (batches sooner than a show may come — the last one still shown, a moment later)
      sendEmit(runId, { seq: 3, parts: [part('rows', 3)] })
      sendEmit(runId, { seq: 4, parts: [part('rows', 4)] })
      await new Promise((r) => setTimeout(r, 120))
      shown.push(E.noteRun(path).ctx.rows.value as unknown[])
      return { ok: true, logs: [], ms: 1, emits: 4 }
    }
    await E.runAll(path, note(fence('js run name=x', '1')))
    expect(shown[0]).not.toBe(shown[1])
    expect(shown[0]).toEqual([1])
    expect(shown[1]).toEqual([1, 2])
    expect(shown[2]).toEqual([1, 2, 3, 4])
    expect(E.noteRun(path).ctx.rows.value).toEqual([1, 2, 3, 4])
  })
  it('a variable cleared — gone; one gathered with keep starts its history anew', async () => {
    const path = fresh()
    await loaded(path)
    emitting([{ seq: 1, parts: [part('rows', 1)] }])
    const kept = note(fence('js run name=x keep=5', '1'))
    await E.runAll(path, kept)
    await E.runAll(path, kept)
    expect(E.noteRun(path).ctx.rows.value).toEqual([1, 1])
    E.clearValue(path, 'rows')
    expect(E.noteRun(path).ctx.rows).toBeUndefined()
    await E.runAll(path, kept)
    expect(E.noteRun(path).ctx.rows.value).toEqual([1])
  })
  it('a batch lost on its way — the run fails saying so, what came kept and marked partial', async () => {
    const path = fresh()
    await loaded(path)
    emitting([{ seq: 1, parts: [part('rows', 1)] }, { seq: 3, parts: [part('rows', 3)] }], { sent: 3 })
    await E.runAll(path, note(fence('js run name=x', '1')))
    const n = E.noteRun(path)
    expect(n.runs.x.state).toBe('error')
    expect(n.runs.x.error).toContain('потеряны порции emit: дошло 1 из 3')
    expect(n.ctx.rows).toMatchObject({ value: [1], partial: true })
  })
  it('a run failed (or stopped) — what came kept, marked partial', async () => {
    const path = fresh()
    await loaded(path)
    emitting([{ seq: 1, parts: [part('rows', 1)] }], { ok: false })
    await E.runAll(path, note(fence('js run name=x', '1')))
    expect(E.noteRun(path).ctx.rows).toMatchObject({ value: [1], partial: true })
  })
  it('every run starts anew; keep=N — goes on from the last run, its last N', async () => {
    const path = fresh()
    await loaded(path)
    emitting([{ seq: 1, parts: [part('rows', 1), part('rows', 2)] }])
    await E.runAll(path, note(fence('js run name=x', '1')))
    await E.runAll(path, note(fence('js run name=x', '1')))
    expect(E.noteRun(path).ctx.rows.value).toEqual([1, 2])
    const kept = note(fence('js run name=x keep=3', '1'))
    await E.runAll(path, kept)
    await E.runAll(path, kept)
    expect(E.noteRun(path).ctx.rows.value).toEqual([2, 1, 2])
  })
  it('two blocks of one run add to one variable; another way into it — the run says so', async () => {
    const path = fresh()
    await loaded(path)
    h.runCode = async (runId, job) => {
      sendEmit(runId, { seq: 1, parts: [part('rows', job.code === '1' ? 'a' : 'b', job.code === '3' ? 'text' : 'append')] })
      return { ok: true, logs: [], ms: 1, emits: 1 }
    }
    await E.runAll(path, note(fence('js run name=x', '1'), fence('js run name=y', '2')))
    expect(E.noteRun(path).ctx.rows.value).toEqual(['a', 'b'])
    await E.runAll(path, note(fence('js run name=x', '1'), fence('js run name=z soft', '3')))
    expect(E.noteRun(path).runs.z.error).toContain('уже накапливается другим способом')
    expect(E.noteRun(path).ctx.rows.value).toEqual(['a'])
  })
  it('a loop\'s passes in parallel add to one variable — none lost', async () => {
    const path = fresh()
    await loaded(path)
    const text = note(['<!-- qa:loop name=passes parallel=4 -->'], fence('js loop', 'await Promise.all(items.map((i) => body({ i })))'), fence('js run name=calc', 'return i'), ['<!-- /qa:loop -->'])
    h.loopPasses = () => Array.from({ length: 8 }, (_, i) => ({ i }))
    h.runCode = async (runId, job) => {
      const i = job.ctx.i as number
      sendEmit(runId, { seq: 1, parts: [part('seen', i)] })
      await new Promise((r) => setTimeout(r, 8 - i))
      sendEmit(runId, { seq: 2, parts: [part('seen', i * 10)] })
      return { ok: true, value: i, hasValue: true, logs: [], ms: 1, emits: 2 }
    }
    await E.runAll(path, text)
    const seen = E.noteRun(path).ctx.seen.value as number[]
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7, 10, 20, 30, 40, 50, 60, 70])
  })
})

describe('run engine: a value kept as a file each run (save)', () => {
  const save = (body: string) => ['```save', body, '```']
  it('a new file when the value changed; the same — not written; empty, missing — said', async () => {
    const path = fresh()
    await loaded(path)
    let rows: unknown = [{ id: 1 }]
    h.runCode = async () => ({ ok: true, value: rows, hasValue: true, logs: [], ms: 1 })
    const text = note(fence('js run name=rows', '1'), save('ref: rows'))
    await E.runAll(path, text)
    const first = E.noteRun(path).runs._save4.saved
    expect(first).toMatchObject({ file: 'C:\\exports\\rows.xlsx' })
    expect(qa.valueFile.mock.calls[0][1]).toMatchObject({ note: path.replace(/\.md$/, '').split('/').pop(), name: 'rows', format: 'xlsx', partial: false })
    await E.runAll(path, text)
    expect(E.noteRun(path).runs._save4.saved).toMatchObject({ unchanged: true, file: 'C:\\exports\\rows.xlsx' })
    rows = []
    await E.runAll(path, text)
    expect(E.noteRun(path).runs._save4).toMatchObject({ state: 'ok', saved: { skipped: 'пусто — файл не записан' } })
    await E.runAll(path, note(save('ref: nothing')))
    expect(E.noteRun(path).runs._save1).toMatchObject({ state: 'error' })
    expect(E.noteRun(path).runs._save1.error).toContain('Нет значения {{nothing}}')
  })
  it('a partial value: saved with a mark — or skipped (partial: skip)', async () => {
    const path = fresh()
    await loaded(path)
    h.runCode = async (runId) => {
      sendEmit(runId, { seq: 1, parts: [{ name: 'got', mode: 'append', value: 1 }] })
      return { ok: false, error: 'стоп', logs: [], ms: 1, emits: 1 }
    }
    await E.runAll(path, note(fence('js run name=x soft', '1'), save('ref: got\nformat: json')))
    expect(E.noteRun(path).runs._save4.saved?.file).toBe('C:\\exports\\got (частично).json')
    await E.runAll(path, note(fence('js run name=x soft', '1'), save('ref: got\npartial: skip')))
    expect(E.noteRun(path).runs._save4.saved?.skipped).toContain('неполные')
  })
})

describe('run engine: loops', () => {
  const TEXT = note(
    fence('json name=users', '[{"id":1},{"id":2}]'),
    ['<!-- qa:loop name=passes -->'],
    fence('js loop', 'for (const u of users) await body({ u })'),
    fence('http name=user', 'GET https://x.test/u/{{u.id}}'),
    fence('js run name=calc', 'return u.id * 10'),
    ['<!-- /qa:loop -->'],
  )
  it('runs the blocks once per pass; their names become lists over the passes', async () => {
    const path = fresh()
    await loaded(path)
    h.loopPasses = () => [{ u: { id: 1 } }, { u: { id: 2 } }]
    h.runCode = async (_id, job) => ({ ok: true, value: (job.ctx.u as { id: number }).id * 10, hasValue: true, logs: [], ms: 1 })
    h.httpRun = async (req) => okHttp(req.url, `{"u":"${req.url.slice(-1)}"}`)
    await E.runAll(path, TEXT)
    const n = E.noteRun(path)
    expect(n.all).toBeUndefined()
    expect(n.ctx.calc.value).toEqual([10, 20])
    expect((n.ctx.user.value as Array<{ body: unknown }>).map((a) => a.body)).toEqual([{ u: '1' }, { u: '2' }])
    expect((n.ctx.passes.value as Array<Record<string, unknown>>).map((p) => [p.n, p.u, p.calc])).toEqual([
      [1, { id: 1 }, 10],
      [2, { id: 2 }, 20],
    ])
    expect(n.ctx.passes.from).toBe('loop')
    const lr = n.loops.passes
    expect(lr.state).toBe('ok')
    expect(lr.passes.map((p) => [p.n, p.state, p.values.calc])).toEqual([
      [1, 'ok', 10],
      [2, 'ok', 20],
    ])
    // a pass's run ids carry the loop and the pass
    expect(qa.runCode.mock.calls.map((c) => c[0])).toEqual([`${path}#calc@passes#1`, `${path}#calc@passes#2`])
    expect(qa.httpRun.mock.calls[1][2]).toMatch(new RegExp(`^${path}#user@passes#2#\\d+$`))
    // the head: its job, the passes answered with what they published
    expect(qa.runLoop.mock.calls[0][0]).toBe(`${path}#passes`)
    expect(qa.runLoop.mock.calls[0][1]).toMatchObject({ head: 'for (const u of users) await body({ u })', ts: false, parallel: 1, max: 1000, timeoutSec: 600 })
    expect(qa.runLoopPass.mock.calls.map((c) => [c[1], (c[2] as { ok: boolean }).ok])).toEqual([
      [1, true],
      [2, true],
    ])
    // the note's blocks show the latest pass
    expect(n.runs.calc.value).toBe(20)
  })
  it('a pause spaces the passes (the first at once); a stop ends the pause there and then', async () => {
    const path = fresh()
    await loaded(path)
    const paused = (p: string) => note(['<!-- qa:loop name=paced pause=' + p + ' -->'], fence('js loop', 'for (const i of [1, 2, 3]) await body({ i })'), fence('js run name=calc', 'return i'), ['<!-- /qa:loop -->'])
    h.loopPasses = () => [{ i: 1 }, { i: 2 }, { i: 3 }]
    const at: number[] = []
    h.runCode = async () => (at.push(Date.now()), { ok: true, value: 1, hasValue: true, logs: [], ms: 1 })
    const t0 = Date.now()
    await E.runAll(path, paused('0.15'))
    expect(at).toHaveLength(3)
    expect(at[0] - t0).toBeLessThan(100)
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(140)
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(140)
    // a long pause stopped: the loop ends at once, the pass after it never runs
    const path2 = fresh()
    await loaded(path2)
    at.length = 0
    const text = paused('30')
    const run = E.runAll(path2, text)
    await new Promise((r) => setTimeout(r, 80))
    const t1 = Date.now()
    E.stopRunAll(path2)
    await run
    expect(Date.now() - t1).toBeLessThan(1000)
    expect(at).toHaveLength(1)
    expect(E.noteRun(path2).loops.paced.passes[1]).toMatchObject({ state: 'error', error: 'Остановлено' })
  })
  it('a failing block fails its pass; the head failing fails the loop', async () => {
    const path = fresh()
    await loaded(path)
    h.loopPasses = () => [{ u: { id: 1 } }]
    h.runCode = async () => ({ ok: false, error: 'bad\nmore', logs: [], ms: 1 })
    h.httpRun = async (req) => okHttp(req.url, '{}')
    await E.runAll(path, TEXT)
    const lr = E.noteRun(path).loops.passes
    expect(lr.passes[0]).toMatchObject({ state: 'error', error: 'блок «calc»: bad' })
    expect(qa.runLoopPass.mock.calls[0][2]).toEqual({ ok: false, error: 'блок «calc»: bad' })
    const path2 = fresh()
    await loaded(path2)
    h.loopPasses = () => undefined
    await E.runAll(path2, TEXT)
    expect(E.noteRun(path2).loops.passes.state).toBe('error')
    expect(E.noteRun(path2).all?.error).toBe('head failed')
  })
})

describe('run engine: where a block stands', () => {
  const LOOP = (attrs: string) =>
    note(fence('json name=users', '[{"id":1},{"id":2}]'), [`<!-- qa:loop name=passes${attrs} -->`], fence('js loop', 'for (const u of users) await body({ u })'), fence('ts playwright name=shot', 'await page.goto(u.id)'), fence('js run name=calc', 'set("seen", u.id)'), ['<!-- /qa:loop -->'], fence('sql db=main name=rows', 'select 1'), fence('md template name=msg', 'x'))
  it('a block in a loop is stopped in the pass shown (its run id carries the pass)', async () => {
    const path = fresh()
    await loaded(path)
    const text = LOOP('')
    h.loopPasses = () => [{ u: { id: 1 } }, { u: { id: 2 } }]
    await E.runAll(path, text)
    engine.stopBlockAt(path, text, { kind: 'pw', info: parseInfo('ts playwright name=shot'), line: 8 })
    expect(qa.runPwStop).toHaveBeenCalledWith(`${path}#shot@passes#2`)
    expect(qa.runCodeStop).not.toHaveBeenCalled()
    engine.pickPass(path, 'passes', 0)
    engine.stopBlockAt(path, text, { kind: 'pw', info: parseInfo('ts playwright name=shot'), line: 8 })
    expect(qa.runPwStop).toHaveBeenLastCalledWith(`${path}#shot@passes#1`)
  })
  it('the values where a line stands: in a loop — the pass shown over the note', async () => {
    const path = fresh()
    await loaded(path)
    const text = LOOP('')
    h.loopPasses = () => [{ u: { id: 1 } }, { u: { id: 2 } }]
    await E.runAll(path, text)
    const inLoop = engine.envAtLine(path, 8, text).values()
    expect(inLoop).toMatchObject({ u: { id: 2 }, loop: { n: 2, index: 1 }, users: [{ id: 1 }, { id: 2 }] })
    expect(engine.envAtLine(path, 14, text).values()).not.toHaveProperty('u')
    const at = engine.envResolver(path, text)
    expect(at(8)).toBe(at(9))
  })
  it('set() of a pass reaches the note at once only when passes go one after another', async () => {
    h.loopPasses = () => [{ u: { id: 1 } }, { u: { id: 2 } }]
    h.runCode = async (_id, job) => ({ ok: true, logs: [], ms: 1, sets: { seen: (job.ctx.u as { id: number }).id } })
    const serial = fresh()
    await loaded(serial)
    const text = note(fence('json name=users', '[{"id":1},{"id":2}]'), ['<!-- qa:loop name=passes -->'], fence('js loop', 'x'), fence('js run name=calc', 'set()'), ['<!-- /qa:loop -->'])
    const seenDuring: unknown[] = []
    const orig = h.runCode
    h.runCode = async (id, job) => {
      seenDuring.push(engine.noteRun(serial).ctx.seen?.value)
      return orig(id, job)
    }
    await E.runAll(serial, text)
    expect(seenDuring).toEqual([undefined, 1])
    const parallel = fresh()
    await loaded(parallel)
    seenDuring.length = 0
    h.runCode = async (id, job) => {
      seenDuring.push(engine.noteRun(parallel).ctx.seen?.value)
      return orig(id, job)
    }
    await E.runAll(parallel, text.replace('name=passes', 'name=passes parallel=2'))
    expect(seenDuring).toEqual([undefined, undefined])
  })
  it('any runnable block or loop is found by its name (the AI tools)', () => {
    const text = LOOP('')
    expect(engine.runItemNamed(text, 'rows')?.kind).toBe('sql')
    expect(engine.runItemNamed(text, 'msg')?.kind).toBe('tpl')
    expect(engine.runItemNamed(text, 'passes')?.kind).toBe('loop')
    expect(engine.runItemNamed(text, 'shot')?.kind).toBe('pw')
    expect(engine.runItemNamed(text, 'nope')).toBeUndefined()
  })
})

describe('run engine: answers and saved runs', () => {
  it('a request run again before the first answer came: the old answer is dropped', async () => {
    const path = fresh()
    await loaded(path)
    let release!: () => void
    const slow = new Promise<void>((r) => (release = r))
    let call = 0
    h.httpRun = async (req) => {
      const my = ++call
      if (my === 1) await slow
      return okHttp(req.url, `{"call":${my}}`)
    }
    const first = E.runHttp(path, 'r', 'r', 'GET https://x.test/a')
    const second = await E.runHttp(path, 'r', 'r', 'GET https://x.test/a')
    release()
    expect(second).toBe(true)
    expect(await first).toBe(false)
    expect((E.noteRun(path).ctx.r.value as { body: unknown }).body).toEqual({ call: 2 })
  })
  it('saved runs load with what was going on marked as failed; a run going on wins', async () => {
    const path = fresh()
    h.runLoad = async () =>
      JSON.stringify({
        ctx: { a: { value: 1, at: 1, from: 'data', block: 'a' } },
        runs: { x: { state: 'run', at: 1 }, y: { state: 'ok', at: 1 } },
        loops: { l: { state: 'run', at: 1, passes: [{ n: 1, vars: {}, state: 'run', at: 1, values: {}, runs: { z: { state: 'run', at: 1 } } }] } },
      })
    const n = E.noteRun(path)
    n.runs.y = { state: 'run', at: 2 }
    await loaded(path)
    expect(n.ctx.a.value).toBe(1)
    expect(n.runs.x.state).toBe('error')
    expect(n.runs.y.state).toBe('run')
    expect(n.loops.l.state).toBe('error')
    expect(n.loops.l.passes[0].state).toBe('error')
    h.runLoad = async () => undefined
  })
  it('flushRuns writes the pending runs of a note as JSON', async () => {
    const path = fresh()
    await loaded(path)
    await E.runAll(path, note(fence('json name=d', '[1]'), fence('js run name=a', 'return 1')))
    await E.flushRuns()
    const saved = qa.runSave.mock.calls.find((c) => c[0] === path)
    expect(saved).toBeTruthy()
    expect(Object.keys(JSON.parse(saved![1] as string))).toEqual(['ctx', 'runs', 'loops'])
  })
})

describe('run engine: reports', () => {
  it('a block report per kind and the note report', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5))
    const path = fresh()
    await loaded(path)
    h.runCode = async () => ({ ok: true, value: { a: 1 }, hasValue: true, logs: [{ level: 'warn', text: 'careful' }], ms: 12 })
    h.runPw = async () => ({ ok: false, error: 'locator failed', logs: [], ms: 1500, steps: [{ name: 'open', depth: 0, start: 0, ms: 20, state: 'ok' }, { name: 'click', depth: 0, start: 1, state: 'error', error: 'timeout' }], files: ['trace.zip', 'failure.png'], browser: 'msedge' })
    h.httpRun = async (req) => okHttp(req.url, '{"id":7}')
    const text = note(
      ['# Проверка'],
      fence('http name=user', 'GET https://x.test/u'),
      fence('js run name=total', 'return 1'),
      fence('md template name=msg soft', 'Hi {{nope}}'),
      fence('sql db=main name=rows', 'select 1'),
      fence('ts playwright name=shot', 'x'),
    )
    // the template fails (no value) but is soft: the run goes on to the end
    await E.runAll(path, text)
    const norm = (s: string) => s.replace(/за \d+ мс/g, 'за N мс')
    expect(norm(E.noteReport(path, text))).toMatchSnapshot()
    for (const [key, kind, info, body] of [
      ['user', 'http', { lang: 'http', name: 'user', run: false, lib: false }, 'GET https://x.test/u'],
      ['total', 'code', { lang: 'js', name: 'total', run: true, lib: false }, 'return 1'],
      ['msg', 'tpl', { lang: 'md', name: 'msg', run: false, lib: false, template: true, soft: true }, 'Hi {{nope}}'],
      ['rows', 'sql', { lang: 'sql', name: 'rows', run: false, lib: false, db: 'main' }, 'select 1'],
      ['shot', 'pw', { lang: 'ts', name: 'shot', run: false, lib: false, pw: true }, 'x'],
    ] as const)
      expect(norm(E.blockReport(path, key, kind, info, body))).toMatchSnapshot(kind)
    vi.useRealTimers()
  })
})
