import vm from 'node:vm'
import { inspect } from 'node:util'
import { stripTypeScriptTypes } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { expect } from 'playwright/test'

/**
 * A notebook's Playwright block, run in a process of its own (one per run): the installed Edge / Chrome is
 * driven headless (or shown — «headed»), the code gets page, context, browser, expect (Playwright's own),
 * step(name, fn), set(), the context's values. What is left in `dir`: a screenshot (the last page, or the one it
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
  /** The block's name and the note's — Allure's test and suite. */
  name: string
  suite: string
  browser: 'msedge' | 'chrome' | 'chromium'
  headed: boolean
  trace: boolean
  ignoreHTTPSErrors: boolean
  /** The Браузер section's cookies (Playwright's form) — its sign-ins. */
  cookies?: Array<Record<string, unknown>>
}
type Log = { level: 'log' | 'info' | 'warn' | 'error'; text: string }
export interface PwStep {
  name: string
  depth: number
  start: number
  ms?: number
  state: 'run' | 'ok' | 'error'
  error?: string
}

const port = process.parentPort
const show = (a: unknown) => (typeof a === 'string' ? a : inspect(a, { depth: 5, breakLength: 110, maxArrayLength: 200, maxStringLength: 4000 }))
function plain(v: unknown): unknown {
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
const ansi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')
function body(code: string, ts: boolean): string {
  const src = `async function __block() {\n${code}\n}`
  return ts ? stripTypeScriptTypes(src, { mode: 'transform' } as unknown as { mode: 'strip' }) : src
}

let browser: Browser | undefined
let context: BrowserContext | undefined
let stopped = false

port.on('message', (e: { data: { type: 'run'; job: Job } | { type: 'stop' } }) => {
  const m = e.data
  if (m.type === 'run') void run(m.job)
  else if (m.type === 'stop') {
    stopped = true
    // the actions going on fail at once; the run ends with what it has
    void browser?.close().catch(() => undefined)
  }
})

async function run(job: Job): Promise<void> {
  const t0 = performance.now()
  const started = Date.now()
  const logs: Log[] = []
  const sets: Record<string, unknown> = {}
  const steps: PwStep[] = []
  let depth = 0
  let lastSent = 0
  const progress = (force = false) => {
    if (!force && performance.now() - lastSent < 250) return
    lastSent = performance.now()
    port.postMessage({ type: 'progress', steps })
  }
  const log = (level: Log['level']) => (...a: unknown[]) => {
    if (logs.length < 2000) logs.push({ level, text: a.map(show).join(' ').slice(0, 20000) })
  }
  const cons = { log: log('log'), info: log('info'), debug: log('log'), warn: log('warn'), error: log('error'), table: (d: unknown) => logs.push({ level: 'log', text: show(d) }), dir: log('log') }
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
  let error: string | undefined
  let failed: 'failed' | 'broken' | undefined
  let stack: string | undefined
  try {
    mkdirSync(job.dir, { recursive: true })
    await step(`Запуск ${job.browser === 'msedge' ? 'Edge' : job.browser === 'chrome' ? 'Chrome' : 'Chromium'}${job.headed ? ' (с окном)' : ''}`, async () => {
      try {
        browser = await chromium.launch({ channel: job.browser === 'chromium' ? undefined : job.browser, headless: !job.headed })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/executable doesn't exist|is not found|not installed|Chromium distribution/i.test(msg))
          throw new Error(job.browser === 'msedge' ? 'Не найден Microsoft Edge — укажите browser=chrome в строке блока' : job.browser === 'chrome' ? 'Не найден Google Chrome — уберите browser=chrome (будет Edge)' : 'Chromium не скачан — используйте Edge или Chrome')
        throw err
      }
      context = await browser.newContext({ ignoreHTTPSErrors: job.ignoreHTTPSErrors, viewport: { width: 1280, height: 800 } })
      if (job.cookies?.length) {
        // one by one: a cookie Chromium refuses (an odd one) does not lose the rest
        let ok = 0
        for (const c of job.cookies) ok += await context.addCookies([c as never]).then(() => 1, () => 0)
        logs.push({ level: 'info', text: `Вход из Браузера: ${ok} cookie` })
      }
      if (job.trace) await context.tracing.start({ screenshots: true, snapshots: true, sources: false, title: job.name })
      page = await context.newPage()
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
      devices,
      step,
      console: cons,
      set: (k: string, v: unknown) => {
        if (!isName(k)) throw new Error(`set: «${k}» — не имя переменной`)
        sets[k] = v
      },
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
    const main = body(libs ? `${libs}\n${job.code}` : job.code, job.ts || job.libs.some((l) => l.ts))
    value = await vm.runInContext(`${main}\n__block()`, sandbox, { filename: 'блок', lineOffset: -1 - libLines })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const msg = stopped ? 'Остановлено' : ansi(err instanceof Error && err.name !== 'Error' ? `${err.name}: ${raw}` : raw)
    const at = err instanceof Error ? /блок:(\d+)/.exec(err.stack ?? '')?.[1] : undefined
    error = at && !stopped ? `${msg}\n(строка ${at})` : msg
    stack = err instanceof Error ? ansi(err.stack ?? '') : undefined
    // an expect that failed — the test failed; anything else — it broke
    failed = !stopped && /expect\(|toHave|toBe|toEqual|toContain|toMatch/.test(raw) ? 'failed' : 'broken'
    for (const s of steps) if (s.state === 'run') ((s.state = 'error'), (s.ms = Date.now() - s.start))
  }

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
  port.postMessage({
    type: 'done',
    result: { ok: !error, value: plain(value), hasValue: value !== undefined, sets: plain(sets), logs, steps, error, ms: performance.now() - t0, files, browser: browser?.version(), ...(outCookies ? { cookies: outCookies } : {}) },
  })
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
