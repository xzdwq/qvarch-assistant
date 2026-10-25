import { app, desktopCapturer, globalShortcut, Menu, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { applyMeetings } from '../shared/outlook'
import { dayKey, dayStart, shiftDay } from '../shared/timeline'
import { isWhisperModel } from '../shared/voice'
import { AppContext } from './app/appContext'
import { registerAppIpc } from './ipc/appIpc'
import { registerBrowserIpc } from './ipc/browserIpc'
import { registerFilesIpc } from './ipc/filesIpc'
import { registerHistoryIpc } from './ipc/historyIpc'
import { registerIntegrationsIpc } from './ipc/integrationsIpc'
import { registerMcpIpc } from './ipc/mcpIpc'
import { registerNotebookIpc } from './ipc/notebookIpc'
import { registerReleaseIpc } from './ipc/releaseIpc'
import { registerRunnersIpc } from './ipc/runnersIpc'
import { registerTabletIpc } from './ipc/tabletIpc'
import { registerToolsIpc } from './ipc/toolsIpc'
import { registerTrackerIpc } from './ipc/trackerIpc'
import { Recording } from './tracker/recording'
import { registerVoiceIpc } from './ipc/voiceIpc'
import { Jira } from './jira'
import { Outlook } from './outlook'
import { Probe } from './probe'
import { runSnap } from './snap'
import { Store } from './store'
import { Tracker } from './tracker'
import { Transport } from './transport/transport'
import { Activity } from './tracker/activity'
import { checkReminders } from './tracker/reminders'
import { Series } from './tracker/series'
import { Vault } from './vault'
import { Voice } from './voice'
import { APP_ID, fixShortcut, Island } from './windows'

/**
 * The main process's composition root: the services made and wired, the window calls registered (src/main/ipc —
 * a module per context), the app's lifecycle. Nothing else lives here.
 */
const ISLAND_HOTKEY = 'Control+Alt+Space'

// development pictures of the windows (see snap.ts): on a copy of the data, nothing shown, nothing tracked
const SNAP = process.env.QA_SNAP && process.env.QA_SNAP_HOME ? process.env.QA_SNAP : undefined
if (SNAP) app.setPath('userData', process.env.QA_SNAP_HOME!)
// another profile on the same computer — its own data and key, another device to the server («… --profile=2»)
const PROFILE = process.argv.find((a) => a.startsWith('--profile='))?.slice('--profile='.length).replace(/[^\w-]/g, '')
if (PROFILE && !SNAP) app.setPath('userData', `${app.getPath('userData')}-${PROFILE}`)
if (!app.requestSingleInstanceLock()) app.quit()
app.setAppUserModelId(APP_ID)

const ctx = new AppContext()
ctx.mainDir = __dirname
let stopRuns: ((reason: string) => void) | undefined

app.on('second-instance', () => ctx.windows.showMain())

app.whenReady().then(() => {
  fixShortcut()
  // no application menu: Electron's default one (hidden behind our title bar) still owns Ctrl+Z / Ctrl+Y (its
  // "Edit → Undo" — the page never sees the key, a board can't undo) and Ctrl+= / Ctrl+- (Chromium's page zoom,
  // shared with the island). Text fields keep their own undo, copy and paste.
  Menu.setApplicationMenu(null)
  const activity = makeServices()
  // recording a call: the system sound (loopback — the other side) comes with a screen capture request
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, callback) => {
      void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => callback({ video: sources[0], audio: 'loopback' }))
    },
    { useSystemPicker: false },
  )
  registerIpc(activity)
  if (SNAP) {
    Island.hidden = true
    ctx.windows.makeMain()
    ctx.windows.createIsland()
    // a broken steps file must not leave the app hanging
    runSnap(SNAP, ctx.windows.main!, ctx.windows.island?.win).catch((e) => (console.error('snap:', e), app.exit(1)))
    return
  }
  ctx.tracker.start()
  ctx.recording.start()
  ctx.jira.start()
  ctx.outlook.start()
  ctx.transport.configure()
  ctx.probe.setTitles(ctx.store.cfg.captureTitles)
  ctx.probe.setKeys(ctx.store.cfg.countKeys)
  ctx.probe.start()
  ctx.tablet?.start()
  ctx.windows.createTray()
  // the island starts closed: the tray / the hotkey open it
  ctx.windows.createIsland(false)
  if (!process.argv.includes('--hidden')) ctx.windows.showMain()
  ctx.windows.applyAutoStart()
  globalShortcut.register(ISLAND_HOTKEY, () => ctx.windows.focusIsland())
  // persist activity regularly even without heartbeats
  setInterval(() => ctx.store.flush(), 10_000)
  setInterval(() => {
    checkReminders(ctx)
    ctx.broadcast()
  }, 20_000)
})

/** The services: the store, the tracker and the input probe, the integrations, the notebook, the voice; the activity tracker. */
function makeServices(): Activity {
  const store = (ctx.store = new Store())
  ctx.tracker = new Tracker(store, () => ctx.broadcast())
  ctx.recording = new Recording(ctx)
  const activity = new Activity(ctx)
  ctx.probe = new Probe(
    store.cfg.sampleIntervalMs,
    (s) => {
      const settings = store.cfg
      ctx.tracker.onSample(s, settings.sampleIntervalMs, settings.captureTitles)
      if (settings.countKeys && s.pid !== process.pid) activity.countSwitch(s.proc)
      activity.autoLunch()
    },
    (times, mousePx) => activity.onInput(times, mousePx),
  )
  ctx.jira = new Jira(store.root, () => store.cfg.jira, (s) => ctx.emitToAll('onJira', s))
  ctx.outlook = new Outlook(
    store.root,
    () => store.cfg.outlook,
    (s) => ctx.emitToAll('onOutlook', s),
    (events, from, to) => {
      // every day of the synced window follows Outlook
      for (let day = dayKey(from); dayStart(day) < to; day = shiftDay(day, 1)) {
        const d = store.day(day)
        if (applyMeetings(d, events, store.cfg.kinds, randomUUID)) store.markDirty(day)
      }
      store.flush()
      ctx.broadcast()
    },
    (inCall) => ctx.tracker.setPresenceCall(inCall),
  )
  ctx.vault = new Vault(store.root, { onChange: (paths) => ctx.emitToMain('onVault', paths), onMedia: (rels) => ctx.emitToMain('onVaultMedia', rels) })
  ctx.vault.watch()
  // after the vault: the chats get their documents in the notebook
  ctx.transport = new Transport(ctx)
  ctx.voice = new Voice(store.root, () => (isWhisperModel(store.cfg.voice.model) ? store.cfg.voice.model : 'small'), (s) => ctx.emitToAll('onVoice', s))
  return activity
}

/** Every window call registered, a module per context (the order: the services a later one uses come first). */
function registerIpc(activity: Activity): void {
  registerTrackerIpc(ctx, new Series(ctx))
  registerHistoryIpc(ctx, activity)
  registerReleaseIpc(ctx)
  registerTabletIpc(ctx)
  registerFilesIpc(ctx)
  registerVoiceIpc(ctx)
  registerIntegrationsIpc(ctx)
  registerToolsIpc(ctx)
  registerBrowserIpc(ctx)
  registerAppIpc(ctx)
  registerNotebookIpc(ctx)
  stopRuns = registerRunnersIpc(ctx)
  registerMcpIpc(ctx)
}

// closing windows keeps the tracker alive in the tray
app.on('window-all-closed', () => undefined)

app.on('before-quit', () => {
  ctx.windows.quitting = true
  // the runs and queries going on: stopped (a query — cancelled on its server, its connection closed)
  stopRuns?.('Приложение закрывается')
  ctx.sqlStore?.stopAll()
  globalShortcut.unregisterAll()
  ctx.probe?.stop()
  ctx.tablet?.stop()
  // the recordings: their ends caught up once more (one the app stays closed through ends there on the next start)
  ctx.recording?.stop()
  ctx.tracker?.stop()
  ctx.jira?.stop()
  ctx.outlook?.stop()
  ctx.transport?.stop()
  ctx.voice?.stop()
  ctx.vault?.stop()
  ctx.terminals?.killAll()
  ctx.browser?.closeAll()
  ctx.clipLog?.flush()
  ctx.store?.close()
})
