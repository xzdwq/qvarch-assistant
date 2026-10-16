import { app, powerMonitor, screen } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { clampPrefs, comboToVk, type TabletMonitor, type TabletMsg, type TabletPrefs, type TabletSample, type TabletState, type TabletStatus } from '../shared/tablet'

function scriptPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'tablet.ps1') : join(app.getAppPath(), 'resources', 'tablet.ps1')
}

/**
 * The pen tablet run by Qvarch (see shared/tablet.ts): a PowerShell helper reads the tablet and drives the mouse;
 * this side keeps the settings (data/tablet.json), starts / stops the helper and passes its news on.
 * Turned off (or Qvarch closed), the tablet stays in its vendor mode until it is switched off and on (re-plugging
 * the dongle is not enough — the wireless tablet has its own battery) — the user is told.
 */
export class TabletService {
  private child?: ChildProcess
  private prefs: TabletPrefs
  private status: TabletStatus = { state: 'off' }
  private monitors: TabletMonitor[] = []
  /** Renderers that want the live pen (the settings' test pad, a drawing surface). */
  private liveWanted = 0
  /** The active board's visible area (physical px from the window's client corner). */
  private canvasRect?: { x: number; y: number; w: number; h: number }
  private restartDelay = 2000
  private stopping = false

  constructor(
    private readonly dataDir: string,
    private readonly windowHandle: () => bigint | undefined,
    private readonly send: (msg: TabletMsg) => void,
  ) {
    this.prefs = clampPrefs(this.read())
    screen.on('display-added', () => this.cmd({ cmd: 'monitors' }))
    screen.on('display-removed', () => this.cmd({ cmd: 'monitors' }))
    screen.on('display-metrics-changed', () => this.cmd({ cmd: 'monitors' }))
    // after sleep the tablet may come back in its normal mode
    powerMonitor.on('resume', () => setTimeout(() => this.cmd({ cmd: 'reinit' }), 1500))
  }

  private file = () => join(this.dataDir, 'tablet.json')
  private read(): Partial<TabletPrefs> {
    try {
      return existsSync(this.file()) ? (JSON.parse(readFileSync(this.file(), 'utf8')) as Partial<TabletPrefs>) : {}
    } catch {
      return {}
    }
  }

  state(): TabletState {
    return { prefs: this.prefs, status: this.status, monitors: this.monitors, canvas: this.canvasRect }
  }

  /** A board shown / moved / resized / gone. */
  canvas(rect: { x: number; y: number; w: number; h: number } | undefined): void {
    const a = this.canvasRect
    if (a?.x === rect?.x && a?.y === rect?.y && a?.w === rect?.w && a?.h === rect?.h) return
    this.canvasRect = rect
    this.configure()
    this.push()
  }

  start(): void {
    if (this.prefs.enabled) this.spawn()
  }

  set(patch: Partial<TabletPrefs>): TabletState {
    const was = this.prefs.enabled
    this.prefs = clampPrefs({ ...this.prefs, ...patch })
    writeFileSync(this.file(), JSON.stringify(this.prefs, null, 2))
    if (this.prefs.enabled && !was) this.spawn()
    else if (!this.prefs.enabled && was) this.stop()
    else this.configure()
    this.push()
    return this.state()
  }

  /** The main window was (re)created — its handle for the "window" target. */
  refresh(): void {
    this.configure()
  }

  /** A renderer wants (or no longer wants) the live pen. */
  live(on: boolean): void {
    this.liveWanted = Math.max(0, this.liveWanted + (on ? 1 : -1))
    this.configure()
  }

  stop(): void {
    this.stopping = true
    this.child?.stdin?.end()
    const c = this.child
    setTimeout(() => c?.kill(), 500)
    this.child = undefined
    this.setStatus({ state: 'off' })
  }

  private push(): void {
    this.send({ type: 'state', state: this.state() })
  }
  private setStatus(s: TabletStatus): void {
    this.status = s
    this.push()
  }

  private cmd(o: Record<string, unknown>): void {
    if (this.child?.stdin?.writable) this.child.stdin.write(JSON.stringify(o) + '\n')
  }

  private configure(): void {
    const p = this.prefs
    const t = p.target
    this.cmd({
      cmd: 'config',
      kind: t.kind,
      name: t.kind === 'monitor' ? (t.name ?? '') : '',
      hwnd: t.kind === 'window' || t.kind === 'canvas' ? Number(this.windowHandle() ?? 0n) : 0,
      canvas: t.kind === 'canvas' && this.canvasRect ? [this.canvasRect.x, this.canvasRect.y, this.canvasRect.w, this.canvasRect.h] : [0, 0, 0, 0],
      fallback: p.fallback,
      keepAspect: p.keepAspect,
      rotation: p.rotation,
      click: p.click,
      button1: p.button1,
      button2: p.button2,
      keys: p.keys.map((k) => (k ? (comboToVk(k) ?? []).join(',') : '')).join(';'),
      live: this.liveWanted > 0,
    })
  }

  private spawn(): void {
    if (this.child) return
    this.stopping = false
    this.setStatus({ state: 'starting' })
    // the script is too long for a command line: a short bootstrap reads and runs it (no execution-policy issue)
    const path = scriptPath().replace(/'/g, "''")
    const encoded = Buffer.from(`& ([scriptblock]::Create([IO.File]::ReadAllText('${path}', [Text.Encoding]::UTF8)))`, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) => {
      if (!line.startsWith('{')) return
      try {
        const m = JSON.parse(line) as { t: string } & Record<string, unknown>
        if (m.t === 's') this.send({ type: 'sample', s: m as unknown as TabletSample })
        else if (m.t === 'keys') this.send({ type: 'keys', mask: Number(m.mask) || 0 })
        else if (m.t === 'aux') this.send({ type: 'aux', raw: String(m.raw ?? '') })
        else if (m.t === 'monitors') {
          this.monitors = (m.list as TabletMonitor[]) ?? []
          this.push()
        } else if (m.t === 'status') {
          const st = m.state as string
          if (st === 'connected') {
            this.restartDelay = 2000
            this.setStatus({ state: 'connected', device: String(m.device ?? 'Планшет') })
          } else if (st === 'searching') this.setStatus({ state: 'searching' })
          else this.setStatus({ state: 'error', message: String(m.message ?? 'Ошибка') })
        }
      } catch {
        // a broken line — skip
      }
    })
    child.stderr?.on('data', (d) => console.warn('[tablet]', String(d).trim()))
    child.on('exit', () => {
      if (this.child === child) this.child = undefined
      if (this.stopping || !this.prefs.enabled) return
      this.setStatus({ state: 'error', message: 'Помощник планшета перезапускается' })
      setTimeout(() => this.prefs.enabled && !this.child && this.spawn(), this.restartDelay)
      this.restartDelay = Math.min(this.restartDelay * 2, 60_000)
    })
    this.configure()
  }
}
