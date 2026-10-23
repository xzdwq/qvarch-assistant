import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import * as pty from '@lydell/node-pty'
import { presetId, type TermAlert, type TermConfig, type TermSession } from '../../shared/terminal'
import { readProjectInfo, ToolVersions } from './projectInfo'
import { renderPreset, variableValues, type VariableSource } from './presetVariables'
import { commandFailure, COMMAND_ACCEPTED, isCtrlCExit, lastPromptMark, openMarkTail, PROMPT_MARK_START, shellArgs, shellEnv } from './shellIntegration'
import { TermConfigFile } from './termConfigFile'
import { newScanState, WatchScanner, type ScanState } from './watchScanner'

/** The output kept for a pane drawn again (characters; trimmed back to it past a quarter more). */
const KEEP = 400_000
/** The output goes to the window in batches (a flood of tiny messages would choke it). */
const SEND_MS = 16
const PWSH7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'

/** One shell: its public state, its pseudo-console and what is known of the command going on. */
interface Session {
  s: TermSession
  p: pty.IPty
  buf: string
  /** An unfinished mark at the end of the last chunk. */
  carry: string
  startedAt?: number
  /** Ctrl+C was pressed while the command ran. */
  interrupted?: boolean
  /** The last history entry seen (a new one — a command ran). */
  hid?: string
  /** The shell reports an accepted command line (PSReadLine is there). */
  hook?: boolean
  /** Between that report and the prompt: the command's own output. */
  running?: boolean
  out: string
  outTimer?: NodeJS.Timeout
  /** How much output went to the window so far (a pane drawn again skips what its replay held). */
  sent: number
  scan: ScanState
}

/**
 * The terminal's shells: PowerShell in a pseudo-console, alive until the app quits (switching sections never
 * stops them). The prompt is wrapped to report the folder, where node / npm / pnpm are and how the last command
 * ended — the line over the terminal and the status bar's light come from that. Busy = Enter pressed, the prompt
 * not back yet. A command's output also goes to the reactions (WatchScanner).
 */
export class Terminals {
  private sessions = new Map<string, Session>()
  private readonly cfgFile: TermConfigFile
  cfg: TermConfig
  private readonly shell: string
  private readonly versions = new ToolVersions()
  private readonly watches: WatchScanner

  constructor(
    root: string,
    private onData: (id: string, data: string, end: number) => void,
    private onState: (list: TermSession[]) => void,
    onAlerts: (list: TermAlert[], watchError: string) => void,
  ) {
    this.cfgFile = new TermConfigFile(root)
    this.cfg = this.cfgFile.read()
    this.shell = [PWSH7].find(existsSync) ?? 'powershell.exe'
    this.watches = new WatchScanner((id) => this.sessions.get(id), onAlerts, () => this.changed())
    this.watches.setWatches(this.cfg.watches, false)
  }

  /** Why the reactions are paused (a regex too slow / broken). */
  get watchError(): string {
    return this.watches.watchError
  }

  setConfig(c: Partial<TermConfig>): TermConfig {
    this.cfg = { ...this.cfg, ...c }
    this.cfgFile.write(this.cfg)
    if (c.watches) this.watches.setWatches(this.cfg.watches, true)
    return this.cfg
  }

  list(): TermSession[] {
    return [...this.sessions.values()].map((x) => x.s)
  }
  /** What a pane drawn again must show: the shell's output so far (up to `upto` sent; the rest comes as data). */
  replay(id: string): { buf: string; upto: number } {
    const ses = this.sessions.get(id)
    if (!ses) return { buf: '', upto: 0 }
    return { buf: ses.buf.slice(0, ses.buf.length - ses.out.length), upto: ses.sent }
  }

  /** A new shell in a folder (else the last one used, else home), named «pwsh N» with the first free N. */
  create(cwd?: string): TermSession {
    const dir = [cwd, this.cfg.lastCwd, homedir()].find((d) => d && existsSync(d) && statSync(d).isDirectory())!
    const id = presetId()
    const p = pty.spawn(this.shell, shellArgs(this.cfg.profile), { name: 'xterm-256color', cols: 120, rows: 30, cwd: dir, env: shellEnv(process.env) })
    const used = new Set(this.list().map((s) => s.title))
    let n = 1
    while (used.has(`pwsh ${n}`)) n++
    const ses: Session = { s: { id, title: `pwsh ${n}`, busy: false, info: { cwd: dir } }, p, buf: '', carry: '', out: '', sent: 0, scan: newScanState() }
    this.sessions.set(id, ses)
    p.onData((d) => this.data(ses, d))
    p.onExit(({ exitCode }) => {
      this.flush(ses)
      ses.s.exited = exitCode
      ses.s.busy = false
      if (exitCode !== 0 && !isCtrlCExit(exitCode)) ses.s.failed = exitCode
      this.changed()
    })
    void this.refresh(ses, dir, [])
    this.changed()
    return ses.s
  }

  /** A chunk of the shell's output: kept, sent on in a batch, its marks read (a command accepted / ended). */
  private data(ses: Session, d: string): void {
    ses.buf = ses.buf.length + d.length > KEEP * 1.25 ? (ses.buf + d).slice(-KEEP) : ses.buf + d
    ses.out += d
    ses.outTimer ??= setTimeout(() => this.flush(ses), SEND_MS)
    // the marks (one may be split between two chunks)
    const text = ses.carry + d
    let from = ses.carry.length
    // the command line is accepted (its echo is done): from here on — the command's own output
    const qc = text.lastIndexOf(COMMAND_ACCEPTED)
    if (qc >= 0) {
      ses.hook = true
      ses.running = true
      from = Math.max(from, qc + COMMAND_ACCEPTED.length)
      if (!ses.s.busy) {
        ses.s.busy = true
        ses.startedAt = Date.now()
        this.changed()
      }
    }
    const at = text.indexOf(PROMPT_MARK_START, from)
    // the reactions read what a command printed — not the prompt and the typing
    // (no line-accepted mark — no PSReadLine — then everything after Enter)
    if ((ses.hook ? ses.running : ses.s.busy) && this.watches.active) this.watches.feed(ses, text.slice(from, at < 0 ? text.length : at))
    const mark = lastPromptMark(text)
    ses.carry = openMarkTail(text)
    if (!mark) return
    // the prompt is back: the command ended
    if (ses.startedAt) ses.s.lastMs = Date.now() - ses.startedAt
    ses.startedAt = undefined
    ses.s.busy = false
    ses.running = false
    // a new history entry — a command ended: well, or not (Ctrl+C is no failure)
    if (mark.historyId !== undefined && mark.historyId !== ses.hid) {
      if (ses.hid !== undefined || mark.historyId) ses.s.failed = commandFailure(mark, !!ses.interrupted)
      ses.hid = mark.historyId
    }
    ses.interrupted = false
    this.watches.commandEnded(ses)
    if (mark.cwd && mark.cwd !== this.cfg.lastCwd) this.setConfig({ lastCwd: mark.cwd })
    void this.refresh(ses, mark.cwd || ses.s.info.cwd, mark.tools)
    this.changed()
  }
  /** The output gathered since the last batch goes to the window. */
  private flush(ses: Session): void {
    clearTimeout(ses.outTimer)
    ses.outTimer = undefined
    if (!ses.out) return
    const out = ses.out
    ses.out = ''
    ses.sent += out.length
    this.onData(ses.s.id, out, ses.sent)
  }

  /** Typing into a shell: Enter makes it busy, Ctrl+C while busy marks the command as stopped by hand. */
  write(id: string, data: string): void {
    const ses = this.sessions.get(id)
    if (!ses || ses.s.exited !== undefined) return
    if (ses.s.busy && data.includes('\x03')) ses.interrupted = true
    if (/[\r\n]/.test(data) && !ses.s.busy) {
      ses.s.busy = true
      ses.startedAt = Date.now()
      ses.interrupted = false
      this.changed()
    }
    ses.p.write(data)
  }
  resize(id: string, cols: number, rows: number): void {
    const ses = this.sessions.get(id)
    if (ses && ses.s.exited === undefined && cols > 1 && rows > 1) ses.p.resize(Math.floor(cols), Math.floor(rows))
  }
  /** A shell ended (its process killed) and forgotten. */
  kill(id: string): void {
    const ses = this.sessions.get(id)
    if (!ses) return
    clearTimeout(ses.outTimer)
    this.watches.forget(ses)
    try {
      ses.p.kill()
    } catch {
      // already gone
    }
    this.sessions.delete(id)
    this.changed()
  }
  rename(id: string, title: string): void {
    const ses = this.sessions.get(id)
    if (ses && title.trim()) ses.s.title = title.trim().slice(0, 40)
    this.changed()
  }
  /** On quit: every shell ends. */
  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
  private changed(): void {
    this.onState(this.list())
  }

  // ---------- the reactions ----------
  alerts(): { list: TermAlert[]; watchError: string } {
    return this.watches.alerts()
  }
  /** Closes a notice (or every one): its lines stay quiet for its shell and reaction. */
  dismiss(id?: string): void {
    this.watches.dismiss(id)
  }

  // ---------- the line over the terminal ----------
  private async refresh(ses: Session, cwd: string, tools: Array<string | undefined>): Promise<void> {
    ses.s.info = await readProjectInfo(cwd, tools, this.versions)
    this.changed()
  }

  /** The folders inside a folder (the path line's "next folder" list). */
  dirs(path: string): string[] {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('$') && d.name !== 'System Volume Information')
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }))
    } catch {
      return []
    }
  }

  // ---------- presets and variables ----------
  /** Where a shell's variables are worked out (no shell — the last folder used). */
  private variableSource(id: string | undefined): VariableSource {
    const ses = id ? this.sessions.get(id) : undefined
    return { cwd: ses?.s.info.cwd ?? this.cfg.lastCwd ?? homedir(), info: ses?.s.info, vars: this.cfg.vars, shell: this.shell }
  }
  /** A preset's command with its `{{ … }}` worked out for a shell, and the inserts that came out empty. */
  render(id: string, cmd: string, answers: Record<string, string>): { text: string; empty: string[] } {
    return renderPreset(this.variableSource(id), cmd, answers)
  }
  /** Every variable's value for a shell, as text (or its error). */
  values(id?: string): Record<string, { value?: string; error?: string }> {
    return variableValues(this.variableSource(id))
  }
}
