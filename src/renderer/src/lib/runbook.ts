import { reactive, toRaw } from 'vue'
import { findBlocks } from '@shared/noteBlocks'
import { infoMd, interpolate, parseHttpText, parseInfo, publishedAnswer, type BlockInfo, type RunKind } from '@shared/runbook'
import { kv, newRequest, type HttpMethod, type HttpResponse } from '@shared/http'
import { load as yamlLoad } from 'js-yaml'
import type { PwStep } from '@shared/api'
import { bindSql, rowsAsObjects, type SqlMode, type SqlResult } from '@shared/sql'
import type { Plan } from '@shared/sqlPlan'
import { resolvePath } from '@shared/runbook'
import { findLoops, loopAt, type LoopRange, type LoopResult } from '@shared/loop'

/**
 * A runnable note's run: its context (the values the blocks published, by name) and each block's last run
 * (state, time, the request and the answer, the logs). Kept next to the note (vault/.runs) — reopened, the
 * note shows its last results; a new run replaces them.
 */
export type Log = { level: 'log' | 'info' | 'warn' | 'error'; text: string }
export interface CtxItem {
  value: unknown
  at: number
  from: RunKind | 'set' | 'browser'
  /** The block that published it. */
  block: string
}
export interface BlockRun {
  state: 'run' | 'ok' | 'error'
  at: number
  ms?: number
  error?: string
  logs?: Log[]
  /** A request block: what was sent (the templates filled) and what came. */
  request?: { method: string; url: string; headers: Array<[string, string]>; body: string; missing: string[] }
  response?: HttpResponse
  /** A code block: what it returned. */
  value?: unknown
  hasValue?: boolean
  /** A Playwright block: its steps, what it left (final.png / failure.png, trace.zip, allure-results), the browser. */
  steps?: PwStep[]
  /** The ready checks of a Playwright block (qa.…). */
  checks?: import('@shared/qaChecks').QaCheck[]
  files?: string[]
  browser?: string
  /** A database query: what was sent (the note's values as parameters), its rows, its plan, the server. */
  sql?: { text: string; values: unknown[]; mode: SqlMode; db: string; missing: string[] }
  table?: SqlResult
  plan?: Plan
  planRaw?: string
  server?: string
}
/** A loop's pass: the values it was given, what its blocks published, their runs (the loops inside it — theirs). */
export interface PassRun {
  n: number
  vars: Record<string, unknown>
  state: 'run' | 'ok' | 'error'
  at: number
  ms?: number
  error?: string
  /** What its blocks published (by name; set() too). */
  values: Record<string, unknown>
  /** Its blocks' runs (an old pass of a long loop keeps its values only). */
  runs?: Record<string, BlockRun>
  loops?: Record<string, LoopRun>
}
export interface LoopRun {
  state: 'run' | 'ok' | 'error'
  at: number
  ms?: number
  error?: string
  logs?: Log[]
  /** What its head returned. */
  value?: unknown
  hasValue?: boolean
  passes: PassRun[]
  /** The pass shown (its index; none — the last). */
  sel?: number
  /** Passes whose runs were let go (their values kept) — the note's runs file stays small. */
  trimmed?: number
}
export interface NoteRun {
  ctx: Record<string, CtxItem>
  runs: Record<string, BlockRun>
  /** The loops' runs (the latest of a loop inside a loop). */
  loops: Record<string, LoopRun>
  loaded: boolean
  /** «Выполнить всё» going on: the block being run. */
  all?: { at: string; done: number; total: number; error?: string }
}
const notes = reactive(new Map<string, NoteRun>())
export function noteRun(path: string): NoteRun {
  let n = notes.get(path)
  if (!n) {
    notes.set(path, { ctx: {}, runs: {}, loops: {}, loaded: false })
    n = notes.get(path)!
    const nr = n
    void window.qa
      .runLoad(path)
      .then((json) => {
        if (json) {
          const d = JSON.parse(json) as Partial<NoteRun>
          // what was going on when the app closed is not going on now
          for (const r of Object.values(d.runs ?? {})) if (r.state === 'run') r.state = 'error'
          const stale = (l: LoopRun) => {
            if (l.state === 'run') (l.state = 'error'), (l.error ??= 'Прервано')
            for (const p of l.passes ?? []) {
              if (p.state === 'run') p.state = 'error'
              for (const r of Object.values(p.runs ?? {})) if (r.state === 'run') r.state = 'error'
              Object.values(p.loops ?? {}).forEach(stale)
            }
          }
          Object.values(d.loops ?? {}).forEach(stale)
          // (into the objects there are — a run already going on holds them; what it wrote wins)
          for (const [k, v] of Object.entries(d.ctx ?? {})) if (!(k in nr.ctx)) nr.ctx[k] = v
          for (const [k, v] of Object.entries(d.runs ?? {})) if (!(k in nr.runs)) nr.runs[k] = v
          for (const [k, v] of Object.entries(d.loops ?? {})) if (!(k in nr.loops)) nr.loops[k] = v
        }
      })
      .catch(() => undefined)
      .finally(() => (nr.loaded = true))
  }
  return n
}
/** The context as plain values (what templates and code see). */
export function ctxValues(path: string): Record<string, unknown> {
  // (the raw values: Vue's proxies cannot be sent to another process)
  return Object.fromEntries(Object.entries(toRaw(noteRun(path).ctx)).map(([k, v]) => [k, toRaw(v).value]))
}
const timers = new Map<string, ReturnType<typeof setTimeout>>()
function writeRuns(path: string): Promise<void> {
  timers.delete(path)
  const n = noteRun(path)
  let json: string
  try {
    json = JSON.stringify({ ctx: n.ctx, runs: n.runs, loops: n.loops })
    // (a long loop's passes: the old ones' runs let go — their values stay)
    if (json.length > RUNS_BUDGET) {
      for (const l of Object.values(n.loops)) trimLoop(l, 50)
      json = JSON.stringify({ ctx: n.ctx, runs: n.runs, loops: n.loops })
    }
  } catch {
    return Promise.resolve()
  }
  return window.qa.runSave(path, json).catch(() => undefined)
}
const RUNS_BUDGET = 12 * 1024 * 1024
/** A loop's passes but the last `keep` (and the one shown): their blocks' runs dropped, their values kept. */
function trimLoop(l: LoopRun, keep: number): void {
  const sel = l.sel ?? l.passes.length - 1
  l.passes.forEach((p, i) => {
    if (i >= l.passes.length - keep || i === sel || !p.runs) return
    p.runs = undefined
    p.loops = undefined
    l.trimmed = (l.trimmed ?? 0) + 1
  })
}
/** A note's runs saved soon (a component that keeps its own results in them — «Регрессия»). */
export const saveRuns = (path: string) => persist(path)
function persist(path: string): void {
  clearTimeout(timers.get(path))
  const busy = Object.values(notes.get(path)?.loops ?? {}).some((l) => l.state === 'run')
  timers.set(
    path,
    setTimeout(() => void writeRuns(path), busy ? 4000 : 800),
  )
}
const under = (path: string, p: string) => p === path || p.startsWith(`${path}/`)
/**
 * A note (or a folder) deleted: its runs forgotten here too — a pending save of them dropped (it would write them back
 * after the delete), so a new note of the same name starts clean.
 */
export function forgetRuns(path: string): void {
  for (const p of [...notes.keys()]) if (under(path, p)) notes.delete(p)
  for (const p of [...timers.keys()])
    if (under(path, p)) {
      clearTimeout(timers.get(p))
      timers.delete(p)
    }
}
/** A note (or a folder) renamed / moved: its runs go with it (on the disk they are moved by the vault). */
export function moveRuns(from: string, to: string): void {
  for (const p of [...notes.keys()])
    if (under(from, p)) {
      notes.set(to + p.slice(from.length), notes.get(p)!)
      notes.delete(p)
    }
  for (const p of [...timers.keys()])
    if (under(from, p)) {
      clearTimeout(timers.get(p))
      timers.delete(p)
      persist(to + p.slice(from.length))
    }
}
/** The runs not saved yet — saved now (before a document is packed). */
export async function flushRuns(): Promise<void> {
  const paths = [...timers.keys()]
  for (const p of paths) clearTimeout(timers.get(p))
  await Promise.all(paths.map(writeRuns))
}
function publish(path: string, name: string, value: unknown, from: CtxItem['from'], block: string): void {
  noteRun(path).ctx[name] = { value: JSON.parse(JSON.stringify(value ?? null)) as unknown, at: Date.now(), from, block }
  persist(path)
}
export function clearCtx(path: string): void {
  const n = noteRun(path)
  // (emptied in place: a run going on writes into these very objects)
  for (const o of [n.ctx, n.runs, n.loops] as Array<Record<string, unknown>>) for (const k of Object.keys(o)) delete o[k]
  persist(path)
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---------- the blocks ----------
/** The key a block's run is kept under: its name, or its kind and place (an unnamed one). */
export const runKey = (name: string | undefined, kind: string, line: number) => name || `_${kind}${line}`

/** A data block's value (JSON / YAML) put into the context — as soon as it parses. */
/** A value put into the note's context from outside a run (the browser component's requests). */
export function publishValue(path: string, name: string, value: unknown, from: CtxItem['from'], block: string): void {
  publish(path, name, value, from, block)
  persist(path)
}
export function publishData(path: string, name: string, lang: string, body: string): string | undefined {
  try {
    const v = lang === 'yaml' ? yamlLoad(body) : JSON.parse(body || 'null')
    const cur = noteRun(path).ctx[name]
    if (!cur || JSON.stringify(cur.value) !== JSON.stringify(v)) publish(path, name, v, 'data', name)
    return undefined
  } catch (e) {
    return errText(e).split('\n')[0]
  }
}
/** Every data block of the text published (the ones not on screen too). */
export function syncData(path: string, text: string): void {
  for (const b of findBlocks(text.split('\n'))) {
    if (b.kind !== 'data') continue
    const lines = b.src.split('\n')
    const info = parseInfo(lines[0].replace(/^(`{3,}|~{3,})/, ''))
    if (info.name) publishData(path, info.name, info.lang, lines.slice(1, -1).join('\n'))
  }
}
/**
 * The note's templates (not in a loop) published under their names whenever they can be filled — the ones not on
 * screen too: run after the text changes and after the note's values do (a template over a template settles in a
 * round or two — a value published only when it changed).
 */
export function syncTemplates(path: string, text: string): void {
  const ctx = ctxValues(path)
  for (const x of itemsIn(text)) {
    if (x.kind !== 'tpl' || !x.info.name) continue
    const r = interpolate(x.body, ctx)
    const cur = noteRun(path).ctx[x.info.name]
    if (!r.missing.length && cur?.value !== r.text) publish(path, x.info.name, r.text, 'tpl', x.key)
  }
}

// ---------- where a block runs: the note itself, or a pass of a loop ----------
/**
 * A run's surroundings: the values a block sees, where what it publishes goes, where its run is kept, and the id its
 * run goes by (to stop it). The note's own — its context; a loop's pass — the pass's values over the note's (or the
 * outer pass's), what it publishes kept with the pass.
 */
export interface RunEnv {
  values(): Record<string, unknown>
  publish(name: string, value: unknown, from: CtxItem['from'], block: string): void
  runs: Record<string, BlockRun>
  loops: Record<string, LoopRun>
  /** '' — the note's; `@<loop>#<n>…` — a pass's. */
  id: string
  /** Passes one after another (a set() of a pass is then the note's at once — the next passes see it). */
  serial?: boolean
  /** A block's run written (a pass's — shown on the note's block when it is the pass shown). */
  onRun?: (key: string, r: BlockRun) => void
}
export function noteEnv(path: string): RunEnv {
  const n = noteRun(path)
  return { values: () => ctxValues(path), publish: (k, v, from, block) => publish(path, k, v, from, block), runs: n.runs, loops: n.loops, id: '' }
}
const clone = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as unknown
/** A pass's surroundings: its values over the outer ones; what it publishes — its own (set() — the outer's too, if serial). */
function passEnv(path: string, outer: RunEnv, loopKey: string, pass: PassRun, serial: boolean, lr: LoopRun): RunEnv {
  pass.runs ??= {}
  pass.loops ??= {}
  const shown = () => toRaw(lr.passes[lr.sel ?? lr.passes.length - 1]) === toRaw(pass)
  const env: RunEnv = {
    values: () => {
      // (read through Vue — a computed of a table / a value in the loop follows the pass's values)
      for (const k in pass.values) void pass.values[k]
      return { ...outer.values(), ...(clone(pass.vars) as object), loop: { n: pass.n, index: pass.n - 1 }, ...toRaw(pass.values) }
    },
    publish: (k, v, from, block) => {
      pass.values[k] = clone(v)
      if (from === 'set' && serial) outer.publish(k, v, from, block)
    },
    runs: pass.runs,
    loops: pass.loops,
    id: `${outer.id}@${loopKey}#${pass.n}`,
    serial,
    onRun: (key, r) => shown() && (noteRun(path).runs[key] = r),
  }
  return env
}
/**
 * A block's surroundings by its place: in a loop — the pass shown of that loop (a block run alone in a loop runs in
 * that pass again: its values, its result kept with it); otherwise the note's.
 */
export function envAt(path: string, line: number, text: string): RunEnv {
  const loops = findLoops(text.split('\n'))
  const l = loopAt(loops, line)
  if (!l) return noteEnv(path)
  const outer = envAt(path, l.line0, text)
  const lr = noteRun(path).loops[l.key]
  const p = lr?.passes[lr.sel ?? lr.passes.length - 1]
  return p ? passEnv(path, outer, l.key, p, l.info.parallel <= 1, lr) : outer
}

const running = new Map<string, string>()
const say = (env: RunEnv, key: string, r: BlockRun) => {
  env.runs[key] = r
  env.onRun?.(key, r)
  return r
}
/** A request block run: its templates filled from the context (the HTTP section's variables fill the rest). */
export async function runHttp(path: string, key: string, name: string | undefined, text: string, env: RunEnv = noteEnv(path)): Promise<boolean> {
  const ctx = env.values()
  const p = parseHttpText(text)
  const fill = (s: string, miss: string[]) => {
    const r = interpolate(s, ctx)
    miss.push(...r.missing)
    return r.text
  }
  const missing: string[] = []
  const url = fill(p.url, missing)
  const headers = p.headers.map(([k, v]) => [k, fill(v, missing)] as [string, string])
  const body = fill(p.body, missing)
  const req = newRequest(name ?? 'Блок заметки')
  req.method = (p.method as HttpMethod) || 'GET'
  req.url = url
  req.headers = headers.map(([k, v]) => kv(k, v))
  const ctype = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? ''
  if (body) req.body = /json/i.test(ctype) || (!ctype && /^\s*[[{]/.test(body)) ? { mode: 'json', text: body, rawType: 'application/json', rows: [] } : { mode: 'raw', text: body, rawType: ctype || 'text/plain', rows: [] }
  const slot = `${path}#${key}${env.id}`
  const runId = `${slot}#${Date.now()}`
  running.set(slot, runId)
  const r = say(env, key, { state: 'run', at: Date.now(), request: { method: req.method, url, headers, body, missing } })
  try {
    const doc = await window.qa.httpLoad()
    const out = await window.qa.httpRun(req, doc, runId)
    if (running.get(slot) !== runId) return false
    const ok = !out.error && !!out.response
    say(env, key, { ...r, state: ok ? 'ok' : 'error', ms: out.response?.time, response: out.response, error: out.error, logs: out.logs.map((t) => ({ level: 'log', text: t })) })
    if (out.response && name) env.publish(name, publishedAnswer(out.response), 'http', key)
    persist(path)
    return ok
  } catch (e) {
    say(env, key, { ...r, state: 'error', error: errText(e) })
    persist(path)
    return false
  } finally {
    if (running.get(slot) === runId) running.delete(slot)
  }
}
/**
 * A database query of the note: its {{ values }} sent as parameters (never glued into its text), run read-only in a
 * process of its own; its rows published under its name (an array of objects — {{ name[0].id }}). A plan (`plan`,
 * `analyze`) publishes nothing.
 */
export async function runSql(path: string, key: string, name: string | undefined, db: string, body: string, mode: SqlMode = 'run', env: RunEnv = noteEnv(path)): Promise<boolean> {
  const ctx = env.values()
  const conn = (await window.qa.sql('conns')).find((c) => c.name === db)
  const b = bindSql(body, conn?.kind ?? 'pg', (p) => resolvePath(ctx, p))
  const sql = { text: b.text, values: b.values, mode, db, missing: b.missing }
  if (b.error) {
    say(env, key, { state: 'error', at: Date.now(), sql, error: b.error })
    persist(path)
    return false
  }
  if (b.missing.length) {
    say(env, key, { state: 'error', at: Date.now(), sql, error: `Нет значения: ${b.missing.map((m) => `{{${m}}}`).join(', ')} — выполните блок, который его даёт` })
    persist(path)
    return false
  }
  const slot = `${path}#${key}${env.id}`
  const runId = `${slot}#${Date.now()}`
  running.set(slot, runId)
  const r = say(env, key, { state: 'run', at: Date.now(), sql })
  try {
    const out = await window.qa.sql('run', runId, db, b.text, b.values, mode)
    if (running.get(slot) !== runId) return false
    const x = out.run
    say(env, key, { ...r, state: out.ok ? 'ok' : 'error', ms: out.ms, error: out.error, table: x?.result, plan: x?.plan, planRaw: x?.planRaw, server: x?.server })
    if (out.ok && x?.result && name) env.publish(name, rowsAsObjects(x.result), 'sql', key)
    persist(path)
    return out.ok
  } catch (e) {
    say(env, key, { ...r, state: 'error', error: errText(e) })
    persist(path)
    return false
  } finally {
    if (running.get(slot) === runId) running.delete(slot)
  }
}
/**
 * A text by a template (```md template name=…): its {{ values }} filled — the text published under its name, shown
 * as Markdown. A value missing — an error (no text with holes in it).
 */
export function runTpl(path: string, key: string, name: string | undefined, body: string, env: RunEnv = noteEnv(path)): boolean {
  const t0 = performance.now()
  const r = interpolate(body, env.values())
  if (r.missing.length) {
    say(env, key, { state: 'error', at: Date.now(), error: `Нет значения: ${[...new Set(r.missing)].map((m) => `{{${m}}}`).join(', ')} — выполните блок, который его даёт` })
    persist(path)
    return false
  }
  say(env, key, { state: 'ok', at: Date.now(), ms: performance.now() - t0, value: r.text, hasValue: true })
  if (name) env.publish(name, r.text, 'tpl', key)
  persist(path)
  return true
}
/** A code block run apart (the note's «lib» blocks first): what it returns — published under its name. */
/**
 * The note's runnable blocks as they went (`runs` in code — for a report): by name (or _kind<line>), its kind,
 * state ('ok' | 'error' | 'run' | 'none' — not run yet), time, error, a Playwright block's steps. Not this one.
 */
function runsOf(path: string, noteText: string, self: string): Record<string, unknown> {
  const n = noteRun(path)
  const out: Record<string, unknown> = {}
  for (const b of findBlocks(noteText.split('\n'))) {
    if (b.kind !== 'http' && b.kind !== 'code' && b.kind !== 'pw' && b.kind !== 'sql' && b.kind !== 'tpl') continue
    const info = parseInfo(b.src.split('\n')[0].replace(/^(`{3,}|~{3,})/, ''))
    if (info.lib) continue
    const key = runKey(info.name, b.kind, b.line0)
    if (key === self) continue
    const r = toRaw(n.runs[key])
    out[key] = {
      kind: b.kind,
      state: r?.state ?? 'none',
      ...(r?.at ? { at: r.at } : {}),
      ...(r?.ms !== undefined ? { ms: Math.round(r.ms) } : {}),
      ...(r?.error ? { error: r.error.split('\n')[0] } : {}),
      ...(r?.response ? { status: r.response.status } : {}),
      ...(r?.table ? { rows: r.table.rows.length } : {}),
      ...(r?.steps ? { steps: r.steps.map((s) => ({ name: s.name, state: s.state, ms: s.ms })) } : {}),
      ...(info.soft ? { soft: true } : {}),
    }
  }
  return JSON.parse(JSON.stringify(out))
}
/** The note's shared functions (the «lib» code blocks) but this one. */
function libsOf(noteText: string, code: string): Array<{ code: string; ts: boolean }> {
  return findBlocks(noteText.split('\n'))
    .filter((b) => b.kind === 'code')
    .map((b) => ({ lines: b.src.split('\n') }))
    .map(({ lines }) => ({ info: parseInfo(lines[0].replace(/^(`{3,}|~{3,})/, '')), code: lines.slice(1, -1).join('\n') }))
    .filter((b) => b.info.lib && b.code !== code)
    .map((b) => ({ code: b.code, ts: b.info.lang.startsWith('t') }))
}
export async function runCode(path: string, key: string, name: string | undefined, lang: string, code: string, noteText: string, timeoutSec?: number, env: RunEnv = noteEnv(path)): Promise<boolean> {
  const libs = libsOf(noteText, code)
  const runId = `${path}#${key}${env.id}`
  say(env, key, { state: 'run', at: Date.now() })
  try {
    const r = await window.qa.runCode(runId, { code, ts: lang.startsWith('t'), libs, ctx: env.values(), runs: runsOf(path, noteText, key), timeoutSec })
    say(env, key, { state: r.ok ? 'ok' : 'error', at: Date.now(), ms: r.ms, logs: r.logs, error: r.error, value: r.value, hasValue: r.hasValue })
    if (r.ok && name && r.hasValue) env.publish(name, r.value, 'code', key)
    for (const [k, v] of Object.entries(r.sets ?? {})) env.publish(k, v, 'set', key)
    persist(path)
    return r.ok
  } catch (e) {
    say(env, key, { state: 'error', at: Date.now(), error: errText(e) })
    persist(path)
    return false
  }
}
// the steps of the Playwright runs going on
let pwListening = false
const pwRuns = new Map<string, { env: RunEnv; key: string }>()
function listenPw(): void {
  if (pwListening) return
  pwListening = true
  window.qa.onPwProgress((runId, steps) => {
    const i = runId.lastIndexOf('#')
    const own = pwRuns.get(runId)
    const r = own ? own.env.runs[own.key] : notes.get(runId.slice(0, i))?.runs[runId.slice(i + 1)]
    if (r?.state === 'run') r.steps = steps
  })
}
/**
 * A Playwright block: the installed browser driven in a process of its own; its return value and set() published.
 * (One at a time per block — its files are the block's: a loop with one goes pass by pass.)
 */
export async function runPw(path: string, key: string, info: BlockInfo, code: string, noteText: string, env: RunEnv = noteEnv(path)): Promise<boolean> {
  listenPw()
  const runId = `${path}#${key}${env.id}`
  const own = { env, key }
  pwRuns.set(runId, own)
  say(env, key, { state: 'run', at: Date.now(), steps: [] })
  try {
    const r = await window.qa.runPw(runId, {
      code,
      ts: info.lang.startsWith('t'),
      libs: libsOf(noteText, code),
      ctx: env.values(),
      runs: runsOf(path, noteText, key),
      note: path,
      key,
      name: info.name ?? 'Сценарий',
      browser: info.browser ?? 'msedge',
      headed: !!info.headed,
      trace: !info.notrace,
      session: !!info.session,
      timeoutSec: info.timeout,
    })
    say(env, key, { state: r.ok ? 'ok' : 'error', at: Date.now(), ms: r.ms, logs: r.logs, error: r.error, value: r.value, hasValue: r.hasValue, steps: r.steps, checks: r.checks, files: r.files, browser: r.browser })
    if (r.ok && info.name && r.hasValue) env.publish(info.name, r.value, 'pw', key)
    for (const [k, v] of Object.entries(r.sets ?? {})) env.publish(k, v, 'set', key)
    persist(path)
    return r.ok
  } catch (e) {
    say(env, key, { state: 'error', at: Date.now(), error: errText(e) })
    persist(path)
    return false
  } finally {
    if (pwRuns.get(runId) === own) pwRuns.delete(runId)
  }
}
/** A run stopped: the request aborted / the query cancelled / the code's process killed / the browser closed. */
export function stopBlock(path: string, key: string, envId = ''): void {
  const id = running.get(`${path}#${key}${envId}`)
  if (id) void window.qa.httpAbort(id)
  // (a query: cancelled on its server, its connection closed)
  if (id) void window.qa.sql('stop', id)
  window.qa.runCodeStop(`${path}#${key}${envId}`)
  window.qa.runPwStop(`${path}#${key}${envId}`)
}

// ---------- what runs, in order: the blocks and the loops (a loop — as one, its blocks — by its passes) ----------
type Runnable = 'http' | 'code' | 'pw' | 'sql' | 'tpl'
export type RunItem = { kind: Runnable; info: BlockInfo; body: string; key: string; line: number } | { kind: 'loop'; loop: LoopRange; key: string; line: number }
const RUNNABLE = new Set(['http', 'code', 'pw', 'sql', 'tpl'])
/** The runnable things right inside a loop (none — the note's top): its blocks, the loops in it (not their insides). */
export function itemsIn(text: string, loop?: LoopRange): RunItem[] {
  const lines = text.split('\n')
  const loops = findLoops(lines)
  const owner = (line: number) => loopAt(loops, line)?.key
  const out: RunItem[] = []
  for (const b of findBlocks(lines)) {
    if (b.kind === 'loop') {
      const l = loops.find((x) => x.line0 === b.line0)
      if (l && l.end !== undefined && l.parent === loop?.key) out.push({ kind: 'loop', loop: l, key: l.key, line: l.line0 })
      continue
    }
    if (!RUNNABLE.has(b.kind) || owner(b.line0) !== loop?.key) continue
    const ls = b.src.split('\n')
    const info = parseInfo(ls[0].replace(/^(`{3,}|~{3,})/, ''))
    if (info.lib) continue
    out.push({ kind: b.kind as Runnable, info, body: ls.slice(1, -1).join('\n'), key: runKey(info.name, b.kind, b.line0), line: b.line0 })
  }
  return out
}
/** One thing run in its surroundings (a loop — all its passes). */
async function runItem(path: string, x: RunItem, text: string, env: RunEnv): Promise<boolean> {
  try {
    if (x.kind === 'loop') return await runLoop(path, x.loop, text, env)
    if (x.kind === 'http') return await runHttp(path, x.key, x.info.name, x.body, env)
    if (x.kind === 'sql') return await runSql(path, x.key, x.info.name, x.info.db ?? '', x.body, 'run', env)
    if (x.kind === 'tpl') return runTpl(path, x.key, x.info.name, x.body, env)
    if (x.kind === 'pw') return await runPw(path, x.key, x.info, x.body, text, env)
    return await runCode(path, x.key, x.info.name, x.info.lang, x.body, text, x.info.timeout, env)
  } catch (e) {
    // (thrown before its run began — a broken request text, no connections list…): the block's error
    if (x.kind === 'loop') Object.assign(env.loops[x.key] ?? (env.loops[x.key] = { state: 'error', at: Date.now(), passes: [] }), { state: 'error', error: errText(e) })
    else say(env, x.key, { state: 'error', at: Date.now(), error: errText(e) })
    persist(path)
    return false
  }
}
/** A Playwright block anywhere in a loop (in a loop inside it too): its files are the block's — passes one by one. */
export function loopHasPw(text: string, loop: LoopRange): boolean {
  if (loop.end === undefined) return false
  return findBlocks(text.split('\n')).some((b) => b.kind === 'pw' && b.line0 > loop.headEnd && b.line1 < loop.end!)
}
const itemError = (x: RunItem, env: RunEnv) => (x.kind === 'loop' ? env.loops[x.key]?.error : env.runs[x.key]?.error) ?? 'Ошибка'
const isSoft = (x: RunItem) => (x.kind === 'loop' ? !!x.loop.info.soft : !!x.info.soft)

// ---------- a loop ----------
type PassHandler = (n: number, vars: Record<string, unknown>) => void
const passHandlers = new Map<string, PassHandler>()
let passListening = false
function listenPasses(): void {
  if (passListening) return
  passListening = true
  window.qa.onLoopPass((runId, n, vars) => passHandlers.get(runId)?.(n, vars))
}
/** The loops going on (their run id → what stops their passes; their end, to wait for). */
const loopStops = new Map<string, () => void>()
const loopDone = new Map<string, Promise<boolean>>()
/** How long the passes going on are waited for after the head ended (stopped, timed out) — then given up. */
const PASS_WAIT_MS = 30_000
/**
 * A loop run: its head (plain JS, in a process of its own) asks for passes — each runs the loop's blocks with the
 * values given, in order; the first failing one (not «soft») fails the pass. Afterwards each named block's name is
 * the list of its values over the passes, the loop's name — what its head returned, or its passes' records.
 * (The same loop run again while it goes: the old run stopped and waited for first.)
 */
export async function runLoop(path: string, loop: LoopRange, text: string, env: RunEnv = noteEnv(path)): Promise<boolean> {
  const runId = `${path}#${loop.key}${env.id}`
  const prev = loopDone.get(runId)
  if (prev) {
    stopLoopRun(runId)
    await prev.catch(() => false)
  }
  const done = loopRun(path, loop, text, env, runId)
  loopDone.set(runId, done)
  try {
    return await done
  } finally {
    if (loopDone.get(runId) === done) loopDone.delete(runId)
  }
}
async function loopRun(path: string, loop: LoopRange, text: string, env: RunEnv, runId: string): Promise<boolean> {
  listenPasses()
  const n = noteRun(path)
  const items = itemsIn(text, loop)
  // (a Playwright block's files are the block's own — anywhere in the loop: such a loop goes pass by pass)
  const serial = loop.info.parallel <= 1 || loopHasPw(text, loop)
  env.loops[loop.key] = { state: 'run', at: Date.now(), passes: [] }
  const lr = env.loops[loop.key]
  // seen on the note's blocks: the latest of a loop inside a loop too
  if (env.loops !== n.loops) n.loops[loop.key] = lr
  // the inner blocks' names: last run's lists gone — a pass sees its own values, never an old list by that name
  const names = items.map((x) => (x.kind === 'loop' ? x.loop.info.name : x.info.name)).filter((x): x is string => !!x)
  if (!env.id) for (const k of names) delete n.ctx[k]
  let stopped = false
  const passEnvs = new Map<number, RunEnv>()
  const stop = () => {
    stopped = true
    for (const pe of passEnvs.values())
      for (const x of items) {
        if (x.kind === 'loop') stopLoopRun(`${path}#${x.key}${pe.id}`)
        else stopBlock(path, x.key, pe.id)
      }
  }
  loopStops.set(runId, stop)
  const handler: PassHandler = (pn, vars) => {
    const pass: PassRun = { n: pn, vars, state: 'run', at: Date.now(), values: {}, runs: {}, loops: {} }
    // (in the order of their numbers — parallel ones may come in another)
    let at = lr.passes.length
    while (at > 0 && lr.passes[at - 1].n > pn) at--
    lr.passes.splice(at, 0, pass)
    const p = lr.passes[at]
    const pe = passEnv(path, env, loop.key, p, serial, lr)
    passEnvs.set(pn, pe)
    void (async () => {
      const t0 = performance.now()
      let error: string | undefined
      try {
        for (const x of items) {
          if (stopped) {
            error = 'Остановлено'
            break
          }
          const ok = await runItem(path, x, text, pe)
          if (!ok && !isSoft(x)) {
            error = `${x.kind === 'loop' ? 'цикл' : 'блок'} «${x.key}»: ${itemError(x, pe).split('\n')[0]}`
            break
          }
        }
      } catch (e) {
        error = errText(e)
      } finally {
        // (always: the pass ends, the head is answered — a loop never waits for a pass that is gone)
        p.state = error ? 'error' : 'ok'
        p.error = error
        p.ms = performance.now() - t0
        passEnvs.delete(pn)
        // the note's blocks show the latest pass (unless another one was picked to look at)
        if (lr.sel === undefined) showPass(path, lr, undefined)
        persist(path)
        let values: Record<string, unknown> = {}
        try {
          values = JSON.parse(JSON.stringify(toRaw(p.values))) as Record<string, unknown>
        } catch {
          // (nothing to give back — the head gets an empty object)
        }
        window.qa.runLoopPass(runId, pn, error ? { ok: false, error } : { ok: true, values })
      }
    })()
  }
  passHandlers.set(runId, handler)
  let res: LoopResult
  try {
    res = await window.qa.runLoop(runId, {
      head: loop.head,
      ts: loop.ts,
      libs: libsOf(text, ''),
      ctx: JSON.parse(JSON.stringify(env.values())) as Record<string, unknown>,
      parallel: serial ? 1 : loop.info.parallel,
      max: loop.info.max,
      timeoutSec: loop.info.timeout,
    })
  } catch (e) {
    res = { ok: false, error: errText(e), logs: [], passes: 0, ms: 0 }
  }
  // (stopped / timed out — the passes going on are stopped too, and waited for a while)
  if (!res.ok) stop()
  const until = Date.now() + PASS_WAIT_MS
  while (lr.passes.some((p) => p.state === 'run') && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
  for (const p of lr.passes) if (p.state === 'run') Object.assign(p, { state: 'error', error: 'Не дождались — остановлено' })
  if (passHandlers.get(runId) === handler) passHandlers.delete(runId)
  if (loopStops.get(runId) === stop) loopStops.delete(runId)
  // the inner blocks' names: their values over the passes (a pass that gave none — null)
  for (const x of items) {
    const name = x.kind === 'loop' ? x.loop.info.name : x.info.name
    if (name) env.publish(name, lr.passes.map((p) => p.values[name] ?? null), x.kind === 'loop' ? 'loop' : x.kind, x.key)
  }
  for (const [k, v] of Object.entries(res.sets ?? {})) env.publish(k, v, 'set', loop.key)
  if (loop.info.name) env.publish(loop.info.name, res.ok && res.hasValue ? res.value : lr.passes.map((p) => ({ n: p.n, ...p.vars, ...toRaw(p.values), ...(p.error ? { error: p.error } : {}) })), 'loop', loop.key)
  Object.assign(lr, { state: res.ok ? 'ok' : 'error', ms: res.ms, error: res.error, logs: res.logs, value: res.value, hasValue: res.hasValue })
  persist(path)
  return res.ok
}
function stopLoopRun(runId: string): void {
  window.qa.runLoopStop(runId)
  loopStops.get(runId)?.()
}
/** A loop stopped: its head killed, its passes' blocks stopped. */
export function stopLoop(path: string, key: string, envId = ''): void {
  stopLoopRun(`${path}#${key}${envId}`)
}
/**
 * A pass picked to look at (none — the latest): the loop's blocks show its runs — and only its (a block that did not
 * run in it shows nothing, not another pass's result).
 */
export function showPass(path: string, lr: LoopRun, index: number | undefined): void {
  const n = noteRun(path)
  const p = lr.passes[index ?? lr.passes.length - 1]
  if (!p) return
  const keys = new Set(lr.passes.flatMap((x) => Object.keys(x.runs ?? {})))
  for (const k of keys) {
    const r = p.runs?.[k]
    if (r) n.runs[k] = r
    else delete n.runs[k]
  }
  for (const [k, l] of Object.entries(p.loops ?? {})) n.loops[k] = l
}
export function pickPass(path: string, key: string, index: number | undefined): void {
  const lr = noteRun(path).loops[key]
  if (!lr) return
  lr.sel = index === undefined || index >= lr.passes.length - 1 ? undefined : Math.max(0, index)
  showPass(path, lr, lr.sel)
  persist(path)
}

/** The notes whose «Выполнить всё» was asked to stop. */
const stopAll = new Set<string>()
/** Everything from the top, in order (a loop — with all its passes); the first failing one stops it. */
export async function runAll(path: string, text: string): Promise<void> {
  const n = noteRun(path)
  syncData(path, text)
  const list = itemsIn(text)
  const env = noteEnv(path)
  stopAll.delete(path)
  n.all = { at: '', done: 0, total: list.length }
  for (const [i, x] of list.entries()) {
    if (stopAll.has(path)) {
      stopAll.delete(path)
      n.all = { ...n.all, error: 'Остановлено' }
      return
    }
    n.all = { at: x.key, done: i, total: list.length }
    const ok = await runItem(path, x, text, env)
    // a «soft» block's error is expected — the rest go on
    if (!ok && !isSoft(x)) {
      n.all = { at: x.key, done: i, total: list.length, error: itemError(x, env) }
      return
    }
  }
  n.all = undefined
}
export function stopRunAll(path: string): void {
  stopAll.add(path)
  const at = noteRun(path).all?.at
  if (!at) return
  if (noteRun(path).loops[at]?.state === 'run') stopLoop(path, at)
  else stopBlock(path, at)
}

/** A fenced block taken apart: its fence, its info line, its body — and put back together. */
export function fenceParts(src: string): { fence: string; info: BlockInfo; body: string } {
  const lines = src.split('\n')
  const m = /^(`{3,}|~{3,})(.*)$/.exec(lines[0]) ?? ['', '```', '']
  return { fence: m[1], info: parseInfo(m[2]), body: lines.slice(1, -1).join('\n') }
}
export const fenceSrc = (fence: string, info: BlockInfo, body: string) => `${fence}${infoMd(info)}\n${body}\n${fence}`
/** A value as pretty JSON (for showing), cut when huge. */
export function pretty(v: unknown, max = 200_000): string {
  let s: string
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  } catch {
    s = String(v)
  }
  return s.length > max ? `${s.slice(0, max)}\n… (обрезано: ${Math.round(s.length / 1024)} КБ)` : s
}

// ---------- a report to copy (for a person: a chat, a Jira comment, an e-mail) ----------
const dur = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`)
const when = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t)
const indent = (t: string, pad = '  ') => t.split('\n').map((l) => (l.trim() ? pad + l : '')).join('\n')
const KIND_RU: Record<string, string> = { http: 'HTTP-запрос', code: 'Код', pw: 'Тест', data: 'Данные', sql: 'Запрос к БД', tpl: 'Текст по шаблону' }
/** One block's last run as text: what was checked, how it went, the error, the result. */
export function blockReport(path: string, key: string, kind: 'http' | 'code' | 'pw' | 'sql' | 'tpl', info: BlockInfo, body: string, opts: { brief?: boolean } = {}): string {
  const r = noteRun(path).runs[key]
  const title = `${KIND_RU[kind]} «${info.name ?? key}»`
  if (!r) return `⏸ ${title} — не запускался`
  const ok = r.state === 'ok'
  const mark = r.state === 'run' ? '⏳' : ok ? '✅' : info.soft ? '⚠️' : '❌'
  const out: string[] = []
  if (kind === 'sql') {
    const t = r.table
    out.push(`${mark} ${title} — ${t ? `строк ${t.rows.length}${t.more ? '+' : ''}` : r.plan ? 'план' : ok ? 'выполнен' : r.state === 'run' ? 'выполняется' : 'ошибка'}${r.ms !== undefined ? ` за ${dur(r.ms)}` : ''}${info.db ? ` · ${info.db}` : ''}`)
    if (!opts.brief) out.push(`Запрос:\n${indent(cut(body.trim(), 1500))}`)
    if (!opts.brief && r.plan?.findings.length) out.push(`Замечания плана:\n${indent(r.plan.findings.map((f) => `${f.level === 'warn' ? '⚠️' : 'ℹ️'} ${f.text}`).join('\n'))}`)
  } else if (kind === 'http') {
    const res = r.response
    out.push(`${mark} ${title} — ${res ? `${res.status} ${res.statusText}` : ok ? 'выполнен' : 'ошибка'}${r.ms !== undefined ? ` за ${dur(r.ms)}` : ''}`)
    if (r.request) out.push(`${r.request.method} ${r.request.url}`)
    if (!opts.brief && res) {
      const type = res.headers.find(([h]) => h.toLowerCase() === 'content-type')?.[1]?.split(';')[0]
      out.push(`Ответ: ${res.size < 1024 ? `${res.size} Б` : `${(res.size / 1024).toFixed(1)} КБ`}${type ? `, ${type}` : ''}`)
      if (res.body) out.push(`Тело (начало):\n${indent(cut(res.body, 600))}`)
    }
  } else {
    const verb = kind === 'pw' ? (ok ? 'пройден' : r.state === 'run' ? 'выполняется' : info.soft ? 'упал (ожидаемо)' : 'упал') : ok ? 'выполнен' : 'ошибка'
    out.push(`${mark} ${title} — ${verb}${r.ms !== undefined ? ` за ${dur(r.ms)}` : ''}`)
    if (kind === 'pw' && r.steps?.length) {
      out.push('Шаги:')
      for (const st of r.steps) {
        out.push(`${'  '.repeat(st.depth + 1)}${st.state === 'ok' ? '✅' : st.state === 'run' ? '⏳' : '❌'} ${st.name}${st.ms !== undefined ? ` — ${dur(st.ms)}` : ''}`)
        if (st.error && !opts.brief) out.push(`${'  '.repeat(st.depth + 2)}${cut(st.error, 300)}`)
      }
    } else if (kind === 'code' && !opts.brief && !body.includes('\n') && body.trim()) out.push(`Код: ${cut(body.trim(), 200)}`)
  }
  if (r.error) out.push(opts.brief ? `Ошибка: ${cut(r.error.split('\n')[0], 300)}` : `Ошибка:\n${indent(cut(r.error.split('\n').slice(0, 14).join('\n'), 2000))}`)
  if (!opts.brief) {
    const logs = (r.logs ?? []).filter((l) => !/^Вход (из Браузера|сохранён)/.test(l.text))
    if (logs.length) out.push(`Лог:\n${indent(cut(logs.map((l) => (l.level === 'error' || l.level === 'warn' ? `[${l.level}] ` : '') + l.text).join('\n'), 1500))}`)
    if (r.hasValue) out.push(`Результат: ${cut(typeof r.value === 'string' ? r.value : JSON.stringify(r.value, null, 2), 1500)}`)
    if (kind === 'pw') {
      const extra = [r.browser ? `браузер ${r.browser}` : '', r.files?.includes('trace.zip') ? 'трассировка есть' : '', r.files?.some((x) => x.endsWith('.png')) ? 'скриншот есть' : ''].filter(Boolean)
      if (extra.length) out.push(`(${extra.join(' · ')})`)
    }
    out.push(`Запуск: ${when(r.at)}`)
  }
  return out.join('\n')
}
/** The whole note: a summary line, every runnable block in order (the failed ones in full). */
export function noteReport(path: string, noteText: string): string {
  const blocks = findBlocks(noteText.split('\n'))
    .filter((b) => b.kind === 'http' || b.kind === 'code' || b.kind === 'pw' || b.kind === 'sql')
    .map((b) => {
      const lines = b.src.split('\n')
      const info = parseInfo(lines[0].replace(/^(`{3,}|~{3,})/, ''))
      return { kind: b.kind as 'http' | 'code' | 'pw' | 'sql', info, body: lines.slice(1, -1).join('\n'), key: runKey(info.name, b.kind, b.line0) }
    })
    .filter((x) => !x.info.lib)
  const n = noteRun(path)
  const runs = blocks.map((b) => n.runs[b.key])
  const okN = runs.filter((r) => r?.state === 'ok').length
  const bad = blocks.filter((b, i) => runs[i]?.state === 'error' && !b.info.soft).length
  const soft = blocks.filter((b, i) => runs[i]?.state === 'error' && b.info.soft).length
  const none = runs.filter((r) => !r).length
  const tests = blocks.filter((b) => b.kind === 'pw')
  const title = (noteText.match(/^#\s+(.+)$/m)?.[1] ?? path.split('/').pop()!.replace(/\.md$/i, '')).trim()
  const last = Math.max(0, ...runs.map((r) => r?.at ?? 0))
  const head = [
    `📋 ${title}`,
    `${bad ? '❌ Есть ошибки' : none === blocks.length ? '⏸ Не запускалось' : '✅ Всё в порядке'} — успешно ${okN} из ${blocks.length}${soft ? `, ожидаемых падений ${soft}` : ''}${bad ? `, ошибок ${bad}` : ''}${none ? `, не запускалось ${none}` : ''}`,
    ...(tests.length ? [`Тесты в браузере: ${tests.filter((b) => n.runs[b.key]?.state === 'ok').length} из ${tests.length}`] : []),
    ...(last ? [`Последний запуск: ${when(last)}`] : []),
  ]
  const parts = blocks.map((b, i) => blockReport(path, b.key, b.kind, b.info, b.body, { brief: !(runs[i]?.state === 'error' || b.kind === 'pw') }))
  return [...head, '', ...parts.flatMap((p) => [p, ''])].join('\n').trim()
}
