import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PsHelper } from './psHelper'

export interface ProbeSample {
  t: number
  pid: number
  proc: string
  path: string
  mic: string[]
  /** Visible windows of call apps, "process\ttitle" — only when title capture is on. */
  cw?: string[]
}

function scriptPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'winprobe.ps1') : join(app.getAppPath(), 'resources', 'winprobe.ps1')
}

/**
 * Long-lived PowerShell helper that reports the foreground window and microphone users (restarted with a growing
 * pause if it dies). A change of its flags restarts it with them.
 */
export class Probe {
  private stopped = true
  private titles = false
  private keys = false
  private readonly helper = new PsHelper({
    name: 'probe',
    command: () => `& {\n${readFileSync(scriptPath(), 'utf8')}\n} -IntervalMs ${this.intervalMs} -Titles ${this.titles ? 1 : 0} -Keys ${this.keys ? 1 : 0}`,
    onLine: (raw) => this.onLine(raw as ProbeSample | { k: number[]; m?: number }),
    shouldRestart: () => !this.stopped,
  })

  constructor(
    private intervalMs: number,
    private onSample: (s: ProbeSample) => void,
    /** Moments of key presses + mouse travel since the last line (only when input counting is on). */
    private onInput: (keys: number[], mousePx: number) => void = () => {},
  ) {}

  start(): void {
    if (process.platform !== 'win32') return
    this.stopped = false
    this.helper.start()
  }

  stop(): void {
    this.stopped = true
    this.helper.stop()
  }

  /** Turning title capture on/off restarts the helper with the right flag. */
  setTitles(on: boolean): void {
    if (on === this.titles) return
    this.titles = on
    if (!this.stopped) this.helper.restart()
  }

  /** Key counting on/off restarts the helper with the right flag. */
  setKeys(on: boolean): void {
    if (on === this.keys) return
    this.keys = on
    if (!this.stopped) this.helper.restart()
  }

  setInterval(ms: number): void {
    if (ms === this.intervalMs) return
    this.intervalMs = ms
    if (!this.stopped) this.helper.restart()
  }

  /** A line of the helper: the input counted, or a sample of the foreground window. */
  private onLine(raw: ProbeSample | { k: number[]; m?: number }): void {
    if ('k' in raw) return this.onInput(Array.isArray(raw.k) ? raw.k : [], Number(raw.m) || 0)
    const s = raw
    s.mic = Array.isArray(s.mic) ? s.mic : s.mic ? [String(s.mic)] : []
    if (s.cw !== undefined) s.cw = Array.isArray(s.cw) ? s.cw.map(String) : s.cw ? [String(s.cw)] : []
    this.helper.healthy()
    this.onSample(s)
  }
}
