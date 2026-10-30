import vm from 'node:vm'
import { inspect } from 'node:util'
import { stripTypeScriptTypes } from 'node:module'
import type { LoopJob, LoopResult, PassResult } from '../../notebook/domain/loop'
import type { EmitBatch } from '../../notebook/domain/emits'
import { errorText } from './errorText'
import { Emitter } from './emitter'

/**
 * A loop's head run: plain JS (or TS) whose `body({ … })` makes a pass — the loop's blocks run with those values,
 * and what they published comes back (`const r = await body({ page }); if (!r.list.body.next) break`). It is JS as it
 * is: `await body()` in a for…of goes pass by pass, `Promise.all(xs.map((x) => body({ x })))` — at once (at most
 * `parallel` passes at a time, the rest wait their turn), a forEach does not wait (as in JS — the loop ends when its
 * passes do). A pass that failed throws where it is awaited (try/catch — the head decides); one never awaited
 * fails the loop. More than `max` passes — the loop stops (a `while` that never ends).
 */
export type { LoopJob, PassResult, LoopResult }
type Log = LoopResult['logs'][number]

const show = (a: unknown) => (typeof a === 'string' ? a : inspect(a, { depth: 5, breakLength: 110, maxArrayLength: 200, maxStringLength: 4000 }))
/** A value that can go to another process (functions, symbols… become text). */
export function plain(v: unknown): unknown {
  try {
    return structuredClone(v)
  } catch {
    try {
      return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : typeof x === 'function' ? `[function ${x.name || ''}]` : x)))
    } catch {
      return show(v)
    }
  }
}
const isName = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s)

/** A pass's failure, as the head sees it. */
export class PassError extends Error {
  constructor(
    readonly pass: number,
    message: string,
  ) {
    super(`Проход ${pass}: ${message}`)
    this.name = 'PassError'
  }
}
/**
 * A pass's promise that knows whether the head looked at it (awaited it, gave it to Promise.all, .then / .catch):
 * a failure nobody looked at is the loop's failure — as an unhandled rejection is in JS.
 */
class Pass<T> extends Promise<T> {
  seen = false
  static get [Symbol.species]() {
    return Promise
  }
  then<A = T, B = never>(ok?: ((v: T) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    this.seen = true
    return super.then(ok, bad)
  }
}

/** `emitted` — where the head's emit() batches go (none — kept nowhere: a test of the head alone). */
export async function runLoopHead(job: LoopJob, pass: (n: number, vars: Record<string, unknown>) => Promise<PassResult>, emitted: (b: EmitBatch) => void = () => undefined): Promise<LoopResult> {
  const t0 = performance.now()
  const logs: Log[] = []
  const sets: Record<string, unknown> = {}
  const out = new Emitter(emitted, plain)
  const log = (level: Log['level']) => (...a: unknown[]) => {
    if (logs.length < 2000) logs.push({ level, text: a.map(show).join(' ').slice(0, 20000) })
  }
  const cons = { log: log('log'), info: log('info'), debug: log('log'), warn: log('warn'), error: log('error'), table: (d: unknown) => logs.push({ level: 'log', text: show(d) }), dir: log('log') }

  // ---------- the passes: numbered as asked for, at most `parallel` at a time ----------
  const limit = Math.max(1, Math.floor(job.parallel) || 1)
  let asked = 0
  let active = 0
  let over = false
  let halted = false
  const waiting: Array<() => void> = []
  const slot = () => (active < limit ? (active++, Promise.resolve()) : new Promise<void>((go) => waiting.push(go)))
  const free = (failed = false) => {
    const next = waiting.shift()
    if (!next) active--
    // (after a failed pass the next one waits a tick: the head's await sees the failure first — and may end the loop)
    else if (failed) setTimeout(next, 0)
    else next()
  }
  const all: Array<{ p: Pass<unknown>; settled: Promise<unknown>; failed?: PassError }> = []
  const body = (vars?: unknown): Promise<unknown> => {
    if (vars !== undefined && (vars === null || typeof vars !== 'object' || Array.isArray(vars))) throw new TypeError('body({ … }): передайте объект — имена и значения для блоков цикла')
    const n = ++asked
    if (n > job.max) {
      over = true
      throw new Error(`Больше ${job.max} проходов — цикл остановлен (max=… в начале цикла — поднять предел)`)
    }
    const given = Object.fromEntries(Object.entries((vars ?? {}) as Record<string, unknown>))
    for (const k of Object.keys(given)) if (!isName(k)) throw new TypeError(`body({ … }): «${k}» — не имя переменной`)
    const rec: (typeof all)[number] = { p: undefined as unknown as Pass<unknown>, settled: Promise.resolve() }
    const inner = (async () => {
      await slot()
      try {
        // (the head failed meanwhile: the passes still waiting for their turn are not run)
        if (halted) throw (rec.failed = new PassError(n, 'не выполнен — цикл остановлен ошибкой'))
        const r = await pass(n, plain(given) as Record<string, unknown>)
        if (!r.ok) throw (rec.failed = new PassError(n, r.error))
        return r.values
      } finally {
        free(!!rec.failed)
      }
    })()
    rec.p = new Pass<unknown>((ok, bad) => void inner.then(ok, bad))
    // (a failure never looked at must not end the process as an unhandled rejection — it is reported at the end;
    // the plain `then`, so the pass is not marked as looked at)
    Promise.prototype.then.call(rec.p, undefined, () => undefined)
    rec.settled = inner.then(
      () => undefined,
      () => undefined,
    )
    all.push(rec)
    return rec.p
  }

  const vars = Object.fromEntries(Object.entries(job.ctx).filter(([k]) => isName(k) && k !== 'body'))
  const sandbox = vm.createContext({
    ...vars,
    ctx: job.ctx,
    body,
    console: cons,
    set: (k: string, v: unknown) => {
      if (!isName(k)) throw new Error(`set: «${k}» — не имя переменной`)
      sets[k] = v
    },
    emit: out.emit,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    structuredClone,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    fetch,
    AbortController,
    atob,
    btoa,
  })
  const libs = job.libs.map((l) => l.code).join('\n')
  const libLines = libs ? libs.split('\n').length : 0
  const src = `async function __loop() {\n${libs ? `${libs}\n` : ''}${job.head}\n}`
  const ts = job.ts || job.libs.some((l) => l.ts)
  let value: unknown
  let error: string | undefined
  try {
    // (Node's own TS support; its typings here are older)
    const code = ts ? stripTypeScriptTypes(src, { mode: 'transform' } as unknown as { mode: 'strip' }) : src
    value = await vm.runInContext(`${code}\n__loop()`, sandbox, { filename: 'цикл', lineOffset: -1 - libLines })
  } catch (err) {
    error = errorText(err, 'цикл')
    halted = true
  }
  // the passes still going (a forEach, a pass not awaited) — the loop ends with them
  for (let i = 0; i < all.length; i++) await all[i].settled
  if (!error && over) error = `Больше ${job.max} проходов — цикл остановлен (max=… в начале цикла — поднять предел)`
  if (!error) {
    const lost = all.find((r) => r.failed && !r.p.seen)
    if (lost) error = `${lost.failed!.message} (ошибка прохода не обработана: await body(…) или try/catch вокруг него)`
  }
  const base = { logs, sets: plain(sets) as Record<string, unknown>, passes: Math.min(asked, job.max), ms: performance.now() - t0, emits: out.close() }
  return error ? { ok: false, error, ...base } : { ok: true, value: plain(value), hasValue: value !== undefined, ...base }
}
