import { app, powerMonitor, screen } from 'electron'
import { readJsonFile, writeJsonAtomic } from './fsAtomic'
import { join } from 'node:path'
import { PsHelper } from './psHelper'
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
  private prefs: TabletPrefs
  private status: TabletStatus = { state: 'off' }
  private monitors: TabletMonitor[] = []
  /** Renderers that want the live pen (the settings' test pad, a drawing surface). */
  private liveWanted = 0
  /** The active board's visible area (physical px from the window's client corner). */
  private canvasRect?: { x: number; y: number; w: number; h: number }
  private stopping = false
  private readonly helper = new PsHelper({
    name: 'tablet',
    // the script is too long for a command line: a short bootstrap reads and runs it (no execution-policy issue)
    command: () => `& ([scriptblock]::Create([IO.File]::ReadAllText('${scriptPath().replace(/'/g, "''")}', [Text.Encoding]::UTF8)))`,
    stdin: true,
    onLine: (m) => this.onHelper(m as HelperLine),
    shouldRestart: () => !this.stopping && this.prefs.enabled,
    onRestarting: () => this.setStatus({ state: 'error', message: 'Помощник планшета перезапускается' }),
    onStart: () => this.configure(),
  })

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
    return readJsonFile<Partial<TabletPrefs>>(this.file()) ?? {}
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
    writeJsonAtomic(this.file(), this.prefs, 2)
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
    // (a moment for the helper to give the tablet its own mode back)
    this.helper.stop(500)
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
    this.helper.send(o)
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
    if (this.helper.running) return
    this.stopping = false
    this.setStatus({ state: 'starting' })
    this.helper.start()
  }

  /** What each line type of the helper does. */
  private readonly helperHandlers: Record<HelperLineType, (m: HelperLine) => void> = {
    s: (m) => this.send({ type: 'sample', s: m as unknown as TabletSample }),
    keys: (m) => this.send({ type: 'keys', mask: Number(m.mask) || 0 }),
    aux: (m) => this.send({ type: 'aux', raw: String(m.raw ?? '') }),
    monitors: (m) => {
      this.monitors = (m.list as TabletMonitor[]) ?? []
      this.push()
    },
    status: (m) => this.onHelperStatus(m),
  }
  /** A line from the helper, by its type (an unknown type is ignored). */
  private onHelper(m: HelperLine): void {
    if (isHelperLineType(m.t)) this.helperHandlers[m.t](m)
  }

  /** The helper's device state: found (the restart back-off resets), still searching, or an error. */
  private onHelperStatus(m: HelperLine): void {
    switch (m.state) {
      case 'connected':
        this.helper.healthy()
        return this.setStatus({ state: 'connected', device: String(m.device ?? 'Планшет') })
      case 'searching':
        return this.setStatus({ state: 'searching' })
      default:
        return this.setStatus({ state: 'error', message: String(m.message ?? 'Ошибка') })
    }
  }
}

/** What the helper prints, one JSON per line: a pen sample, the express keys, raw aux bytes, the monitors, its state. */
const HELPER_LINE_TYPES = ['s', 'keys', 'aux', 'monitors', 'status'] as const
type HelperLineType = (typeof HELPER_LINE_TYPES)[number]
type HelperLine = { t: string } & Record<string, unknown>
const isHelperLineType = (t: string): t is HelperLineType => (HELPER_LINE_TYPES as readonly string[]).includes(t)
