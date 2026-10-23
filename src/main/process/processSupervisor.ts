import { utilityProcess, type UtilityProcess, type WebContents } from 'electron'

/**
 * Runs in processes of their own (a note's code, a loop's head, a Playwright scenario, a database query) watched the
 * same way: one process per run id (a run started again ends the old one), a time limit, a stop — at once, or asked
 * first and killed if the process does not answer — the window that asked closing ends the run, and what a replaced
 * process says late is ignored.
 */
export interface SupervisorOptions<R> {
  /** The worker script's path. */
  script: () => string
  /** Its name in the task manager. */
  serviceName: string
  /** Its memory limit (MB). */
  memoryMb: number
  /** A failed run's result (stopped, timed out, gone…). */
  failure: (error: string, ms: number) => R
  /** How a run is stopped: killed at once, or asked (this message) and killed after `graceMs` if it does not end. */
  stop: { kind: 'kill' } | { kind: 'ask'; message: unknown; graceMs: number }
  /** A run started again while the old one goes: the old one killed at once (it may share files with the new one) or stopped as usual. */
  restart: 'kill' | 'stop'
}
export interface RunOptions<R> {
  /** The first message to the process (the job). */
  job: unknown
  /** Seconds the run may take; past them it is stopped with `timeoutError`. */
  timeoutSec: number
  timeoutError: string
  /** The window that asked: closed — the run ends. */
  owner?: WebContents
  /** The process's message: `finish` ends the run with a result. */
  onMessage: (m: unknown, run: RunControl<R>) => void
  /** The error when the process exits by itself (its exit code; 0 / null — a plain exit). */
  exitError: (code: number | null) => string
}
/** What a message handler may do with its run. */
export interface RunControl<R> {
  readonly proc: UtilityProcess
  finish(r: R): void
}
interface Run<R> {
  proc: UtilityProcess
  t0: number
  done: (r: R) => void
  timer: NodeJS.Timeout
  kill?: NodeJS.Timeout
  /** Why it was stopped (an error result gets this text). */
  reason?: string
  release: () => void
}

export class ProcessSupervisor<R extends { ok: boolean; error?: string }> {
  private readonly runs = new Map<string, Run<R>>()
  constructor(private readonly opts: SupervisorOptions<R>) {}

  /** A run started in a new process; its result when it ends (it never rejects). */
  start(id: string, o: RunOptions<R>): Promise<R> {
    this.retire(id)
    return new Promise<R>((done) => {
      const proc = utilityProcess.fork(this.opts.script(), [], { serviceName: this.opts.serviceName, execArgv: [`--max-old-space-size=${this.opts.memoryMb}`, '--disable-warning=ExperimentalWarning'] })
      const timer = setTimeout(() => this.stop(id, o.timeoutError, o.timeoutSec * 1000), o.timeoutSec * 1000)
      // (the window that asked is gone: nothing waits for the run)
      const gone = () => this.finish(id, this.opts.failure('Окно закрыто', 0), proc)
      o.owner?.once('destroyed', gone)
      this.runs.set(id, { proc, t0: Date.now(), done, timer, release: () => o.owner?.off('destroyed', gone) })
      const control: RunControl<R> = { proc, finish: (r) => this.finish(id, r, proc) }
      proc.on('message', (m: unknown) => o.onMessage(m, control))
      proc.on('exit', (code) => this.finish(id, this.opts.failure(o.exitError(code), Date.now() - (this.runs.get(id)?.t0 ?? Date.now())), proc))
      proc.postMessage(o.job)
    })
  }
  /** The process of a run going on (to message it), if any. */
  processOf(id: string): UtilityProcess | undefined {
    return this.runs.get(id)?.proc
  }
  /** Whether a run is going on under this id. */
  has(id: string): boolean {
    return this.runs.has(id)
  }
  /** How many runs go on whose id passes the test. */
  count(test: (id: string) => boolean): number {
    return [...this.runs.keys()].filter(test).length
  }
  /**
   * A run ended with its result (`from` — the process that says so: a replaced process's late word is ignored). Its
   * process killed; stopped before — an error result gets the stop's reason.
   */
  finish(id: string, r: R, from?: UtilityProcess): void {
    const run = this.runs.get(id)
    if (!run || (from && run.proc !== from)) return
    this.runs.delete(id)
    this.end(run)
    run.done(run.reason && !r.ok ? { ...r, error: run.reason } : r)
  }
  /** A run stopped (`reason` — its error): killed at once, or asked and killed after the grace time. */
  stop(id: string, reason: string, ms?: number): void {
    const run = this.runs.get(id)
    if (!run || run.reason) return
    const stop = this.opts.stop
    switch (stop.kind) {
      case 'kill':
        return this.finish(id, this.opts.failure(reason, ms ?? 0))
      case 'ask':
        run.reason = reason
        run.proc.postMessage(stop.message)
        run.kill = setTimeout(() => this.finish(id, this.opts.failure(reason, Date.now() - run.t0), run.proc), stop.graceMs)
    }
  }
  /** Every run stopped (the app closing). */
  stopAll(reason: string): void {
    for (const id of [...this.runs.keys()]) this.stop(id, reason)
  }
  /** A run of this id going on, made way for a new one: answered «Перезапущено» now, its process killed or stopped. */
  private retire(id: string): void {
    const run = this.runs.get(id)
    if (!run) return
    this.runs.delete(id)
    run.release()
    clearTimeout(run.timer)
    run.done(this.opts.failure('Перезапущено', 0))
    const stop = this.opts.stop
    if (this.opts.restart === 'kill' || stop.kind === 'kill') return this.end(run)
    run.proc.postMessage(stop.message)
    clearTimeout(run.kill)
    run.kill = setTimeout(() => this.end(run), stop.graceMs)
  }
  /** A run's timers and owner let go, its process killed. */
  private end(run: Run<R>): void {
    clearTimeout(run.timer)
    clearTimeout(run.kill)
    run.release()
    try {
      run.proc.kill()
    } catch {
      // gone
    }
  }
}
