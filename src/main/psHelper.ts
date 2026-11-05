import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

/**
 * A long-lived PowerShell helper (the activity probe, the pen tablet): run with `-EncodedCommand` (a file execution
 * policy does not block it), its stdout read as JSON lines, started again with a growing pause when it goes away.
 */
export interface PsHelperOptions {
  /** The log's tag. */
  name: string
  /** The script to run (made anew at each start: its flags may have changed). */
  command: () => string
  /** Commands are written to it (its stdin kept open). */
  stdin?: boolean
  /** A line of JSON it printed (a broken line is skipped; a failure of this handler is logged, never swallowed). */
  onLine: (line: unknown) => void
  /** It went away by itself: true — started again after the pause. */
  shouldRestart: () => boolean
  /** It is about to be started again (a status to show). */
  onRestarting?: () => void
  /** It was started (the first time or again): what it must be told first (its configuration). */
  onStart?: () => void
}

const FIRST_PAUSE_MS = 2000
const LONGEST_PAUSE_MS = 60_000

export class PsHelper {
  private child?: ChildProcess
  private pause = FIRST_PAUSE_MS

  constructor(private readonly o: PsHelperOptions) {}

  get running(): boolean {
    return !!this.child
  }
  start(): void {
    if (this.child) return
    const encoded = Buffer.from(this.o.command(), 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: [this.o.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    this.child = child
    createInterface({ input: child.stdout! }).on('line', (line) => this.line(line))
    child.on('error', (e) => console.error(`[${this.o.name}] helper could not start`, e))
    child.stderr?.on('data', (d) => console.warn(`[${this.o.name}]`, String(d).trim()))
    child.on('exit', () => {
      if (this.child === child) this.child = undefined
      if (!this.o.shouldRestart()) return
      this.o.onRestarting?.()
      setTimeout(() => this.o.shouldRestart() && this.start(), this.pause)
      this.pause = Math.min(this.pause * 2, LONGEST_PAUSE_MS)
    })
    this.o.onStart?.()
  }
  /** Stopped: its stdin closed first, killed after `graceMs` (time to undo what it set, e.g. the tablet's mode). */
  stop(graceMs = 0): void {
    const c = this.child
    this.child = undefined
    c?.stdin?.end()
    if (graceMs) setTimeout(() => c?.kill(), graceMs)
    else c?.kill()
  }
  /** Started anew (new flags): it is killed, and its going away starts it again. */
  restart(): void {
    this.child?.kill()
  }
  /** It works: the next restart waits the shortest pause again. */
  healthy(): void {
    this.pause = FIRST_PAUSE_MS
  }
  /** A command written to it as a JSON line. */
  send(o: unknown): void {
    if (this.child?.stdin?.writable) this.child.stdin.write(`${JSON.stringify(o)}\n`)
  }

  private line(line: string): void {
    if (!line.startsWith('{')) return
    let m: unknown
    try {
      m = JSON.parse(line)
    } catch {
      return // partial or malformed line — skipped
    }
    try {
      this.o.onLine(m)
    } catch (e) {
      console.error(`[${this.o.name}] line handling failed`, e)
    }
  }
}
