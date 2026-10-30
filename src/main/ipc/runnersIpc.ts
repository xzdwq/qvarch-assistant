import { rmSync } from 'node:fs'
import type { WebContents } from 'electron'
import type { EmitBatch } from '../../notebook/domain/emits'
import type { QaApi, PwResult, PwStep } from '../../shared/api'
import { PW_BROWSERS } from '../../notebook/domain/blockInfo'
import { LOOP_MAX, LOOP_MAX_LIMIT, LOOP_PARALLEL_LIMIT, type LoopResult } from '../../notebook/domain/loop'
import type { AppContext } from '../app/appContext'
import { ProcessSupervisor } from '../process/processSupervisor'
import { browserCookies, cookiesBack, originsOf } from '../runner/pwSession'
import { sweepPwLeftovers } from '../runner/pwLeftovers'
import { emit, handle, listen } from './router'

/**
 * The notebook's runs in processes of their own: a code block, a loop's head (each pass it asks for — to the window
 * that runs the note), a Playwright scenario (asked to stop first: it closes its browser). Watched by supervisors.
 */
type CodeResult = Awaited<ReturnType<QaApi['runCode']>>
const str = (v: unknown) => String(v ?? '')
/** A run's emit() batch (any runner's process sends them the same way). */
const isEmit = (m: unknown): m is { type: 'emit'; batch: EmitBatch } => !!m && (m as { type?: unknown }).type === 'emit'
/** The batch on to the window that runs the note (sent before the run's end: the same channel keeps the order). */
const passEmit = (to: WebContents, runId: string, batch: EmitBatch) => void (!to.isDestroyed() && emit(to, 'onRunEmit', runId, batch))

export function registerRunnersIpc(app: AppContext): (reason: string) => void {
  const code = new ProcessSupervisor<CodeResult>({
    script: () => app.script('codeWorker.js'),
    serviceName: 'Qvarch Code',
    memoryMb: 512,
    failure: (error, ms) => ({ ok: false, error, logs: [], ms }),
    stop: { kind: 'kill' },
    restart: 'kill',
  })
  handle('runCode', (e, runId, job) => {
    const sec = Math.min(3600, Math.max(1, Number(job.timeoutSec) || 30))
    return code.start(str(runId), {
      job: { code: str(job.code), ts: !!job.ts, libs: Array.isArray(job.libs) ? job.libs : [], ctx: job.ctx ?? {}, runs: job.runs ?? {} },
      timeoutSec: sec,
      timeoutError: `Остановлено: дольше ${sec} с (timeout=… в строке блока — дать больше)`,
      owner: e.sender,
      onMessage: (m, run) => (isEmit(m) ? passEmit(e.sender, str(runId), m.batch) : run.finish(m as CodeResult)),
      exitError: (c) => (c ? `Процесс выполнения завершился (код ${c}) — возможно, не хватило памяти (предел 512 МБ)` : 'Процесс выполнения завершился'),
    })
  })
  listen('runCodeStop', (_e, runId) => code.stop(str(runId), 'Остановлено'))

  const loop = new ProcessSupervisor<LoopResult>({
    script: () => app.script('loopWorker.js'),
    serviceName: 'Qvarch Loop',
    memoryMb: 512,
    failure: (error, ms) => ({ ok: false, error, logs: [], passes: 0, ms }),
    stop: { kind: 'kill' },
    restart: 'kill',
  })
  handle('runLoop', (e, runId, job) => {
    const id = str(runId)
    const sec = Math.min(86_400, Math.max(1, Number(job.timeoutSec) || 600))
    return loop.start(id, {
      job: {
        type: 'start',
        job: {
          head: str(job.head),
          ts: !!job.ts,
          libs: Array.isArray(job.libs) ? job.libs : [],
          ctx: job.ctx ?? {},
          parallel: Math.min(LOOP_PARALLEL_LIMIT, Math.max(1, Math.floor(Number(job.parallel)) || 1)),
          max: Math.min(LOOP_MAX_LIMIT, Math.max(1, Math.floor(Number(job.max)) || LOOP_MAX)),
        },
      },
      timeoutSec: sec,
      timeoutError: `Остановлено: цикл дольше ${sec} с (timeout=… в начале цикла — дать больше)`,
      owner: e.sender,
      onMessage: (raw, run) => {
        const m = raw as { type: 'pass'; n: number; vars: Record<string, unknown> } | { type: 'end'; result: LoopResult }
        if (isEmit(raw)) passEmit(e.sender, id, raw.batch)
        else if (m?.type === 'pass') {
          if (!e.sender.isDestroyed()) emit(e.sender, 'onLoopPass', id, m.n, m.vars)
          // (no window to run the pass — the loop has nothing to go on with)
          else run.finish({ ok: false, error: 'Окно закрыто', logs: [], passes: 0, ms: 0 })
        } else if (m?.type === 'end') run.finish(m.result)
      },
      exitError: (c) => (c ? `Процесс цикла завершился (код ${c}) — возможно, не хватило памяти (предел 512 МБ)` : 'Процесс цикла завершился'),
    })
  })
  listen('runLoopPass', (_e, runId, n, result) => loop.processOf(str(runId))?.postMessage({ type: 'pass', n: Number(n), result }))
  listen('runLoopStop', (_e, runId) => loop.stop(str(runId), 'Остановлено'))

  const pw = new ProcessSupervisor<PwResult>({
    script: () => app.script('pwWorker.js'),
    serviceName: 'Qvarch Playwright',
    memoryMb: 1024,
    failure: (error, ms) => ({ ok: false, error, logs: [], ms }),
    stop: { kind: 'ask', message: { type: 'stop' }, graceMs: 8000 },
    // (a new run's files go to the same folder: the old process must not write there any more)
    restart: 'kill',
  })
  handle('runPw', async (e, runId, job) => {
    const id = str(runId)
    const browser = app.browser!
    const cookies = job?.session ? await browserCookies().catch(() => []) : undefined
    // the sites the scenario opens: their localStorage from the Браузер (a site's settings — its layout — live there)
    const origins = job?.session ? originsOf(str(job.code)) : []
    const storage = origins.length ? await browser.localStorageOf(origins).catch(() => []) : []
    const note = str(job?.note)
    const dir = app.vault.runDir(note, str(job?.key))
    if (pw.has(id)) pw.finish(id, { ok: false, error: 'Перезапущено', logs: [], ms: 0 })
    rmSync(dir, { recursive: true, force: true })
    const sec = Math.min(3600, Math.max(5, Number(job.timeoutSec) || 120))
    // (whatever this run ends with — the older leftovers taken away after it, in the background)
    return pw.start(id, {
      job: {
        type: 'run',
        job: {
          code: str(job.code),
          ts: !!job.ts,
          libs: Array.isArray(job.libs) ? job.libs : [],
          ctx: job.ctx ?? {},
          runs: job.runs ?? {},
          dir,
          files: app.files().root,
          name: str(job.name) || 'Сценарий',
          suite: (note.split('/').pop() ?? note).replace(/\.md$/i, ''),
          browser: (PW_BROWSERS as readonly string[]).includes(job.browser) ? job.browser : 'msedge',
          headed: !!job.headed,
          trace: job.trace !== false,
          ignoreHTTPSErrors: browser.settings().acceptBadCerts,
          cookies,
          storage,
        },
      },
      timeoutSec: sec,
      timeoutError: `Остановлено: дольше ${sec} с (timeout=… в строке блока — дать больше)`,
      owner: e.sender,
      onMessage: (raw, run) => {
        const m = raw as { type: 'progress'; steps?: PwStep[] } | { type: 'done'; result?: PwResult }
        if (isEmit(raw)) passEmit(e.sender, id, raw.batch)
        else if (m?.type === 'progress') emit(e.sender, 'onPwProgress', id, m.steps ?? [])
        else if (m?.type === 'done' && m.result) {
          const r = m.result as PwResult & { cookies?: unknown }
          const got = r.cookies
          // the cookies never go further (not to the window, not into the saved runs)
          delete r.cookies
          if (!cookies || !got) return run.finish(r)
          void cookiesBack(cookies, got).then(
            (n) => {
              if (n) r.logs = [...r.logs, { level: 'info', text: `Вход сохранён в Браузер: обновлено cookie — ${n}` }]
              run.finish(r)
            },
            () => run.finish(r),
          )
        }
      },
      exitError: (c) => (c ? `Процесс Playwright завершился (код ${c})` : 'Процесс Playwright завершился'),
    }).finally(() => void sweepPwLeftovers())
  })
  listen('runPwStop', (_e, runId) => pw.stop(str(runId), 'Остановлено'))
  // Playwright's temp folders runs killed before their browser closed left behind: at the start, and after a run
  void sweepPwLeftovers()
  /** Every run stopped (the app closing). */
  return (reason: string) => {
    for (const s of [code, loop, pw]) s.stopAll(reason)
  }
}
