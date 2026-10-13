import { app, BrowserWindow, screen, shell, type Rectangle } from 'electron'
import { join } from 'node:path'
import { IPC, type IslandLayout } from '../shared/api'
import { ISLAND_PILL, ISLAND_WINDOW, nextDock, type Dock } from '../shared/island'
import { makeIcon } from './icon'

function load(win: BrowserWindow, page: 'index' | 'island'): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

/** Renderer warnings/errors end up in the main-process log. */
function forwardConsole(win: BrowserWindow, name: string): void {
  win.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error' || !app.isPackaged) console.warn(`[${name}] ${e.message}`)
  })
}

function common(): Electron.WebPreferences {
  return { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false }
}

export const TITLEBAR_HEIGHT = 38

/** Frameless main window with a custom title bar (VS Code style); native min/max/close via titleBarOverlay. */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    title: 'Qvarch Assistant',
    icon: makeIcon(64),
    backgroundColor: '#0f1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#12151d', symbolColor: '#cbd5e1', height: TITLEBAR_HEIGHT },
    webPreferences: common(),
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  load(win, 'index')
  forwardConsole(win, 'main')
  return win
}

function intersects(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * The "dynamic island".
 * The window has a fixed size, is transparent and click-through everywhere except the visible content
 * (the renderer reports that rectangle). Pill ↔ panel morphing is pure CSS — no window resizing.
 * Position is persisted as the top-left of the collapsed pill; the window is placed around it, so the pill
 * stays put; the content grows downward unless there is not enough room below — then upward.
 * Moving is the native window drag (-webkit-app-region: drag on the handle / header).
 */
export class Island {
  readonly win: BrowserWindow
  private pill: { x: number; y: number }
  private dock: Dock | undefined
  private layout: IslandLayout
  /** Where the content is in the window (reported by the renderer) — the pill's real rectangle. */
  private rect = { x: (ISLAND_WINDOW.width - ISLAND_PILL.width) / 2, y: 0, width: ISLAND_PILL.width, height: ISLAND_PILL.height }
  private ignoring = true
  private placing = false
  private timers: NodeJS.Timeout[] = []

  constructor(
    saved: { x?: number; y?: number; dock?: Dock },
    private persist: (pos: { x: number; y: number; dock?: Dock }) => void,
  ) {
    this.pill = this.validPill(saved)
    this.dock = saved.x !== undefined && saved.dock ? saved.dock : undefined
    this.layout = this.layoutFor(this.pill)
    this.win = new BrowserWindow({
      ...ISLAND_WINDOW,
      ...this.windowPos(),
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: common(),
    })
    this.win.setAlwaysOnTop(true, 'screen-saver')
    this.win.setVisibleOnAllWorkspaces(true)
    this.win.setIgnoreMouseEvents(true, { forward: true })
    load(this.win, 'island')
    forwardConsole(this.win, 'island')
    this.win.once('ready-to-show', () => this.win.showInactive())
    // the native drag ends with "moved" (Windows sends it once, on release)
    this.win.on('moved', () => this.onMoved())
    this.timers.push(setInterval(() => this.tick(), 40))
    // Windows may drop always-on-top after display changes / full-screen apps; re-assert periodically.
    this.timers.push(setInterval(() => !this.win.isDestroyed() && this.win.setAlwaysOnTop(true, 'screen-saver'), 60_000))
    const onDisplays = () => this.place()
    screen.on('display-metrics-changed', onDisplays)
    this.win.on('closed', () => {
      this.timers.forEach(clearInterval)
      screen.off('display-metrics-changed', onDisplays)
    })
  }

  get islandLayout(): IslandLayout {
    return this.layout
  }

  private validPill(saved: { x?: number; y?: number }): { x: number; y: number } {
    if (saved.x !== undefined && saved.y !== undefined) {
      const r = { x: saved.x, y: saved.y, ...ISLAND_PILL }
      if (screen.getAllDisplays().some((d) => intersects(r, d.workArea))) return { x: saved.x, y: saved.y }
    }
    const wa = screen.getPrimaryDisplay().workArea
    return { x: Math.round(wa.x + (wa.width - ISLAND_PILL.width) / 2), y: wa.y + 6 }
  }

  private workArea(): Rectangle {
    return screen.getDisplayNearestPoint({ x: Math.round(this.pill.x), y: Math.round(this.pill.y) }).workArea
  }

  private layoutFor(pill: { x: number; y: number }): IslandLayout {
    const wa = screen.getDisplayNearestPoint({ x: Math.round(pill.x), y: Math.round(pill.y) }).workArea
    if (this.dock === 'top') return { up: false, dock: 'top' }
    if (this.dock === 'bottom') return { up: true, dock: 'bottom' }
    if (this.dock === 'left' || this.dock === 'right') return { up: false, dock: this.dock, offset: Math.round(pill.y - this.sideTop(wa)) }
    // downward by default; upward only when the expanded island would not fit below the pill
    return { up: pill.y + ISLAND_WINDOW.height > wa.y + wa.height }
  }

  /** At a side edge the window stands around the pill's centre (pill.y), inside the work area. */
  private sideTop(wa: Rectangle): number {
    return Math.round(Math.max(wa.y, Math.min(wa.y + wa.height - ISLAND_WINDOW.height, this.pill.y - ISLAND_WINDOW.height / 2)))
  }

  private windowPos(): { x: number; y: number } {
    const wa = this.workArea()
    const cx = Math.round(this.pill.x - (ISLAND_WINDOW.width - ISLAND_PILL.width) / 2)
    switch (this.dock) {
      case 'top':
        return { x: cx, y: wa.y }
      case 'bottom':
        return { x: cx, y: wa.y + wa.height - ISLAND_WINDOW.height }
      case 'left':
        return { x: wa.x, y: this.sideTop(wa) }
      case 'right':
        return { x: wa.x + wa.width - ISLAND_WINDOW.width, y: this.sideTop(wa) }
      default:
        return { x: cx, y: this.layout.up ? this.pill.y + ISLAND_PILL.height - ISLAND_WINDOW.height : this.pill.y }
    }
  }

  setRect(r: { x: number; y: number; width: number; height: number }): void {
    if ([r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0) this.rect = r
  }

  private place(): void {
    if (this.win.isDestroyed()) return
    this.placing = true
    this.win.setBounds({ ...this.windowPos(), ...ISLAND_WINDOW })
    setTimeout(() => (this.placing = false), 50)
  }

  /** The pill's rectangle on screen and its display, for a window at (x, y). */
  private pillAt(x: number, y: number) {
    const pill = { x: x + this.rect.x, y: y + this.rect.y, width: this.rect.width, height: this.rect.height }
    const cx = pill.x + pill.width / 2
    const cy = pill.y + pill.height / 2
    const display = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) })
    return { pill, cx, cy, display, dock: nextDock(pill, display, screen.getAllDisplays().filter((d) => d.id !== display.id), this.dock) }
  }

  /**
   * After a drag: released near an outer screen edge — the island sticks to it; anywhere else it floats there
   * (a stuck island is unstuck just by dragging it away). Edges between two monitors never catch it.
   */
  private onMoved(): void {
    if (this.placing || this.win.isDestroyed()) return
    const [x, y] = this.win.getPosition()
    const { cx, cy, display, dock } = this.pillAt(x, y)
    const wa = display.workArea
    const wasDocked = !!this.dock
    this.dock = dock
    if (dock === 'top' || dock === 'bottom') this.pill = { x: Math.round(Math.max(wa.x, Math.min(wa.x + wa.width - ISLAND_PILL.width, cx - ISLAND_PILL.width / 2))), y: dock === 'top' ? wa.y : wa.y + wa.height - ISLAND_PILL.height }
    else if (dock) this.pill = { x: dock === 'left' ? wa.x : wa.x + wa.width - 1, y: Math.round(cy) }
    else if (wasDocked)
      // unstuck: the full pill takes the place where the slim one was let go
      this.pill = { x: Math.round(cx - ISLAND_PILL.width / 2), y: Math.round(Math.max(wa.y, Math.min(wa.y + wa.height - ISLAND_PILL.height, cy - ISLAND_PILL.height / 2))) }
    else
      this.pill = {
        x: Math.round(x + (ISLAND_WINDOW.width - ISLAND_PILL.width) / 2),
        y: this.layout.up ? y + ISLAND_WINDOW.height - ISLAND_PILL.height : y,
      }
    const layout = this.layoutFor(this.pill)
    const changed = layout.up !== this.layout.up || layout.dock !== this.layout.dock || layout.offset !== this.layout.offset
    this.layout = layout
    if (changed) this.win.webContents.send(IPC.islandLayout, layout)
    if (changed || dock || wasDocked) this.place()
    this.persist({ ...this.pill, dock: this.dock })
    this.win.webContents.send(IPC.islandHover, { moved: true })
  }

  reset(): void {
    this.dock = undefined
    this.pill = this.validPill({})
    this.layout = this.layoutFor(this.pill)
    this.win.webContents.send(IPC.islandLayout, this.layout)
    this.place()
    this.persist({ ...this.pill, dock: undefined })
  }

  focus(): void {
    // show() on a visible window replays the OS show animation of the whole island — only focus it
    if (!this.win.isVisible()) this.win.showInactive()
    this.win.focus()
  }

  blur(): void {
    if (this.win.isFocused()) this.win.blur()
  }

  /** Click-through is switched by the renderer (it knows exactly where its content is). */
  setSolid(solid: boolean): void {
    if (solid === !this.ignoring || this.win.isDestroyed()) return
    this.ignoring = !solid
    this.win.setIgnoreMouseEvents(!solid, { forward: true })
  }

  /**
   * A safety net: if the window is still "solid" while the cursor is far outside it,
   * make it click-through again and report a leave (during a native drag the window stays under the cursor).
   */
  private tick(): void {
    if (this.win.isDestroyed() || !this.win.isVisible() || this.ignoring) return
    const p = screen.getCursorScreenPoint()
    const b = this.win.getBounds()
    const far = 60
    if (p.x < b.x - far || p.x > b.x + b.width + far || p.y < b.y - far || p.y > b.y + b.height + far) {
      this.setSolid(false)
      this.win.webContents.send(IPC.islandHover, { leave: true })
    }
  }
}
