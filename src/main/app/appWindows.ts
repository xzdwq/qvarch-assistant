import { app, Menu, shell, Tray, type BrowserWindow } from 'electron'
import type { AppCommand } from '../../shared/api'
import { themeBg, themeSymbol } from '../../shared/theme'
import { makeIcon } from '../icon'
import { emit } from '../ipc/router'
import { createMainWindow, Island, TITLEBAR_HEIGHT } from '../windows'
import type { AppContext } from './appContext'

/** Where the main window opens (a day, a block, a section). */
export type Nav = { day?: string; entryId?: string; view?: 'day' | 'settings' | 'browser' }

/**
 * The app's windows: the main window (hidden, not closed, until the app quits), the island, the tray; the app's own
 * commands (toggle the island, reload, quit…).
 */
export class AppWindows {
  main?: BrowserWindow
  island?: Island
  /** The app is quitting: the main window closes for real. */
  quitting = false
  private tray?: Tray
  constructor(private readonly app: AppContext) {}

  /** The main window shown (made when there is none), at a place of it when asked. */
  showMain(nav?: Nav): void {
    if (!this.main || this.main.isDestroyed()) {
      const win = this.makeMain()
      win.once('ready-to-show', () => {
        win.show()
        if (nav) emit(win.webContents, 'onNavigate', nav)
      })
      return
    }
    if (this.main.isMinimized()) this.main.restore()
    this.main.show()
    this.main.focus()
    if (nav) emit(this.main.webContents, 'onNavigate', nav)
  }
  /** The main window made (not shown yet): the browser lives in it, the tablet follows it, closing hides it. */
  makeMain(): BrowserWindow {
    const win = createMainWindow()
    this.main = win
    this.app.browser?.attach(win)
    this.applyTheme()
    // "only the Qvarch window" follows this window
    this.app.tablet?.refresh()
    win.on('close', (e) => {
      if (this.quitting) return
      e.preventDefault()
      win.hide()
    })
    return win
  }
  /** The window's own colours (the canvas, the native min/max/close) follow the theme's contrast. */
  applyTheme(): void {
    if (!this.main || this.main.isDestroyed()) return
    const t = this.app.store.cfg.ui.theme
    this.main.setBackgroundColor(themeBg(t))
    this.main.setTitleBarOverlay({ color: themeBg(t), symbolColor: themeSymbol(t), height: TITLEBAR_HEIGHT })
  }

  // ---------- the island ----------
  createIsland(): void {
    this.island = new Island(this.app.store.cfg.island, (pos) => this.app.store.update({ island: pos }))
  }
  toggleIsland(): void {
    if (!this.island || this.island.win.isDestroyed()) this.createIsland()
    else if (this.island.win.isVisible()) this.island.win.hide()
    else this.island.win.showInactive()
  }
  resetIsland(): void {
    if (!this.island || this.island.win.isDestroyed()) this.createIsland()
    this.island?.reset()
    this.island?.win.showInactive()
  }
  /** The global hotkey: the island shown, focused, its label field asked to take the input. */
  focusIsland(): void {
    if (!this.island || this.island.win.isDestroyed()) this.createIsland()
    this.island?.focus()
    emit(this.island?.win.webContents, 'onIslandHotkey')
  }

  /** An app command (the tray, the windows' menus). */
  runCommand(cmd: AppCommand): void {
    switch (cmd) {
      case 'island-toggle':
        return this.toggleIsland()
      case 'island-reset':
        return this.resetIsland()
      case 'devtools':
        return this.main?.webContents.toggleDevTools()
      // the window's page loaded anew (its own scripts, styles — what was changed by hand goes)
      case 'reload':
        return this.main?.webContents.reloadIgnoringCache()
      case 'open-data-folder':
        return void shell.openPath(this.app.store.root)
      case 'quit':
        this.quitting = true
        return app.quit()
    }
  }
  createTray(): void {
    this.tray = new Tray(makeIcon(32))
    this.tray.setToolTip('Qvarch Assistant')
    const menu = Menu.buildFromTemplate([
      { label: 'Открыть', click: () => this.showMain() },
      { label: 'Показать / скрыть island', click: () => this.toggleIsland() },
      { label: 'Вернуть island наверх по центру', click: () => this.resetIsland() },
      { type: 'separator' },
      { label: 'Выход', click: () => this.runCommand('quit') },
    ])
    this.tray.setContextMenu(menu)
    this.tray.on('click', () => this.showMain())
  }
  /** Starting with Windows (the packaged app only), hidden in the tray. */
  applyAutoStart(): void {
    if (!app.isPackaged) return
    app.setLoginItemSettings({ openAtLogin: this.app.store.cfg.autoStart, args: ['--hidden'] })
  }
}
