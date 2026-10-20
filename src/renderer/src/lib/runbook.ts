import { reactive, toRaw } from 'vue'
import { findBlocks } from '@shared/noteBlocks'
import { infoMd, interpolate, parseHttpText, parseInfo, publishedAnswer, type BlockInfo, type RunKind } from '@shared/runbook'
import { kv, newRequest, type HttpMethod, type HttpResponse } from '@shared/http'
import { load as yamlLoad } from 'js-yaml'
import type { PwStep } from '@shared/api'

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
  files?: string[]
  browser?: string
}
export interface NoteRun {
  ctx: Record<string, CtxItem>
  runs: Record<string, BlockRun>
  loaded: boolean
  /** «Выполнить всё» going on: the block being run. */
  all?: { at: string; done: number; total: number; error?: string }
}
const notes = reactive(new Map<string, NoteRun>())
export function noteRun(path: string): NoteRun {
  let n = notes.get(path)
  if (!n) {
    notes.set(path, { ctx: {}, runs: {}, loaded: false })
    n = notes.get(path)!
    const nr = n
    void window.qa
      .runLoad(path)
      .then((json) => {
        if (json) {
          const d = JSON.parse(json) as Partial<NoteRun>
          // what was going on when the app closed is not going on now
          for (const r of Object.values(d.runs ?? {})) if (r.state === 'run') r.state = 'error'
          nr.ctx = { ...(d.ctx ?? {}), ...nr.ctx }
          nr.runs = { ...(d.runs ?? {}), ...nr.runs }
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
    json = JSON.stringify({ ctx: n.ctx, runs: n.runs })
  } catch {
    return Promise.resolve()
  }
  return window.qa.runSave(path, json).catch(() => undefined)
}
function persist(path: string): void {
  clearTimeout(timers.get(path))
  timers.set(
    path,
    setTimeout(() => void writeRuns(path), 800),
  )
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
  n.ctx = {}
  n.runs = {}
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

const running = new Map<string, string>()
/** A request block run: its templates filled from the context (the HTTP section's variables fill the rest). */
export async function runHttp(path: string, key: string, name: string | undefined, text: string): Promise<boolean> {
  const n = noteRun(path)
  const ctx = ctxValues(path)
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
  const runId = `${path}#${key}#${Date.now()}`
  running.set(`${path}#${key}`, runId)
  n.runs[key] = { state: 'run', at: Date.now(), request: { method: req.method, url, headers, body, missing } }
  try {
    const doc = await window.qa.httpLoad()
    const out = await window.qa.httpRun(req, doc, runId)
    if (running.get(`${path}#${key}`) !== runId) return false
    const ok = !out.error && !!out.response
    n.runs[key] = { ...n.runs[key], state: ok ? 'ok' : 'error', ms: out.response?.time, response: out.response, error: out.error, logs: out.logs.map((t) => ({ level: 'log', text: t })) }
    if (out.response && name) publish(path, name, publishedAnswer(out.response), 'http', key)
    persist(path)
    return ok
  } catch (e) {
    n.runs[key] = { ...n.runs[key], state: 'error', error: errText(e) }
    persist(path)
    return false
  } finally {
    running.delete(`${path}#${key}`)
  }
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
    if (b.kind !== 'http' && b.kind !== 'code' && b.kind !== 'pw') continue
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
export async function runCode(path: string, key: string, name: string | undefined, lang: string, code: string, noteText: string, timeoutSec?: number): Promise<boolean> {
  const n = noteRun(path)
  const libs = libsOf(noteText, code)
  const runId = `${path}#${key}`
  n.runs[key] = { state: 'run', at: Date.now() }
  try {
    const r = await window.qa.runCode(runId, { code, ts: lang.startsWith('t'), libs, ctx: ctxValues(path), runs: runsOf(path, noteText, key), timeoutSec })
    n.runs[key] = { state: r.ok ? 'ok' : 'error', at: Date.now(), ms: r.ms, logs: r.logs, error: r.error, value: r.value, hasValue: r.hasValue }
    if (r.ok && name && r.hasValue) publish(path, name, r.value, 'code', key)
    for (const [k, v] of Object.entries(r.sets ?? {})) publish(path, k, v, 'set', key)
    persist(path)
    return r.ok
  } catch (e) {
    n.runs[key] = { state: 'error', at: Date.now(), error: errText(e) }
    persist(path)
    return false
  }
}
// the steps of the Playwright runs going on
let pwListening = false
function listenPw(): void {
  if (pwListening) return
  pwListening = true
  window.qa.onPwProgress((runId, steps) => {
    const i = runId.lastIndexOf('#')
    const r = notes.get(runId.slice(0, i))?.runs[runId.slice(i + 1)]
    if (r?.state === 'run') r.steps = steps
  })
}
/** A Playwright block: the installed browser driven in a process of its own; its return value and set() published. */
export async function runPw(path: string, key: string, info: BlockInfo, code: string, noteText: string): Promise<boolean> {
  listenPw()
  const n = noteRun(path)
  const runId = `${path}#${key}`
  n.runs[key] = { state: 'run', at: Date.now(), steps: [] }
  try {
    const r = await window.qa.runPw(runId, {
      code,
      ts: info.lang.startsWith('t'),
      libs: libsOf(noteText, code),
      ctx: ctxValues(path),
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
    n.runs[key] = { state: r.ok ? 'ok' : 'error', at: Date.now(), ms: r.ms, logs: r.logs, error: r.error, value: r.value, hasValue: r.hasValue, steps: r.steps, files: r.files, browser: r.browser }
    if (r.ok && info.name && r.hasValue) publish(path, info.name, r.value, 'pw', key)
    for (const [k, v] of Object.entries(r.sets ?? {})) publish(path, k, v, 'set', key)
    persist(path)
    return r.ok
  } catch (e) {
    n.runs[key] = { state: 'error', at: Date.now(), error: errText(e) }
    persist(path)
    return false
  }
}
/** A run stopped: the request aborted / the code's process killed / the browser closed. */
export function stopBlock(path: string, key: string): void {
  const id = running.get(`${path}#${key}`)
  if (id) void window.qa.httpAbort(id)
  window.qa.runCodeStop(`${path}#${key}`)
  window.qa.runPwStop(`${path}#${key}`)
}
let stopAll = false
/** Every block from the top, in order; the first failing one stops it. */
export async function runAll(path: string, text: string): Promise<void> {
  const n = noteRun(path)
  syncData(path, text)
  const blocks = findBlocks(text.split('\n')).filter((b) => b.kind === 'http' || b.kind === 'code' || b.kind === 'pw')
  const list = blocks
    .map((b) => {
      const lines = b.src.split('\n')
      return { b, info: parseInfo(lines[0].replace(/^(`{3,}|~{3,})/, '')), body: lines.slice(1, -1).join('\n') }
    })
    .filter((x) => !x.info.lib)
  stopAll = false
  n.all = { at: '', done: 0, total: list.length }
  for (const [i, x] of list.entries()) {
    if (stopAll) {
      n.all = { ...n.all, error: 'Остановлено' }
      return
    }
    const key = runKey(x.info.name, x.b.kind, x.b.line0)
    n.all = { at: key, done: i, total: list.length }
    const ok =
      x.b.kind === 'http'
        ? await runHttp(path, key, x.info.name, x.body)
        : x.b.kind === 'pw'
          ? await runPw(path, key, x.info, x.body, text)
          : await runCode(path, key, x.info.name, x.info.lang, x.body, text, x.info.timeout)
    // a «soft» block's error is expected — the rest go on
    if (!ok && !x.info.soft) {
      n.all = { at: key, done: i, total: list.length, error: n.runs[key]?.error ?? 'Ошибка' }
      return
    }
  }
  n.all = undefined
}
export function stopRunAll(path: string): void {
  stopAll = true
  const at = noteRun(path).all?.at
  if (at) stopBlock(path, at)
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
const KIND_RU: Record<string, string> = { http: 'HTTP-запрос', code: 'Код', pw: 'Тест', data: 'Данные' }
/** One block's last run as text: what was checked, how it went, the error, the result. */
export function blockReport(path: string, key: string, kind: 'http' | 'code' | 'pw', info: BlockInfo, body: string, opts: { brief?: boolean } = {}): string {
  const r = noteRun(path).runs[key]
  const title = `${KIND_RU[kind]} «${info.name ?? key}»`
  if (!r) return `⏸ ${title} — не запускался`
  const ok = r.state === 'ok'
  const mark = r.state === 'run' ? '⏳' : ok ? '✅' : info.soft ? '⚠️' : '❌'
  const out: string[] = []
  if (kind === 'http') {
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
    .filter((b) => b.kind === 'http' || b.kind === 'code' || b.kind === 'pw')
    .map((b) => {
      const lines = b.src.split('\n')
      const info = parseInfo(lines[0].replace(/^(`{3,}|~{3,})/, ''))
      return { kind: b.kind as 'http' | 'code' | 'pw', info, body: lines.slice(1, -1).join('\n'), key: runKey(info.name, b.kind, b.line0) }
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
