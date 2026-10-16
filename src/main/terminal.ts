import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { basename, dirname, join } from 'node:path'
import vm from 'node:vm'
import * as pty from '@lydell/node-pty'
import {
  compileWatch,
  lineKey,
  presetId,
  sampleVars,
  sampleWatches,
  samplePresets,
  scanBatch,
  VAR_NAME,
  BUILTIN_VARS,
  type TermAlert,
  type TermConfig,
  type TermInfo,
  type TermSession,
} from '../shared/terminal'

/**
 * The terminal's shells: PowerShell in a pseudo-console, alive until the app quits (switching sections never
 * stops them). The prompt is wrapped to report the folder, where node / npm / pnpm are and how the last command
 * ended — the line over the terminal and the status bar's light come from that. Busy = Enter pressed, the prompt
 * not back yet.
 *
 * The reactions read the output line by line, in batches (every SCAN_MS), in a sandbox with a time limit; what a
 * flood brings beyond PEND_MAX waiting is skipped (and counted) — the check never falls behind for good, the
 * memory stays bounded.
 */
const MARK = /\x1b\]633;QV;([^\x07]*)\x07/g
/** The command line was accepted — what follows is the command's output (not the echo of the typing). */
const RUN = '\x1b]633;QC\x07'
const KEEP = 400_000
/** The output goes to the window in batches (a flood of tiny messages would choke it). */
const SEND_MS = 16
const SCAN_MS = 100
/** Output waiting for the check, at most (the oldest is skipped beyond it). */
const PEND_MAX = 2_000_000
/** A batch's check, at most — longer means a regex that backtracks forever: the reactions pause. */
const SCAN_LIMIT_MS = 2000
const MAX_ALERTS = 100
/** Ctrl+C's exit code on Windows (STATUS_CONTROL_C_EXIT) — stopped by hand, not a failure. */
const CTRL_C_EXIT = new Set([-1073741510, 3221225786, 130])

interface Session {
  s: TermSession
  p: pty.IPty
  buf: string
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
  // the reactions
  pend: string[]
  pendLen: number
  scanCarry: string
  scanTimer?: NodeJS.Timeout
  /** Lines whose notice was closed, by reaction (their keys): they do not raise it again. */
  dismissed: Map<string, Set<string>>
}

/**
 * Wraps whatever prompt the profile made (oh-my-posh…): first a hidden mark with the folder, the tools, the last
 * history entry and how the command ended. `$?` is put back before the original prompt runs (it shows errors too).
 */
const INIT = `
$global:__qvOrig = $function:prompt
function global:prompt {
  $qvOk = $global:?
  $qvCode = $global:LASTEXITCODE
  Set-StrictMode -Off
  $qvH = (Get-History -Count 1).Id
  $p = $executionContext.SessionState.Path.CurrentLocation.ProviderPath
  $t = foreach ($c in 'node','npm','pnpm') { (Get-Command $c -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source }
  $m = "$([char]27)]633;QV;$p|$($t -join '|')|$qvH|$([int]$qvOk)|$qvCode$([char]7)"
  if (-not $qvOk) { Write-Error 'qv' -ErrorAction Ignore }
  $o = & $global:__qvOrig
  "$m$o"
}
# the accepted command line is reported (like VS Code's shell integration): the typing's echo ends there
if (-not (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue)) { Import-Module PSReadLine -ErrorAction SilentlyContinue }
if (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue) {
  $global:__qvRead = $function:PSConsoleHostReadLine
  function global:PSConsoleHostReadLine {
    $l = & $global:__qvRead
    [Console]::Write("$([char]27)]633;QC$([char]7)")
    $l
  }
}
`
/** What the shells must not inherit: NO_COLOR would make oh-my-posh and the tools colourless. */
const DROP_ENV = /^(NO_COLOR|ELECTRON_RUN_AS_NODE|ELECTRON_NO_ATTACH_CONSOLE|GIT_TERMINAL_PROMPT)$/i

export class Terminals {
  private sessions = new Map<string, Session>()
  private cfgFile: string
  cfg: TermConfig
  private shell: string
  private versions = new Map<string, string>()
  private alertList: TermAlert[] = []
  /** Each notice's line keys (what closing it silences). */
  private alertKeys = new Map<string, Set<string>>()
  // the reactions' sandbox
  private sandbox = vm.createContext({ cache: {} as Record<string, RegExp>, input: null as unknown })
  private scanScript = new vm.Script(`(${scanBatch.toString()})(input.raw, input.carry, input.rules, cache)`)
  private rules: Array<{ id: string; source: string; flags: string }> = []
  /** Why the reactions are paused (a regex too slow / broken). */
  watchError = ''

  constructor(
    root: string,
    private onData: (id: string, data: string, end: number) => void,
    private onState: (list: TermSession[]) => void,
    private onAlerts: (list: TermAlert[], watchError: string) => void,
  ) {
    this.cfgFile = join(root, 'terminal.json')
    this.cfg = this.read()
    this.shell = ['C:\\Program Files\\PowerShell\\7\\pwsh.exe'].find(existsSync) ?? 'powershell.exe'
    this.compileRules()
  }

  private read(): TermConfig {
    try {
      const c = JSON.parse(readFileSync(this.cfgFile, 'utf8')) as Partial<TermConfig>
      return {
        presets: Array.isArray(c.presets) ? c.presets : [],
        vars: Array.isArray(c.vars) ? c.vars : sampleVars(),
        watches: Array.isArray(c.watches) ? c.watches : sampleWatches(),
        lastCwd: c.lastCwd,
        profile: c.profile ?? true,
      }
    } catch {
      // the first start: the examples
      const c: TermConfig = { presets: samplePresets(), vars: sampleVars(), watches: sampleWatches(), profile: true }
      this.writeCfg(c)
      return c
    }
  }
  private writeCfg(c: TermConfig): void {
    const tmp = `${this.cfgFile}.tmp`
    writeFileSync(tmp, JSON.stringify(c, null, 2))
    renameSync(tmp, this.cfgFile)
  }
  setConfig(c: Partial<TermConfig>): TermConfig {
    this.cfg = { ...this.cfg, ...c }
    this.writeCfg(this.cfg)
    if (c.watches) {
      this.watchError = ''
      this.compileRules()
      this.alertsChanged()
    }
    return this.cfg
  }
  private compileRules(): void {
    this.rules = []
    for (const w of this.cfg.watches) {
      if (!w.on) continue
      try {
        const r = compileWatch(w)
        if (r) this.rules.push({ id: w.id, ...r })
      } catch (e) {
        this.watchError = `«${w.name}»: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    this.sandbox.cache = {}
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

  create(cwd?: string): TermSession {
    const dir = [cwd, this.cfg.lastCwd, homedir()].find((d) => d && existsSync(d) && statSync(d).isDirectory())!
    const id = presetId()
    const args = ['-NoLogo', ...(this.cfg.profile ? [] : ['-NoProfile']), '-NoExit', '-EncodedCommand', Buffer.from(INIT, 'utf16le').toString('base64')]
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !DROP_ENV.test(k)) env[k] = v
    env.TERM_PROGRAM = 'qvarch'
    env.COLORTERM = 'truecolor'
    const p = pty.spawn(this.shell, args, { name: 'xterm-256color', cols: 120, rows: 30, cwd: dir, env })
    const used = new Set(this.list().map((s) => s.title))
    let n = 1
    while (used.has(`pwsh ${n}`)) n++
    const ses: Session = { s: { id, title: `pwsh ${n}`, busy: false, info: { cwd: dir } }, p, buf: '', carry: '', out: '', sent: 0, pend: [], pendLen: 0, scanCarry: '', dismissed: new Map() }
    this.sessions.set(id, ses)
    p.onData((d) => this.data(ses, d))
    p.onExit(({ exitCode }) => {
      this.flush(ses)
      ses.s.exited = exitCode
      ses.s.busy = false
      if (exitCode !== 0 && !CTRL_C_EXIT.has(exitCode)) ses.s.failed = exitCode
      this.changed()
    })
    void this.refresh(ses, dir, [])
    this.changed()
    return ses.s
  }

  private data(ses: Session, d: string): void {
    ses.buf = ses.buf.length + d.length > KEEP * 1.25 ? (ses.buf + d).slice(-KEEP) : ses.buf + d
    ses.out += d
    ses.outTimer ??= setTimeout(() => this.flush(ses), SEND_MS)
    // the marks (one may be split between two chunks)
    const text = ses.carry + d
    let from = ses.carry.length
    // the command line is accepted (its echo is done): from here on — the command's own output
    const qc = text.lastIndexOf(RUN)
    if (qc >= 0) {
      ses.hook = true
      ses.running = true
      from = Math.max(from, qc + RUN.length)
      if (!ses.s.busy) {
        ses.s.busy = true
        ses.startedAt = Date.now()
        this.changed()
      }
    }
    const at = text.indexOf('\x1b]633;QV;', from)
    // the reactions read what a command printed — not the prompt and the typing
    // (no line-accepted mark — no PSReadLine — then everything after Enter)
    if ((ses.hook ? ses.running : ses.s.busy) && this.rules.length) this.toScan(ses, text.slice(from, at < 0 ? text.length : at))
    let last: string | undefined
    for (const m of text.matchAll(MARK)) last = m[1]
    const open = text.lastIndexOf('\x1b]633;Q')
    ses.carry = open >= 0 && text.indexOf('\x07', open) < 0 ? text.slice(open) : ''
    if (last === undefined) return
    const [cwd, node, npm, pnpm, hid, ok, code] = last.split('|')
    if (ses.startedAt) ses.s.lastMs = Date.now() - ses.startedAt
    ses.startedAt = undefined
    ses.s.busy = false
    ses.running = false
    // a new history entry — a command ended: well, or not (Ctrl+C is no failure)
    if (hid !== undefined && hid !== ses.hid) {
      if (ses.hid !== undefined || hid) {
        const n = Number(code)
        const failed = ok === '0' && !ses.interrupted && !CTRL_C_EXIT.has(n)
        ses.s.failed = failed ? (Number.isFinite(n) && n !== 0 ? n : 1) : undefined
      }
      ses.hid = hid
    }
    ses.interrupted = false
    // the command's last line is complete now
    if (ses.pend.length || ses.scanCarry) this.toScan(ses, '\n')
    this.scanNow(ses)
    if (cwd && cwd !== this.cfg.lastCwd) this.setConfig({ lastCwd: cwd })
    void this.refresh(ses, cwd || ses.s.info.cwd, [node, npm, pnpm])
    this.changed()
  }
  private flush(ses: Session): void {
    clearTimeout(ses.outTimer)
    ses.outTimer = undefined
    if (!ses.out) return
    const out = ses.out
    ses.out = ''
    ses.sent += out.length
    this.onData(ses.s.id, out, ses.sent)
  }

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
  kill(id: string): void {
    const ses = this.sessions.get(id)
    if (!ses) return
    clearTimeout(ses.outTimer)
    clearTimeout(ses.scanTimer)
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
  private toScan(ses: Session, d: string): void {
    if (!d) return
    ses.pend.push(d)
    ses.pendLen += d.length
    // a flood: the oldest waiting output is skipped (counted) — the check keeps up, the memory stays bounded
    while (ses.pendLen > PEND_MAX && ses.pend.length > 1) {
      const x = ses.pend.shift()!
      ses.pendLen -= x.length
      ses.s.skipped = (ses.s.skipped ?? 0) + x.length
      ses.scanCarry = ''
    }
    ses.scanTimer ??= setTimeout(() => this.scanNow(ses), SCAN_MS)
  }
  private scanNow(ses: Session): void {
    clearTimeout(ses.scanTimer)
    ses.scanTimer = undefined
    if (!ses.pend.length) return
    const raw = ses.pend.join('')
    ses.pend = []
    ses.pendLen = 0
    if (!this.rules.length || this.watchError) return
    let res: ReturnType<typeof scanBatch>
    try {
      this.sandbox.input = { raw, carry: ses.scanCarry, rules: this.rules }
      res = this.scanScript.runInContext(this.sandbox, { timeout: SCAN_LIMIT_MS }) as ReturnType<typeof scanBatch>
    } catch {
      // too long (a busy machine, a heavy regex): this batch goes unchecked — counted, no alarm, the next one is read
      ses.scanCarry = ''
      ses.s.skipped = (ses.s.skipped ?? 0) + raw.length
      this.changed()
      return
    } finally {
      this.sandbox.input = null
    }
    ses.scanCarry = res.carry
    if (!res.hits.length) return
    const now = Date.now()
    let changed = false
    for (const h of res.hits) {
      const w = this.cfg.watches.find((x) => x.id === h.id)
      if (!w) continue
      // lines whose notice was closed do not count again (a process redrawing the same line)
      const gone = ses.dismissed.get(w.id)
      const fresh = gone ? h.keys.filter(([k]) => !gone.has(k)) : h.keys
      const beyond = h.count - h.keys.reduce((s, [, n]) => s + n, 0)
      const count = fresh.reduce((s, [, n]) => s + n, 0) + beyond
      if (!count) continue
      const line = gone?.has(lineKey(h.line)) ? (fresh[fresh.length - 1]?.[2] ?? h.line) : h.line
      changed = true
      let a = this.alertList.find((x) => x.sid === ses.s.id && x.watchId === w.id)
      if (a) {
        a.count += count
        a.last = now
        a.line = line
        a.color = w.color
        a.name = w.name
      } else {
        a = { id: presetId(), sid: ses.s.id, title: ses.s.title, watchId: w.id, name: w.name, color: w.color, at: now, last: now, count, line }
        this.alertList.unshift(a)
        this.alertList.length = Math.min(this.alertList.length, MAX_ALERTS)
      }
      // the notice remembers its lines — closing it closes them
      let keys = this.alertKeys.get(a.id)
      if (!keys) this.alertKeys.set(a.id, (keys = new Set()))
      for (const [k] of fresh) if (keys.size < 500) keys.add(k)
    }
    if (changed) this.alertsChanged()
  }
  alerts(): { list: TermAlert[]; watchError: string } {
    return { list: this.alertList, watchError: this.watchError }
  }
  /** Closes a notice (or every one): its lines are remembered for its shell and reaction — they stay quiet. */
  dismiss(id?: string): void {
    for (const a of this.alertList) {
      if (id && a.id !== id) continue
      const ses = this.sessions.get(a.sid)
      const keys = this.alertKeys.get(a.id)
      if (ses && keys) {
        let gone = ses.dismissed.get(a.watchId)
        if (!gone) ses.dismissed.set(a.watchId, (gone = new Set()))
        for (const k of keys) gone.add(k)
        // bounded: the oldest are forgotten first
        while (gone.size > 2000) gone.delete(gone.values().next().value!)
      }
      this.alertKeys.delete(a.id)
    }
    this.alertList = id ? this.alertList.filter((a) => a.id !== id) : []
    this.alertsChanged()
  }
  private alertsChanged(): void {
    this.onAlerts(this.alertList, this.watchError)
  }

  // ---------- the line over the terminal ----------
  private async refresh(ses: Session, cwd: string, tools: Array<string | undefined>): Promise<void> {
    const info: TermInfo = { cwd }
    const git = gitHere(cwd)
    if (git) {
      info.branch = git.branch
      info.dirty = await gitDirty(git.root)
    }
    const pkg = findUp(cwd, 'package.json')
    if (pkg) {
      try {
        const j = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string; version?: string; engines?: { node?: string }; packageManager?: string }
        const wanted = [findUp(cwd, '.nvmrc'), findUp(cwd, '.node-version')].map((f) => (f ? readFileSync(f, 'utf8').trim() : '')).find(Boolean)
        info.project = { name: j.name, version: j.version, nodeWanted: wanted || j.engines?.node, packageManager: j.packageManager }
      } catch {
        info.project = {}
      }
    }
    const [node, npm, pnpm] = tools
    // the versions of the tools the shell would run (its PATH — fnm / nvm included); known paths are cached
    if (node) info.node = await this.version(node)
    if (pkg || node) {
      if (npm) info.npm = await this.version(npm)
      if (pnpm) info.pnpm = await this.version(pnpm)
    }
    ses.s.info = info
    this.changed()
  }
  private version(path: string): Promise<string | undefined> {
    const hit = this.versions.get(path)
    if (hit) return Promise.resolve(hit)
    return new Promise((res) => {
      // .cmd shims (npm, pnpm) need the shell
      execFile(path, ['-v'], { timeout: 6000, windowsHide: true, shell: /\.(cmd|bat)$/i.test(path) }, (err, out) => {
        const v = err ? undefined : String(out).trim().replace(/^v/, '').split(/\s+/)[0]
        if (v) this.versions.set(path, v)
        res(v)
      })
    })
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
  /** The built-in variables for a shell, then one's own (each sees those above it). */
  private scope(id: string | undefined, answers: Record<string, string>): vm.Context {
    const ses = id ? this.sessions.get(id) : undefined
    const cwd = ses?.s.info.cwd ?? this.cfg.lastCwd ?? homedir()
    const info = ses?.s.info
    const branch = info?.branch ?? ''
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    let pkg: unknown
    const pkgFile = findUp(cwd, 'package.json')
    try {
      pkg = pkgFile ? JSON.parse(readFileSync(pkgFile, 'utf8')) : undefined
    } catch {
      pkg = undefined
    }
    const root = pkgFile ? dirname(pkgFile) : cwd
    const lockfile = existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(root, 'yarn.lock')) ? 'yarn' : existsSync(join(root, 'package-lock.json')) ? 'npm' : ''
    const ctx = vm.createContext({
      currentBranch: branch,
      branch,
      task: branch.match(/[A-Z][A-Z0-9]+-\d+/)?.[0] ?? '',
      cwd,
      dir: basename(cwd),
      date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      now,
      user: userInfo().username,
      node: info?.node ?? '',
      npm: info?.npm ?? '',
      pnpm: info?.pnpm ?? '',
      dirty: info?.dirty ?? 0,
      pkg,
      lockfile,
      env: { ...process.env },
      ask: (label: string, def = '') => answers[label] ?? def,
      /** The output of a command in this folder (5 s at most). */
      sh: (command: string) => {
        try {
          return execFileSync(this.shell, ['-NoProfile', '-NoLogo', '-Command', command], { cwd, timeout: 5000, windowsHide: true, encoding: 'utf8' }).trim()
        } catch (e) {
          throw new Error(`sh(${command}): ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
        }
      },
    })
    for (const v of this.cfg.vars) {
      if (!VAR_NAME.test(v.name)) continue
      try {
        ctx[v.name] = v.js ? vm.runInContext(`(${v.value || 'undefined'})`, ctx, { timeout: 5000 }) : fill(v.value, ctx)
      } catch (e) {
        throw new Error(`${v.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return ctx
  }
  /**
   * A preset's command with its `{{ … }}` worked out (JS over the variables; ask(…) → the answers given), and the
   * inserts that came out empty (not the questions — an empty answer is meant).
   */
  render(id: string, cmd: string, answers: Record<string, string>): { text: string; empty: string[] } {
    const empty: string[] = []
    const text = fill(cmd, this.scope(id, answers), empty)
    return { text, empty }
  }
  /** Every variable's value for a shell, as text (or its error) — shown next to the variables. */
  values(id?: string): Record<string, { value?: string; error?: string }> {
    const out: Record<string, { value?: string; error?: string }> = {}
    const asks: Record<string, string> = new Proxy({}, { get: (_t, k) => `‹${String(k)}›` })
    let ctx: vm.Context
    try {
      ctx = this.scope(id, asks)
    } catch (e) {
      // one's own variable failed: the ones before it worked, it has the error
      const msg = e instanceof Error ? e.message : String(e)
      const bad = msg.split(':')[0]
      for (const v of this.cfg.vars) {
        if (v.name === bad) {
          out[v.name] = { error: msg.slice(bad.length + 2) }
          break
        }
        out[v.name] = { value: '…' }
      }
      return out
    }
    // the built-in ones first (shown short), then one's own
    for (const b of BUILTIN_VARS) {
      const v = ctx[b.name]
      out[b.name] = {
        value: b.name === 'env' ? `${Object.keys(v as object).length} переменных окружения` : b.name === 'now' ? (v as Date).toLocaleString('ru-RU') : b.name === 'pkg' ? (v ? `package.json «${(v as { name?: string }).name ?? ''}»` : '') : show(v).slice(0, 200),
      }
    }
    for (const v of this.cfg.vars) out[v.name] = VAR_NAME.test(v.name) ? { value: show(ctx[v.name]).slice(0, 200) } : { error: 'имя — латиница, цифры, _ и $, не с цифры' }
    return out
  }
}

/** A value as it goes into a command: a regex match → its group (or the whole match); nothing → empty. */
function show(v: unknown): string {
  if (Array.isArray(v)) v = v.length > 1 ? v[v.length - 1] : v[0]
  return v === null || v === undefined || v === false ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
}
function fill(text: string, ctx: vm.Context, empty?: string[]): string {
  return text.replace(/\{\{([\s\S]+?)\}\}/g, (_, expr: string) => {
    try {
      const v = show(vm.runInContext(`(${expr})`, ctx, { timeout: 5000 }))
      if (!v && empty && !/\bask\s*\(/.test(expr)) empty.push(expr.trim())
      return v
    } catch (e) {
      throw new Error(`{{${expr.trim()}}}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })
}

/** The git repository a folder is in, and its branch (read from .git, no process). */
function gitHere(cwd: string): { root: string; branch: string } | undefined {
  let d = cwd
  for (;;) {
    const g = join(d, '.git')
    if (existsSync(g)) {
      try {
        let dir = g
        // a worktree / a submodule: .git is a file "gitdir: …"
        if (statSync(g).isFile()) dir = readFileSync(g, 'utf8').replace(/^gitdir:\s*/, '').trim()
        const head = readFileSync(join(dir, 'HEAD'), 'utf8').trim()
        const m = head.match(/^ref:\s*refs\/heads\/(.+)$/)
        return { root: d, branch: m ? m[1] : head.slice(0, 7) }
      } catch {
        return undefined
      }
    }
    const up = dirname(d)
    if (up === d) return undefined
    d = up
  }
}
function gitDirty(root: string): Promise<number | undefined> {
  return new Promise((res) =>
    execFile('git', ['-C', root, 'status', '--porcelain'], { timeout: 4000, windowsHide: true }, (err, out) => res(err ? undefined : String(out).split('\n').filter(Boolean).length)),
  )
}
function findUp(cwd: string, name: string): string | undefined {
  let d = cwd
  for (;;) {
    const f = join(d, name)
    if (existsSync(f)) return f
    const up = dirname(d)
    if (up === d) return undefined
    d = up
  }
}
