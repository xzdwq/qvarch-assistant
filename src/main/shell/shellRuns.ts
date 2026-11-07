import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { WebContents } from 'electron'
import { clixmlText, launchLocal, launchRemote, remoteKillTree, shellKindOf, takePidMark, valuesPrefix, type ShellKind, type ShellTools } from '../../shared/shell/shells'
import { OutputCollector, stripAnsi, type ShellValue } from '../../shared/shell/output'
import type { ProcessSupervisor } from '../process/processSupervisor'
import { shellEnv } from '../terminal/shellIntegration'
import { windowsShellEnv } from '../terminal/windowsEnv'
import type { SshConnections } from '../ssh/sshConnections'

/** A shell run as the window asks for it: the script (its {{ }} already references), the variables it gets. */
export interface ShellJob {
  lang: string
  script: string
  /** QA_* variables (shared/shell/shells.ts scriptEnv): given in the environment here, assigned first on a server. */
  env: Record<string, string>
  cwd?: string
  /** A saved SSH session: run on that server (none — on this PC). */
  ssh?: string
  match?: { source: string; flags: string }
  timeoutSec?: number
}
export interface ShellRunResult {
  ok: boolean
  value?: ShellValue
  error?: string
  ms: number
}
/** The worker's messages (see runner/shellWorker.ts). */
type WorkerOut = { type: 'pid'; pid: number } | { type: 'out'; stream: 'out' | 'err'; chunk: string } | { type: 'end'; exitCode: number } | { type: 'error'; message: string }
type Feed = (stream: 'out' | 'err', chunk: string) => void

/** Live output goes to the window at most this often, at most this much a stream at a time (it keeps 64 KB). */
const OUT_MS = 100
const OUT_MAX = 64 * 1024
const DEFAULT_TIMEOUT = 600

/** Where PowerShell 7 and bash are on this PC (the first that is there). */
function shellTools(): ShellTools {
  const local = process.env.LOCALAPPDATA ?? ''
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  return {
    pwsh: [join(pf, 'PowerShell', '7', 'pwsh.exe')].find(existsSync),
    bash: [join(pf, 'Git', 'bin', 'bash.exe'), join(local, 'Programs', 'Git', 'bin', 'bash.exe')].find(existsSync),
  }
}
/** A local process and everything under it killed (a run that did not end by itself: stopped, timed out, its window gone). */
const killTree = (pid: number) => void execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined)

/** A server run going on: how to stop it (asked during its connection — kept until it is up). */
interface RemoteRun {
  stop: (why: string) => void
}

/**
 * The notebook's shell runs: on this PC — a worker process under the supervisor (its time limit, its window, «Стоп»);
 * its shell's whole tree killed whenever the run ends otherwise than by itself. On a server — a command channel of the
 * session's connection; «Стоп» kills the script's whole process tree there by its id. Output gathered the same way.
 */
export class ShellRuns {
  private readonly remote = new Map<string, RemoteRun>()

  constructor(
    private readonly local: ProcessSupervisor<ShellRunResult>,
    private readonly ssh: () => SshConnections | undefined,
    private readonly sendOut: (to: WebContents, runId: string, stream: 'out' | 'err', chunk: string) => void,
  ) {}

  async run(runId: string, job: ShellJob, owner: WebContents): Promise<ShellRunResult> {
    const kind = shellKindOf(job.lang)
    if (!kind) return { ok: false, error: `Неизвестная оболочка: ${job.lang}`, ms: 0 }
    const out = new OutputCollector(job.match)
    const live = this.liveOut(owner, runId)
    const feed: Feed = (stream, chunk) => {
      out.feed(stream, chunk)
      live(stream, chunk)
    }
    const sec = Math.min(86_400, Math.max(1, Number(job.timeoutSec) || DEFAULT_TIMEOUT))
    const t0 = Date.now()
    /** The folder it runs in, as the value tells it: the block's own, else the home (here, or on the server). */
    const cwd = job.cwd || (job.ssh ? '~' : homedir())
    const ended = (exitCode: number): ShellRunResult => {
      live.flush()
      const raw = out.result(exitCode, Date.now() - t0)
      // (a Windows server's PowerShell writes its errors as CLIXML)
      const value = { ...raw, stderr: clixmlText(raw.stderr), cwd }
      const last = value.stderr.trim().split('\n').pop()
      return { ok: value.ok, value, ms: value.ms, ...(value.ok ? {} : { error: `Код выхода ${exitCode}${last ? `: ${last}` : ''}` }) }
    }
    try {
      return job.ssh ? await this.onServer(runId, job, kind, sec, feed, ended) : await this.onPc(runId, job, kind, sec, owner, feed, ended)
    } catch (e) {
      live.flush()
      return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }
    }
  }

  private async onPc(runId: string, job: ShellJob, kind: ShellKind, sec: number, owner: WebContents, feed: Feed, ended: (code: number) => ShellRunResult): Promise<ShellRunResult> {
    // a folder that is not there is an error — never the app's own folder in its place
    if (job.cwd && !(existsSync(job.cwd) && statSync(job.cwd).isDirectory())) throw new Error(`Папка запуска не найдена: ${job.cwd}`)
    const launch = launchLocal(kind, job.script, shellTools())
    // (NO_COLOR: tools that honour it print no colour codes — a block shows text, not a terminal)
    const env = { ...(await windowsShellEnv(shellEnv(process.env))), NO_COLOR: '1', ...job.env }
    let pid: number | undefined
    let byItself = false
    const r = await this.local.start(runId, {
      job: { ...launch, cwd: job.cwd || homedir(), env },
      timeoutSec: sec,
      timeoutError: `Остановлено: дольше ${sec} с (timeout=… в строке блока — дать больше)`,
      owner,
      onMessage: (raw, run) => {
        const m = raw as WorkerOut
        if (m.type === 'pid') pid = m.pid
        else if (m.type === 'out') feed(m.stream, m.chunk)
        else if (m.type === 'end') {
          byItself = true
          run.finish(ended(m.exitCode))
        } else run.finish({ ok: false, error: m.message, ms: 0 })
      },
      exitError: (c) => (c ? `Процесс оболочки завершился (код ${c})` : 'Процесс оболочки завершился'),
    })
    // stopped, timed out, run again, its window closed, its worker gone: what the shell started dies with it
    if (!byItself && pid) killTree(pid)
    return r
  }

  private async onServer(runId: string, job: ShellJob, kind: ShellKind, sec: number, feed: Feed, ended: (code: number) => ShellRunResult): Promise<ShellRunResult> {
    const conns = this.ssh()
    if (!conns || !job.ssh) throw new Error('SSH недоступен')
    const session = job.ssh
    // the block run again: its previous run on the server stops first
    this.remote.get(runId)?.stop('Запущено заново')
    let stopped: string | undefined
    const me: RemoteRun = { stop: (why) => void (stopped ??= why) }
    this.remote.set(runId, me)
    const vars = Object.fromEntries(Object.entries(job.env).map(([k, v]) => [k.replace(/^QA_/, ''), v]))
    const launch = launchRemote(kind, valuesPrefix(kind, vars) + job.script, job.cwd)
    let ch
    try {
      ch = await conns.exec(session, launch.command)
    } catch (e) {
      if (this.remote.get(runId) === me) this.remote.delete(runId)
      throw e
    }
    const release = conns.hold(session)
    return new Promise<ShellRunResult>((done) => {
      let code = -1
      let pid: number | undefined
      let errHead = ''
      const dec = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') }
      const stop = (why: string) => {
        stopped ??= why
        // the script's whole tree stopped by its id (a second command: the channel's own signal reaches its shell only)
        if (pid) void conns.exec(session, remoteKillTree(pid)).then((k) => (k.on('close', () => undefined), k.end()), () => undefined)
        try {
          ch.signal('KILL')
        } catch {
          // the server takes no signals: the tree kill above and the channel closed end it
        }
        setTimeout(() => ch.close(), pid ? 1500 : 0)
      }
      me.stop = stop
      // asked to stop while it was connecting
      if (stopped) stop(stopped)
      const timer = setTimeout(() => stop(`Остановлено: дольше ${sec} с (timeout=… в строке блока — дать больше)`), sec * 1000)
      ch.on('data', (b: Buffer) => feed('out', dec.out.write(b)))
      ch.stderr.on('data', (b: Buffer) => {
        const text = dec.err.write(b)
        // bash's first stderr line is its process id (the mark): taken out, kept for «Стоп»
        if (kind !== 'bash' || pid !== undefined) return feed('err', text)
        errHead += text
        if (!errHead.includes('\n')) return
        const m = takePidMark(errHead)
        pid = m.pid ?? 0
        if (m.rest) feed('err', m.rest)
      })
      ch.on('exit', (c: number | null) => (code = typeof c === 'number' ? c : -1))
      ch.on('close', () => {
        clearTimeout(timer)
        if (this.remote.get(runId) === me) this.remote.delete(runId)
        release()
        const r = ended(code)
        done(stopped ? { ...r, ok: false, error: stopped } : r)
      })
      ch.end(launch.stdin ?? '')
    })
  }

  stop(runId: string): void {
    const remote = this.remote.get(runId)
    if (remote) return remote.stop('Остановлено')
    this.local.stop(runId, 'Остановлено')
  }
  /** Every run stopped (the app closing): the local ones, the ones on servers. */
  stopAll(reason: string): void {
    this.local.stopAll(reason)
    for (const r of [...this.remote.values()]) r.stop(reason)
  }

  /** The output sent to the window in batches (each stream's newest part — the window keeps 64 KB), flushed at the end. */
  private liveOut(to: WebContents, runId: string) {
    const pending: Record<'out' | 'err', string> = { out: '', err: '' }
    let timer: NodeJS.Timeout | undefined
    const flush = () => {
      clearTimeout(timer)
      timer = undefined
      for (const s of ['out', 'err'] as const) {
        if (!pending[s]) continue
        this.sendOut(to, runId, s, pending[s])
        pending[s] = ''
      }
    }
    const push = (stream: 'out' | 'err', chunk: string) => {
      const t = pending[stream] + stripAnsi(chunk)
      pending[stream] = t.length > OUT_MAX ? t.slice(-OUT_MAX) : t
      timer ??= setTimeout(flush, OUT_MS)
    }
    return Object.assign(push, { flush })
  }
}
