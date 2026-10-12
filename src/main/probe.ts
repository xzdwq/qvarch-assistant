import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export interface ProbeSample {
  t: number
  pid: number
  proc: string
  path: string
  mic: string[]
  /** Present only when title capture is on. */
  title?: string
}

function scriptPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'winprobe.ps1') : join(app.getAppPath(), 'resources', 'winprobe.ps1')
}

/**
 * Long-lived PowerShell helper that reports the foreground window and microphone users.
 * The script is passed as -EncodedCommand so a file execution policy does not block it.
 * Restarts itself with backoff if the helper dies.
 */
export class Probe {
  private child?: ChildProcess
  private stopped = true
  private restartDelay = 2000

  private titles = false
  private keys = false

  constructor(
    private intervalMs: number,
    private onSample: (s: ProbeSample) => void,
    /** Moments of key presses + mouse travel since the last line (only when input counting is on). */
    private onInput: (keys: number[], mousePx: number) => void = () => {},
  ) {}

  start(): void {
    if (process.platform !== 'win32') return
    this.stopped = false
    this.spawn()
  }

  stop(): void {
    this.stopped = true
    this.child?.kill()
    this.child = undefined
  }

  /** Turning title capture on/off restarts the helper with the right flag. */
  setTitles(on: boolean): void {
    if (on === this.titles) return
    this.titles = on
    if (!this.stopped) this.child?.kill()
  }

  /** Key counting on/off restarts the helper with the right flag. */
  setKeys(on: boolean): void {
    if (on === this.keys) return
    this.keys = on
    if (!this.stopped) this.child?.kill()
  }

  setInterval(ms: number): void {
    if (ms === this.intervalMs) return
    this.intervalMs = ms
    if (!this.stopped) {
      this.child?.kill()
    }
  }

  private spawn(): void {
    const body = readFileSync(scriptPath(), 'utf8')
    const command = `& {\n${body}\n} -IntervalMs ${this.intervalMs} -Titles ${this.titles ? 1 : 0} -Keys ${this.keys ? 1 : 0}`
    const encoded = Buffer.from(command, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) => {
      if (!line.startsWith('{')) return
      try {
        const raw = JSON.parse(line) as ProbeSample | { k: number[]; m?: number }
        if ('k' in raw) {
          this.onInput(Array.isArray(raw.k) ? raw.k : [], Number(raw.m) || 0)
          return
        }
        const s = raw
        s.mic = Array.isArray(s.mic) ? s.mic : s.mic ? [String(s.mic)] : []
        this.restartDelay = 2000
        this.onSample(s)
      } catch {
        // partial or malformed line — skip
      }
    })
    child.stderr?.on('data', (d) => console.warn('[probe]', String(d).trim()))
    child.on('exit', () => {
      if (this.child === child) this.child = undefined
      if (this.stopped) return
      setTimeout(() => !this.stopped && this.spawn(), this.restartDelay)
      this.restartDelay = Math.min(this.restartDelay * 2, 60_000)
    })
  }
}
