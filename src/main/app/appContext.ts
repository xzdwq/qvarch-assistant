import type { BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { DayStateMessage, LiveStatus, Selection } from '../../shared/types'
import type { EventArgs, EventMethod } from '../../shared/ipc/routes'
import { dayKey } from '../../shared/timeline'
import { emit } from '../ipc/router'
import type { Browser } from '../browser'
import type { ClipLog } from '../clipLog'
import type { Jira } from '../jira'
import type { Outlook } from '../outlook'
import type { Probe } from '../probe'
import type { SqlStore } from '../sql/store'
import type { Store } from '../store'
import type { TabletService } from '../tablet'
import type { Terminals } from '../terminal'
import { TestFiles } from '../testFiles'
import type { Tracker } from '../tracker'
import type { Recording } from '../tracker/recording'
import type { Vault } from '../vault'
import type { Voice } from '../voice'
import { AppWindows } from './appWindows'

/**
 * The main process's services in one place (the composition root fills them in on start): the IPC modules get it
 * and reach what they need — the store, the windows, the integrations — and tell the windows what changed.
 */
export class AppContext {
  store!: Store
  tracker!: Tracker
  recording!: Recording
  probe!: Probe
  jira!: Jira
  outlook!: Outlook
  voice!: Voice
  vault!: Vault
  tablet?: TabletService
  terminals?: Terminals
  browser?: Browser
  clipLog?: ClipLog
  sqlStore?: SqlStore
  readonly windows = new AppWindows(this)
  /** The folder of the main process's built scripts (the workers lie next to index.js) — set by the composition root. */
  mainDir = ''
  /** The cut marker shared by all windows. */
  selection: Selection | null = null
  private testFiles?: TestFiles
  private broadcastPending = false

  /** A built script of the main process (a worker) by its file name. */
  script(file: string): string {
    return join(this.mainDir, file)
  }
  /** The notebook's test files (made when first asked for: the vault is there by then). */
  files(): TestFiles {
    return (this.testFiles ??= new TestFiles(join(this.vault.root, '.files'), () => this.windows.main))
  }
  /** The windows told the day's state (today's blocks, what is tracked now, the marker) — a moment later, once for many changes. */
  broadcast(): void {
    if (this.broadcastPending) return
    this.broadcastPending = true
    setTimeout(() => {
      this.broadcastPending = false
      // a marker following «now» left on a previous day is stale (a closed one on any day is a choice — kept)
      if (this.selection && this.selection.end === undefined && this.selection.day !== dayKey(Date.now())) this.selection = null
      const msg: DayStateMessage = { day: this.store.day(dayKey(Date.now())), live: this.live(), selection: this.selection }
      this.emitToAll('onDayState', msg)
    }, 250)
  }
  /** What goes on now: the clock, a call. */
  live(): LiveStatus {
    return { ...this.tracker.live, now: Date.now() }
  }
  /** An event to the main window and the island. */
  emitToAll<K extends EventMethod>(name: K, ...args: EventArgs<K>): void {
    for (const w of [this.windows.main, this.windows.island?.win]) emit(contentsOf(w), name, ...args)
  }
  /** An event to the main window only. */
  emitToMain<K extends EventMethod>(name: K, ...args: EventArgs<K>): void {
    emit(contentsOf(this.windows.main), name, ...args)
  }
}
/** A window's page (a destroyed window has none to reach). */
export const contentsOf = (w: BrowserWindow | undefined) => (w && !w.isDestroyed() ? w.webContents : undefined)
