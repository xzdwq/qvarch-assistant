import { gen } from '../../shared/gen'
import vm from 'node:vm'
import { isName, plain, sandboxConsole, wrapBody, type SandboxLog } from './sandbox'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { expect } from 'playwright/test'
import { makeQa } from './qaRuntime'
import type { MatrixOpts, MatrixOutcome } from './qa/fieldMatrixCheck'
import { readMatrix } from '../../shared/qaChecks'
import { fingerprint, matrixScenarioSig } from '../../shared/qaMatrixQuery'
import { Emitter } from './emitter'
import type { QaCheck } from '../../shared/qaChecks'
import type { PwBrowser } from '../../notebook/domain/blockInfo'
import { checkFailed, pageClosed, PW_LAUNCH } from './pwBrowsers'

/**
 * A notebook's Playwright block, run in a process of its own (one per run): the installed Edge / Chrome is
 * driven headless (or shown — «headed»), the code gets page, context, browser, expect (Playwright's own),
 * step(name, fn), set(), emit() (a variable gathered as it goes), the context's values. What is left in `dir`: a screenshot (the last page, or the one it
 * failed on), the trace (trace.zip — Trace Viewer) and Allure results (allure-results/).
 * The app asks it to stop with a message; it closes the browser and answers — or is killed.
 */
interface Job {
  code: string
  ts: boolean
  libs: Array<{ code: string; ts: boolean }>
  ctx: Record<string, unknown>
  runs?: Record<string, unknown>
  dir: string
  /** The notebook's test files' folder (qa.file('Набор/файл')). */
  files?: string
  /** The block's name and the note's — Allure's test and suite. */
  name: string
  suite: string
  browser: PwBrowser
  /** The app's own browser (browser=qvarch): the bridge to the page lent, and where that page is. */
  own?: { url: string; label: string }
  headed: boolean
  trace: boolean
  ignoreHTTPSErrors: boolean
  /** The Браузер section's cookies (Playwright's form) — its sign-ins. */
  cookies?: Array<Record<string, unknown>>
  /** Its sites' localStorage (Playwright's storageState origins) — their settings, as in the Браузер. */
  storage?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>
  /** What its run before gave (a matrix's outcomes — kept while their inputs are the same). */
  memo?: unknown
  /** Values to run anew though remembered (their labels or values). */
  recheck?: string[]
}

/**
 * How this run's matrix goes: the outcomes of the run before (the block's value then), what they depend on — the
 * scenario without its values, each value's writing in the code (a generated one is new each run, its writing is
 * not) — and the values asked to run anew.
 */
function matrixRunOf(job: Job): MatrixOpts {
  const mx = readMatrix(job.code)
  const keys = mx ? Object.fromEntries(mx.fields.map((f) => [f.id, f.cases.map((c) => fingerprint(`${f.id}\u0000${c.label}\u0000${c.expr}`))])) : undefined
  const memo = Array.isArray(job.memo) ? (job.memo as MatrixOutcome[]) : undefined
  return { sig: matrixScenarioSig(job.code), ...(keys ? { keys } : {}), ...(memo ? { memo } : {}), ...(job.recheck?.length ? { recheck: job.recheck } : {}) }
}
type Log = SandboxLog
export interface PwStep {
  name: string
  depth: number
  start: number
  ms?: number
  state: 'run' | 'ok' | 'error'
  error?: string
}

const port = process.parentPort
const ansi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')

let browser: Browser | undefined
let context: BrowserContext | undefined
let stopped = false

port.on('message', (e: { data: { type: 'run'; job: Job } | { type: 'stop' } }) => {
  const m = e.data
  switch (m.type) {
    case 'run':
      void run(m.job)
      break
    case 'stop':
      stopped = true
      // the actions going on fail at once; the run ends with what it has
      void browser?.close().catch(() => undefined)
      break
  }
})

async function run(job: Job): Promise<void> {
  const t0 = performance.now()
  const started = Date.now()
  const logs: Log[] = []
  const sets: Record<string, unknown> = {}
  // (the parts as they come: { type: 'emit', batch } before 'done' — which says how many there were)
  const out = new Emitter((batch) => port.postMessage({ type: 'emit', batch }), plain)
  const steps: PwStep[] = []
  /** The ready checks' results (qa.…). */
  const checks: QaCheck[] = []
  let depth = 0
  let lastSent = 0
  const progress = (force = false) => {
    if (!force && performance.now() - lastSent < 250) return
    lastSent = performance.now()
    port.postMessage({ type: 'progress', steps })
  }
  const cons = sandboxConsole(logs)
  /** A named step: shown while it goes, in the trace (a group) and in Allure. */
  async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    const s: PwStep = { name: String(name).slice(0, 300), depth, start: Date.now(), state: 'run' }
    steps.push(s)
    progress(true)
    depth++
    await context?.tracing.group(s.name).catch(() => undefined)
    try {
      const v = await fn()
      s.state = 'ok'
      return v
    } catch (err) {
      s.state = 'error'
      s.error = ansi(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 500)
      throw err
    } finally {
      s.ms = Date.now() - s.start
      depth--
      await context?.tracing.groupEnd().catch(() => undefined)
      progress(true)
    }
  }

  let page: Page | undefined
  let value: unknown
  /** What a ready check gathered (the field matrix: each value's outcome) — the block's value when it returns none. */
  let checkValue: unknown
  let error: string | undefined
  let failed: 'failed' | 'broken' | undefined
  let stack: string | undefined
  try {
    mkdirSync(job.dir, { recursive: true })
    const own = job.own
    await step(own ? own.label : `Запуск ${PW_LAUNCH[job.browser].label}${job.headed ? ' (с окном)' : ''}`, async () => {
      const got = own ? await lentPage(own.url) : await installed(job, logs)
      browser = got.browser
      context = got.context
      if (job.trace) await context.tracing.start({ screenshots: true, snapshots: true, sources: false, title: job.name })
      page = got.page ?? (await context.newPage())
      // a click that opens the system's file window (a «Загрузить» button) — the window is never shown: the files go by
      // setInputFiles / qa.dropFiles
      page.on('filechooser', () => undefined)
    })
    if (stopped) throw new Error('Остановлено')
    const vars = Object.fromEntries(Object.entries(job.ctx).filter(([k]) => isName(k)))
    const sandbox = vm.createContext({
      ...vars,
      ctx: job.ctx,
      runs: job.runs ?? {},
      page,
      context,
      browser,
      expect,
      qa: makeQa(page!, step, checks, job.dir, job.files ?? '', (v) => (checkValue = v), matrixRunOf(job)),
      gen,
      devices,
      step,
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
    const main = wrapBody(libs ? `${libs}\n${job.code}` : job.code, job.ts || job.libs.some((l) => l.ts), '__block')
    value = await vm.runInContext(`${main}\n__block()`, sandbox, { filename: 'блок', lineOffset: -1 - libLines })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    // the app's page gone from under the run (its note closed, its tab closed)
    const lost = !!job.own && pageClosed(err, raw)
    const msg = stopped ? 'Остановлено' : lost ? `Страница, в которой шёл сценарий, закрыта (заметка или вкладка закрыты): ${ansi(raw).split('\n')[0]}` : ansi(err instanceof Error && err.name !== 'Error' ? `${err.name}: ${raw}` : raw)
    const at = err instanceof Error ? /блок:(\d+)/.exec(err.stack ?? '')?.[1] : undefined
    // (a ready check failing says what and where itself — its line in the runtime is not the scenario's)
    error = at && !stopped && !/^Проверка «/.test(msg) ? `${msg}\n(строка ${at})` : msg
    stack = err instanceof Error ? ansi(err.stack ?? '') : undefined
    // an expect that failed — the test failed; anything else — it broke
    failed = !stopped && checkFailed(err, raw) ? 'failed' : 'broken'
    for (const s of steps) if (s.state === 'run') ((s.state = 'error'), (s.ms = Date.now() - s.start))
  }

  // (the scenario returns nothing of its own: what its check gathered is its value — every value of the matrix at once)
  if (value === undefined && checkValue !== undefined) value = checkValue
  // what is left: the screenshot, the trace, the Allure results
  const files: string[] = []
  /** With the Браузер's sign-ins: the cookies as the run left them (a site may have renewed its session). */
  let outCookies: unknown[] | undefined
  await (async () => {
    const shot = error ? 'failure.png' : 'final.png'
    if (page && !page.isClosed() && !stopped) {
      try {
        await page.screenshot({ path: join(job.dir, shot), timeout: 5000 })
        files.push(shot)
      } catch {
        // the page is gone
      }
    }
    if (job.trace && context && !stopped) {
      try {
        await context.tracing.stop({ path: join(job.dir, 'trace.zip') })
        files.push('trace.zip')
      } catch {
        // the browser is gone
      }
    }
    if (job.cookies && context) outCookies = await context.cookies().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    try {
      writeAllure(job, { started, stopped: Date.now(), steps, error, stack, status: error ? (failed ?? 'broken') : 'passed', files, logs })
      files.push('allure-results')
    } catch {
      // the results are an extra
    }
  })()
  const emits = out.close()
  port.postMessage({
    type: 'done',
    result: { ok: !error, value: plain(value), hasValue: value !== undefined, sets: plain(sets), logs, steps, checks, error, ms: performance.now() - t0, files, browser: browser?.version(), emits, ...(outCookies ? { cookies: outCookies } : {}) },
  })
}

/** An installed Edge / Chrome (or the downloaded Chromium) started, a context of its own — with the Браузер's sign-ins if asked. */
async function installed(job: Job, logs: Log[]): Promise<{ browser: Browser; context: BrowserContext; page?: Page }> {
  const how = PW_LAUNCH[job.browser]
  let b: Browser
  try {
    b = await chromium.launch({ channel: how.channel, headless: !job.headed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // (Playwright says «not installed» only in its message: no error class of its own)
    if (/executable doesn't exist|is not found|not installed|Chromium distribution/i.test(msg)) throw new Error(how.missing)
    throw err
  }
  // (known at once: a stop meanwhile closes it)
  browser = b
  const ctx = await b.newContext({ ignoreHTTPSErrors: job.ignoreHTTPSErrors, viewport: { width: 1280, height: 800 }, ...(job.storage?.length ? { storageState: { cookies: [], origins: job.storage } } : {}) })
  if (job.storage?.length) logs.push({ level: 'info', text: `localStorage из Браузера: ${job.storage.map((o) => `${o.origin} (${o.localStorage.length})`).join(', ')}` })
  if (job.cookies?.length) {
    // one by one: a cookie Chromium refuses (an odd one) does not lose the rest
    let ok = 0
    for (const c of job.cookies) ok += await ctx.addCookies([c as never]).then(() => 1, () => 0)
    logs.push({ level: 'info', text: `Вход из Браузера: ${ok} cookie` })
  }
  return { browser: b, context: ctx }
}
/**
 * The app's own page, through the bridge the app opened for this run: its one context, its one page — as it is
 * now (its size, its sign-ins). Closing the browser after only lets it go.
 */
async function lentPage(url: string): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const b = await chromium.connectOverCDP(url, { isLocal: true, timeout: 30_000 })
  browser = b
  const ctx = b.contexts()[0]
  const p = ctx?.pages()[0]
  if (!p) throw new Error('Страница браузера Qvarch не досталась сценарию')
  return { browser: b, context: ctx, page: p }
}

/** Allure 2 results (allure-results/<uuid>-result.json + attachments): `allure serve` / Allure TestOps take them. */
function writeAllure(
  job: Job,
  r: { started: number; stopped: number; steps: PwStep[]; error?: string; stack?: string; status: 'passed' | 'failed' | 'broken'; files: string[]; logs: Log[] },
): void {
  const out = join(job.dir, 'allure-results')
  mkdirSync(out, { recursive: true })
  const attach = (name: string, type: string, ext: string, data: Buffer | string) => {
    const source = `${randomUUID()}-attachment.${ext}`
    writeFileSync(join(out, source), data)
    return { name, source, type }
  }
  type AStep = { name: string; status: string; stage: 'finished'; start: number; stop: number; steps: AStep[]; attachments: unknown[]; parameters: unknown[]; statusDetails?: { message: string } }
  const root: AStep[] = []
  const stack: AStep[][] = [root]
  for (const s of r.steps) {
    stack.length = Math.min(stack.length, s.depth + 1)
    const a: AStep = { name: s.name, status: s.state === 'ok' ? 'passed' : 'failed', stage: 'finished', start: s.start, stop: s.start + (s.ms ?? 0), steps: [], attachments: [], parameters: [] }
    if (s.error) a.statusDetails = { message: s.error }
    ;(stack[stack.length - 1] ?? root).push(a)
    stack.push(a.steps)
  }
  const attachments = []
  for (const f of r.files) {
    if (f.endsWith('.png')) attachments.push(attach(f === 'failure.png' ? 'Скриншот ошибки' : 'Скриншот', 'image/png', 'png', readFileSync(join(job.dir, f))))
    else if (f === 'trace.zip') attachments.push(attach('trace', 'application/vnd.allure.playwright-trace', 'zip', readFileSync(join(job.dir, f))))
  }
  if (r.logs.length) attachments.push(attach('Консоль', 'text/plain', 'txt', r.logs.map((l) => `[${l.level}] ${l.text}`).join('\n')))
  const fullName = `${job.suite} › ${job.name}`
  const uuid = randomUUID()
  const result = {
    uuid,
    historyId: createHash('md5').update(fullName).digest('hex'),
    testCaseId: createHash('md5').update(fullName).digest('hex'),
    name: job.name,
    fullName,
    status: r.status,
    stage: 'finished',
    start: r.started,
    stop: r.stopped,
    steps: root,
    attachments,
    parameters: [{ name: 'browser', value: job.browser }],
    labels: [
      { name: 'suite', value: job.suite },
      { name: 'framework', value: 'playwright' },
      { name: 'language', value: job.ts ? 'typescript' : 'javascript' },
      { name: 'host', value: hostname() },
    ],
    ...(r.error ? { statusDetails: { message: r.error, trace: r.stack ?? '' } } : {}),
  }
  writeFileSync(join(out, `${uuid}-result.json`), JSON.stringify(result, null, 1))
}
