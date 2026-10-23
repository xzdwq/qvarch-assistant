import { app, BrowserWindow, clipboard as sysClipboard, ClipboardItem, desktopCapturer, nativeImage, dialog, globalShortcut, ipcMain, Menu, Notification, powerMonitor, session, shell, Tray, utilityProcess, type UtilityProcess } from 'electron'
import { TestFiles } from './testFiles'
import { TEST_FILES_METHODS } from '../shared/testFiles'
import { deleteProject, importVscodeProjects, readProjects, saveProject, setReleaseDataDir } from './release/config'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { Mcp, type McpTool } from './mcp'
import { qvarchTools } from './mcpTools'
import { netClear, netListen, setupNoteBrowser } from './noteBrowser'
import { TraceServer } from './traceServer'
import { PW_BROWSERS } from '../shared/runbook'
import { LOOP_MAX, LOOP_MAX_LIMIT, LOOP_PARALLEL_LIMIT, type LoopJob, type LoopResult, type PassResult } from '../shared/loop'
import { BUNDLE_EXT, MAX_BUNDLE, parseBundle } from '../shared/docBundle'
import { join } from 'node:path'
import { IPC, type AppCommand, type PwJob, type PwResult, type PwStep } from '../shared/api'
import { clipEntries, dayEnd, dayKey, dayStart, shiftDay, firstFreeLane, mergeEntries, pinLanes, placeEntry, putEntry, scheduleRanges } from '../shared/timeline'
import type { DayStateMessage, Entry, LocalTask, Note, PlanBlock, Selection, SettingsPatch } from '../shared/types'
import { emptyCombo, pushKeys, type ComboState } from '../shared/combo'
import { addToRows, type PulsePoint } from '../shared/pulse'
import { makeIcon } from './icon'
import { Probe } from './probe'
import { TabletService } from './tablet'
import { Jira } from './jira'
import { Outlook } from './outlook'
import { applyMeetings } from '../shared/outlook'
import { Voice } from './voice'
import { Vault } from './vault'
import { remindAt, shiftBy, type Remind, type RepeatRule } from '../shared/repeat'
import { isWhisperModel, titleFromTranscript, VOICE_PENDING } from '../shared/voice'
import { keyTotals } from '../shared/board'
import type { JiraListQuery, MyTaskStatus } from '../shared/jira'
import { Store } from './store'
import { Tracker } from './tracker'
import { createMainWindow, fixShortcut, Island, TITLEBAR_HEIGHT } from './windows'
import { themeBg, themeSymbol } from '../shared/theme'
import type { HttpDoc, HttpFolder, HttpKV, HttpRequest } from '../shared/http'
import { runSnap } from './snap'
import { HttpClient } from './http'
import { Terminals } from './terminal'
import { Browser } from './browser'
import { ClipLog } from './clipLog'
import { BROWSER_METHODS } from '../shared/browser'
import { SQL_METHODS } from '../shared/sql'
import { SqlStore } from './sql/store'
import type { EventRef } from '../shared/noteEvents'
import type { TermConfig } from '../shared/terminal'

const ISLAND_HOTKEY = 'Control+Alt+Space'

// development pictures of the windows (see snap.ts): on a copy of the data, nothing shown, nothing tracked
const SNAP = process.env.QA_SNAP && process.env.QA_SNAP_HOME ? process.env.QA_SNAP : undefined
if (SNAP) app.setPath('userData', process.env.QA_SNAP_HOME!)
if (!app.requestSingleInstanceLock()) app.quit()
app.setAppUserModelId('com.qvarch.assistant')

let store: Store
let tracker: Tracker
let probe: Probe
let mainWin: BrowserWindow | undefined
let tablet: TabletService | undefined
let island: Island | undefined
let terminals: Terminals | undefined
let browser: Browser | undefined
let clipLog: ClipLog | undefined
let selection: Selection | null = null
let tray: Tray | undefined
let jira: Jira
let outlook: Outlook
let voice: Voice
let vault: Vault
let sqlStore: SqlStore | undefined
/** The notebook's test files (made when first asked for: the vault is there by then). */
let testFiles: TestFiles | undefined
const files = () => (testFiles ??= new TestFiles(join(vault.root, '.files'), () => mainWin))
let quitting = false

// ---------- broadcasting ----------

let pending = false
function broadcast(): void {
  if (pending) return
  pending = true
  setTimeout(() => {
    pending = false
    // a marker following «now» left on a previous day is stale (a closed one on any day is a choice — kept)
    if (selection && selection.end === undefined && selection.day !== dayKey(Date.now())) selection = null
    const msg: DayStateMessage = { day: store.day(dayKey(Date.now())), live: { ...tracker.live, now: Date.now() }, selection }
    for (const w of [mainWin, island?.win]) if (w && !w.isDestroyed()) w.webContents.send(IPC.dayState, msg)
  }, 250)
}

// ---------- typing combo ----------
// Only the moments of key presses arrive here (never which keys). The streak lives in memory,
// the day's best is stored in the day file.

let combo: ComboState = emptyCombo()
let comboDay = ''

function currentCombo(): ComboState {
  const day = dayKey(Date.now())
  if (day !== comboDay) {
    const saved = store.day(day).combo
    combo = { ...emptyCombo(), best: saved?.best ?? 0, bestAt: saved?.at }
    comboDay = day
  }
  return combo
}

function onInput(times: number[], mousePx: number): void {
  if (times.length) {
    const c = currentCombo()
    if (pushKeys(c, times)) {
      const d = store.day(comboDay)
      d.combo = { best: c.best, at: c.bestAt ?? Date.now() }
      store.markDirty(comboDay)
    }
    for (const w of [mainWin, island?.win]) if (w && !w.isDestroyed()) w.webContents.send(IPC.combo, { ...c })
  }
  addPulse(times.length, mousePx, 0)
}

// ---------- activity pulse ----------
// Every input batch lands in a 1-second live bin (kept for a few minutes, streamed to the windows at
// most ~3 times a second) and in the day's minute bins (stored). Amounts only.

const PULSE_KEEP = 300
const pulseBins: PulsePoint[] = []
let pulseTimer: NodeJS.Timeout | undefined
let lastProc = ''

function addPulse(k: number, m: number, s: number): void {
  const now = Date.now()
  const t = Math.floor(now / 1000) * 1000
  let bin = pulseBins[pulseBins.length - 1]
  if (!bin || bin.t !== t) {
    bin = { t, k: 0, m: 0, s: 0 }
    pulseBins.push(bin)
    if (pulseBins.length > PULSE_KEEP) pulseBins.splice(0, pulseBins.length - PULSE_KEEP)
  }
  bin.k += k
  bin.m += m
  bin.s += s
  const day = dayKey(now)
  const d = store.day(day)
  d.pulse ??= []
  addToRows(d.pulse, dayStart(day), now, k, m, s)
  store.markDirty(day)
  pulseTimer ??= setTimeout(() => {
    pulseTimer = undefined
    const recent = pulseBins.slice(-3)
    for (const w of [mainWin, island?.win]) if (w && !w.isDestroyed()) w.webContents.send(IPC.pulse, recent)
  }, 300)
}

/** A different foreground process than the previous sample = one window switch. */
function countSwitch(proc: string): void {
  if (!proc) return
  if (lastProc && proc !== lastProc) addPulse(0, 0, 1)
  lastProc = proc
}

// ---------- automatic lunch ----------
// Lunch time by the schedule (from 10 min before) and no input → a lunch block up to the lunch end,
// on a free lane: whatever happens meanwhile (a call…) goes in parallel. Once a day; not if the user has one.

const LUNCH_LEAD_MS = 10 * 60_000

function autoLunch(): void {
  // no input for a while (the system's idle time — nothing about apps is looked at or kept)
  const idleSec = powerMonitor.getSystemIdleTime()
  if (idleSec < store.cfg.idleThresholdSec) return
  const now = Date.now()
  const day = dayKey(now)
  const { lunch } = scheduleRanges(day, store.cfg.schedule)
  if (!lunch || now < lunch[0] - LUNCH_LEAD_MS || now >= lunch[1]) return
  const d = store.day(day)
  if (d.autoLunch) return
  const kind = store.cfg.kinds.find((k) => k.id === 'lunch')
  if (!kind) return
  if (d.entries.some((e) => e.kind === kind.id && e.end > lunch[0] && e.start < lunch[1])) {
    d.autoLunch = 'manual'
    store.markDirty(day)
    return
  }
  // from when the input stopped (but not earlier than 10 min before lunch)
  const start = Math.max(now - idleSec * 1000, lunch[0] - LUNCH_LEAD_MS)
  const entry: Entry = {
    id: randomUUID(),
    start,
    end: lunch[1],
    kind: kind.id,
    label: kind.label,
    source: 'detected',
    lane: firstFreeLane(d.entries, start, lunch[1]),
  }
  d.entries = pinLanes(putEntry(d.entries, entry), entry.id)
  d.autoLunch = entry.id
  store.markDirty(day)
  store.flush()
  broadcast()
}

function tasksChanged(): void {
  const list = store.tasks()
  for (const w of [mainWin, island?.win]) if (w && !w.isDestroyed()) w.webContents.send(IPC.tasksChanged, list)
}

// ---------- windows ----------

/** Saving an entry (the IPC handler and the AI tools): set up with the store. */
let saveEntryImpl: (day: string, input: Omit<Entry, 'id'> & { id?: string }, opts?: { overlap?: boolean }) => Entry = () => {
  throw new Error('not ready')
}
type Nav = { day?: string; entryId?: string; view?: 'day' | 'settings' | 'browser' }

function showMain(nav?: Nav): void {
  if (!mainWin || mainWin.isDestroyed()) {
    mainWin = createMainWindow()
    browser?.attach(mainWin)
    applyWindowTheme()
    // "only the Qvarch window" follows this window
    tablet?.refresh()
    mainWin.on('close', (e) => {
      if (quitting) return
      e.preventDefault()
      mainWin?.hide()
    })
    mainWin.once('ready-to-show', () => {
      mainWin?.show()
      if (nav) mainWin?.webContents.send(IPC.navigate, nav)
    })
    return
  }
  if (mainWin.isMinimized()) mainWin.restore()
  mainWin.show()
  mainWin.focus()
  if (nav) mainWin.webContents.send(IPC.navigate, nav)
}

/** The window's own colours (the canvas, the native min/max/close) follow the theme's contrast. */
function applyWindowTheme(): void {
  if (!mainWin || mainWin.isDestroyed()) return
  const t = store.cfg.ui.theme
  mainWin.setBackgroundColor(themeBg(t))
  mainWin.setTitleBarOverlay({ color: themeBg(t), symbolColor: themeSymbol(t), height: TITLEBAR_HEIGHT })
}

function createIslandWindow(): void {
  island = new Island(store.cfg.island, (pos) => store.update({ island: pos }))
}

function toggleIsland(): void {
  if (!island || island.win.isDestroyed()) createIslandWindow()
  else if (island.win.isVisible()) island.win.hide()
  else island.win.showInactive()
}

function resetIsland(): void {
  if (!island || island.win.isDestroyed()) createIslandWindow()
  island?.reset()
  island?.win.showInactive()
}

function runCommand(cmd: AppCommand): void {
  if (cmd === 'island-toggle') toggleIsland()
  else if (cmd === 'island-reset') resetIsland()
  else if (cmd === 'devtools') mainWin?.webContents.toggleDevTools()
  // the window's page loaded anew (its own scripts, styles — what was changed by hand goes)
  else if (cmd === 'reload') mainWin?.webContents.reloadIgnoringCache()
  else if (cmd === 'open-data-folder') void shell.openPath(store.root)
  else if (cmd === 'quit') {
    quitting = true
    app.quit()
  }
}

function createTray(): void {
  tray = new Tray(makeIcon(32))
  tray.setToolTip('Qvarch Assistant')
  const menu = Menu.buildFromTemplate([
    { label: 'Открыть', click: () => showMain() },
    { label: 'Показать / скрыть island', click: toggleIsland },
    { label: 'Вернуть island наверх по центру', click: resetIsland },
    { type: 'separator' },
    { label: 'Выход', click: () => runCommand('quit') },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => showMain())
}

function applyAutoStart(): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: store.cfg.autoStart, args: ['--hidden'] })
}

// ---------- IPC ----------

const OUTLOOK_RO = 'Встреча из Outlook — её меняет только Outlook'

/** Deletes a block. */
function removeEntry(day: string, id: string): void {
  const d = store.day(day)
  d.entries = d.entries.filter((e) => e.id !== id)
  store.markDirty(day)
}

// ---------- repeated series ----------
/** Where the blocks of a series are: a small index (series id → day + block id), checked against the days. */
type SeriesIndex = Record<string, Array<{ day: string; id: string }>>
const seriesFile = () => join(store.root, 'series.json')
function readSeries(): SeriesIndex {
  try {
    return JSON.parse(readFileSync(seriesFile(), 'utf8')) as SeriesIndex
  } catch {
    return {}
  }
}
function writeSeries(ix: SeriesIndex): void {
  writeFileSync(`${seriesFile()}.tmp`, JSON.stringify(ix))
  renameSync(`${seriesFile()}.tmp`, seriesFile())
}
/** The blocks of a series that still exist (a block moved to another day by hand is found there too). */
function seriesItems(sid: string): Array<{ day: string; e: Entry }> {
  const ix = readSeries()
  const out: Array<{ day: string; e: Entry }> = []
  for (const it of ix[sid] ?? []) {
    let e = store.day(it.day).entries.find((x) => x.id === it.id)
    let day = it.day
    if (!e)
      for (const dk of [shiftDay(it.day, -1), shiftDay(it.day, 1)]) {
        e = store.day(dk).entries.find((x) => x.id === it.id)
        if (e) {
          day = dk
          break
        }
      }
    if (e?.series?.id === sid) out.push({ day, e })
  }
  return out
}
function repeatEntry(day: string, id: string, rule: RepeatRule, count: number): number {
  const d = store.day(day)
  const src = d.entries.find((x) => x.id === id)
  if (!src) throw new Error('Блок не найден')
  if (src.outlook) throw new Error(OUTLOOK_RO)
  const n = Math.max(1, Math.min(366, Math.round(count)))
  const sid = randomUUID()
  src.series = { id: sid, rule }
  store.markDirty(day)
  const items = [{ day, id: src.id }]
  for (let k = 1; k < n; k++) {
    const start = shiftBy(src.start, rule, k)
    const dk = dayKey(start)
    const end = Math.min(dayEnd(dk), start + (src.end - src.start))
    if (!(end > start)) continue
    const copy: Entry = {
      id: randomUUID(),
      start,
      end,
      kind: src.kind,
      label: src.label,
      ...(src.description ? { description: src.description } : {}),
      ...(src.task ? { task: { ...src.task } } : {}),
      source: 'manual',
      // a reminder tied to the start goes with each copy; a set moment moves by the same step
      ...(src.remind ? { remind: src.remind.at !== undefined ? { at: shiftBy(src.remind.at, rule, k) } : { before: src.remind.before } } : {}),
      series: { id: sid, rule },
    }
    const t = store.day(dk)
    copy.lane = firstFreeLane(t.entries, copy.start, copy.end, copy.id)
    t.entries = pinLanes(putEntry(t.entries, copy), copy.id)
    store.markDirty(dk)
    items.push({ day: dk, id: copy.id })
  }
  writeSeries({ ...readSeries(), [sid]: items })
  store.flush()
  broadcast()
  return items.length
}
/** One block's edit → every block of its series: the same time shift and length, text, kind, task, reminder. */
function seriesSave(day: string, input: Entry): void {
  const old = store.day(day).entries.find((x) => x.id === input.id)
  if (!old?.series) throw new Error('Блок не из серии')
  const delta = input.start - old.start
  const dur = input.end - input.start
  const ix = readSeries()
  const sid = old.series.id
  const moved: Array<{ day: string; id: string }> = []
  for (const it of seriesItems(sid)) {
    const e = it.e
    e.kind = input.kind
    e.label = input.label.trim()
    if (input.description) e.description = input.description
    else delete e.description
    if (input.task) e.task = { ...input.task }
    else delete e.task
    if (input.remind) e.remind = { before: input.remind.before, at: input.remind.at !== undefined ? input.remind.at - old.start + e.start : undefined }
    else delete e.remind
    store.markDirty(it.day)
    const start = e.start + delta
    const to = dayKey(start)
    const end = Math.min(dayEnd(to), start + dur)
    if (start !== e.start || end !== e.end) moveEntry(it.day, to, e.id, start, end)
    moved.push({ day: to, id: e.id })
  }
  ix[sid] = moved
  writeSeries(ix)
  store.flush()
  broadcast()
}

// ---------- reminders: a notification when the time comes ----------
function checkReminders(): void {
  const now = Date.now()
  const from = dayKey(now - 2 * 86_400_000)
  for (const dk of store.listDays()) {
    if (dk < from) continue
    const d = store.day(dk)
    let changed = false
    const fire = (x: { remind?: Remind }, start: number, title: string, open: { entryId?: string }) => {
      const at = remindAt(x.remind, start)
      if (at === undefined || x.remind?.fired || at > now) return
      x.remind = { ...x.remind, fired: true }
      changed = true
      // older than half a day (the app was off) — just marked, no late popup
      if (now - at > 12 * 3_600_000) return
      if (!Notification.isSupported()) return
      const n = new Notification({ title: `Напоминание · ${new Date(start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`, body: title || 'Событие' })
      n.on('click', () => showMain({ day: dk, ...open }))
      n.show()
    }
    for (const e of d.entries) fire(e, e.start, e.label, { entryId: e.id })
    for (const n of d.notes) fire(n, n.at, (n.text || n.transcript || 'Заметка').split('\n')[0].slice(0, 120), {})
    if (changed) store.markDirty(dk)
  }
}

/** A block moved to another day (the task calendar): it leaves `from`, lands on `to` at [start, end]. */
function moveEntry(from: string, to: string, id: string, start: number, end: number): void {
  if (!(end > start)) throw new Error('Конец должен быть позже начала')
  const a = store.day(from)
  const e = a.entries.find((x) => x.id === id)
  if (!e) throw new Error('Блок не найден')
  if (e.outlook) throw new Error(OUTLOOK_RO)
  if (from === to) {
    a.entries = pinLanes(putEntry(a.entries, { ...e, start, end }), id)
    store.markDirty(from)
  } else {
    const b = store.day(to)
    a.entries = a.entries.filter((x) => x.id !== id)
    const moved = { ...e, start, end, lane: undefined }
    b.entries = pinLanes(putEntry(b.entries, { ...moved, lane: firstFreeLane(b.entries, start, end, id) }), id)
    store.markDirty(from)
    store.markDirty(to)
  }
  store.flush()
  broadcast()
}

function publicSettings() {
  return store.publicSettings()
}

function registerIpc(): void {
  ipcMain.handle(IPC.getDay, (_e, day: string) => store.day(day))
  ipcMain.handle(IPC.getLive, () => ({ ...tracker.live, now: Date.now() }))

  saveEntryImpl = (day: string, input: Omit<Entry, 'id'> & { id?: string }, opts?: { overlap?: boolean }): Entry => {
    if (!(input.end > input.start)) throw new Error('Конец записи должен быть позже начала')
    const d = store.day(day)
    const prev = input.id ? d.entries.find((e) => e.id === input.id) : undefined
    if (prev?.outlook) throw new Error(OUTLOOK_RO)
    const entry: Entry = { ...prev, ...input, id: input.id ?? randomUUID(), label: input.label.trim(), created: prev?.created ?? input.created ?? (prev ? undefined : Date.now()) }
    if (entry.created === undefined) delete entry.created
    if (!entry.remind) delete entry.remind
    else if (prev?.remind && (remindAt(prev.remind, prev.start) !== remindAt(entry.remind, entry.start))) entry.remind = { ...entry.remind, fired: false }
    // a new block dropped over existing ones goes to the first free lane; existing blocks keep theirs
    if (opts?.overlap && !prev && entry.lane === undefined) entry.lane = firstFreeLane(d.entries, entry.start, entry.end, entry.id)
    // with overlaps the resulting layout is frozen into every block's lane — it stays exactly as shown
    d.entries = opts?.overlap ? pinLanes(putEntry(d.entries, entry), entry.id) : placeEntry(d.entries, entry, randomUUID)
    store.markDirty(day)
    store.flush()
    broadcast()
    return entry
  }
  ipcMain.handle(IPC.saveEntry, (_e, day: string, input: Omit<Entry, 'id'> & { id?: string }, opts?: { overlap?: boolean }) => saveEntryImpl(day, input, opts))

  ipcMain.handle(IPC.mergeEntries, (_e, day: string, ids: string[]) => {
    const d = store.day(day)
    if (d.entries.some((e) => ids.includes(e.id) && e.outlook)) throw new Error(OUTLOOK_RO)
    const r = mergeEntries(d.entries, ids)
    if (!r) return undefined
    d.entries = pinLanes(
      putEntry(
        d.entries.filter((e) => !r.removed.includes(e.id)),
        r.merged,
      ),
    )
    store.markDirty(day)
    store.flush()
    broadcast()
    return r.merged
  })

  // ---------- release builder (the former VS Code extension) ----------
  setReleaseDataDir(store.root)
  // the git work runs in its own process below normal priority — the app (and the mouse) stay smooth
  let releaseWorker: UtilityProcess | undefined
  const worker = (): UtilityProcess => {
    if (releaseWorker) return releaseWorker
    const w = utilityProcess.fork(join(__dirname, 'releaseWorker.js'), [], { serviceName: 'Qvarch Release' })
    w.on('message', (m: { type: string; msg?: unknown }) => {
      if (m?.type === 'msg' && mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(IPC.releaseMsg, m.msg)
    })
    w.on('exit', () => {
      if (releaseWorker === w) releaseWorker = undefined
    })
    w.postMessage({ type: 'init', dataDir: store.root })
    releaseWorker = w
    return w
  }
  app.on('before-quit', () => releaseWorker?.kill())
  ipcMain.handle(IPC.releaseOpen, (_e, id: string, resume?: boolean) => {
    if (!readProjects().some((p) => p.id === id)) throw new Error('Проект не найден')
    // the section gets its data by messages as git answers — the call itself returns at once
    worker().postMessage({ type: 'open', id, resume })
  })
  ipcMain.handle(IPC.releaseCmd, (_e, msg: { command: string } & Record<string, unknown>) => worker().postMessage({ type: 'cmd', msg }))
  ipcMain.handle(IPC.releaseProjects, () => readProjects())
  ipcMain.handle(IPC.releaseSaveProject, (_e, p: Record<string, unknown>) => saveProject(p))
  ipcMain.handle(IPC.releaseDeleteProject, (_e, id: string) => deleteProject(id))
  ipcMain.handle(IPC.releaseImport, () => importVscodeProjects())
  ipcMain.handle(IPC.releasePickFolder, async () => {
    const r = mainWin ? await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? undefined : r.filePaths[0]
  })
  ipcMain.handle(IPC.releaseOpenInCode, (_e, path: string) => {
    // "code" is a .cmd on Windows — through the shell; the path is quoted
    const child = spawn('code', [`"${path.replace(/"/g, '')}"`], { shell: true, detached: true, stdio: 'ignore' })
    child.unref()
  })

  // ---------- the pen tablet (Qvarch reads it and drives the mouse) ----------
  tablet = new TabletService(
    store.root,
    () => (mainWin && !mainWin.isDestroyed() ? mainWin.getNativeWindowHandle().readBigUInt64LE(0) : undefined),
    (msg) => {
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(IPC.tabletMsg, msg)
    },
  )
  ipcMain.handle(IPC.tabletState, () => tablet!.state())
  ipcMain.handle(IPC.tabletSet, (_e, patch: Record<string, unknown>) => tablet!.set(patch))
  ipcMain.handle(IPC.tabletLive, (_e, on: boolean) => tablet!.live(!!on))
  ipcMain.handle(IPC.tabletCanvas, (_e, rect: { x: number; y: number; w: number; h: number } | null) =>
    tablet!.canvas(rect && rect.w > 0 && rect.h > 0 ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) } : undefined),
  )

  // ---------- PDF signing: the drawings live in data/signatures (PNG) ----------
  const sigDir = join(store.root, 'signatures')
  ipcMain.handle(IPC.sigList, () => {
    if (!existsSync(sigDir)) return []
    return readdirSync(sigDir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => ({ id: f.slice(0, -4), url: `data:image/png;base64,${readFileSync(join(sigDir, f)).toString('base64')}`, at: statSync(join(sigDir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .map(({ id, url }) => ({ id, url }))
  })
  ipcMain.handle(IPC.sigSave, (_e, url: string) => {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(url)
    if (!m) throw new Error('Не PNG')
    mkdirSync(sigDir, { recursive: true })
    const id = randomUUID()
    writeFileSync(join(sigDir, `${id}.png`), Buffer.from(m[1], 'base64'))
    return id
  })
  ipcMain.handle(IPC.sigDelete, (_e, id: string) => {
    if (/^[\w-]+$/.test(id)) rmSync(join(sigDir, `${id}.png`), { force: true })
  })
  ipcMain.handle(IPC.imageSave, async (_e, bytes: Uint8Array, name: string, ext: 'png' | 'svg') => {
    const e = ext === 'svg' ? 'svg' : 'png'
    const opts = { defaultPath: name, filters: [{ name: e.toUpperCase(), extensions: [e] }] }
    const r = mainWin ? await dialog.showSaveDialog(mainWin, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return undefined
    writeFileSync(r.filePath, Buffer.from(bytes))
    return r.filePath
  })
  ipcMain.handle(IPC.fileSave, async (_e, bytes: Uint8Array, name: string, ext: string) => {
    const e = /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : 'bin'
    const opts = { defaultPath: name, filters: [{ name: e.toUpperCase(), extensions: [e] }, { name: 'Все файлы', extensions: ['*'] }] }
    const r = mainWin ? await dialog.showSaveDialog(mainWin, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return undefined
    writeFileSync(r.filePath, Buffer.from(bytes))
    return r.filePath
  })
  ipcMain.handle(IPC.hashOf, async (_e, src: { text?: string; bytes?: Uint8Array; path?: string }, key?: string) => {
    const algs = ['md5', 'sha1', 'sha256', 'sha512'] as const
    const hs = algs.map((a) => (key ? createHmac(a, key) : createHash(a)))
    if (typeof src?.path === 'string' && src.path) {
      // a file of any size: read in pieces
      for await (const chunk of createReadStream(src.path)) for (const h of hs) h.update(chunk as Buffer)
    } else {
      const data = src?.bytes ? Buffer.from(src.bytes) : Buffer.from(String(src?.text ?? ''), 'utf8')
      for (const h of hs) h.update(data)
    }
    return Object.fromEntries(algs.map((a, i) => [a, hs[i].digest('hex')]))
  })
  ipcMain.handle(IPC.pdfSave, async (_e, bytes: Uint8Array, name: string) => {
    const opts = { defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
    const r = mainWin ? await dialog.showSaveDialog(mainWin, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return undefined
    writeFileSync(r.filePath, Buffer.from(bytes))
    return r.filePath
  })

  // every event of every day, light (the notebook's «@» list and its chips)
  ipcMain.handle(IPC.eventsIndex, (): EventRef[] => {
    const out: EventRef[] = []
    for (const day of store.listDays()) {
      const d = store.peek(day)
      if (!d) continue
      for (const e of d.entries) out.push({ day, id: e.id, label: e.label, kind: e.kind, start: e.start, end: e.end, outlook: !!e.outlook, ...(e.task ? { task: e.task.key } : {}), ...(e.created ? { created: e.created } : {}) })
    }
    return out
  })
  ipcMain.handle(IPC.rangeDays, (_e, from: string, to: string) => {
    return store
      .listDays()
      .filter((d) => d >= from && d <= to)
      .map((day) => {
        const d = store.peek(day)
        if (!d) return undefined
        return { day, entries: d.entries }
      })
      .filter((x) => !!x)
  })

  ipcMain.handle(IPC.moveEntry, (_e, from: string, to: string, id: string, start: number, end: number) => moveEntry(from, to, id, start, end))

  ipcMain.handle(IPC.deleteEntry, (_e, day: string, id: string) => {
    if (store.day(day).entries.find((e) => e.id === id)?.outlook) throw new Error(OUTLOOK_RO)
    removeEntry(day, id)
    store.flush()
    broadcast()
  })
  // ---------- repeats & reminders ----------
  ipcMain.handle(IPC.repeatEntry, (_e, day: string, id: string, rule: RepeatRule, count: number) => repeatEntry(day, id, rule, count))
  ipcMain.handle(IPC.seriesSave, (_e, day: string, input: Entry) => seriesSave(day, input))
  ipcMain.handle(IPC.seriesDelete, (_e, day: string, id: string) => {
    const e = store.day(day).entries.find((x) => x.id === id)
    if (!e?.series) return removeEntry(day, id)
    for (const it of seriesItems(e.series.id)) removeEntry(it.day, it.e.id)
    store.flush()
    broadcast()
  })
  ipcMain.handle(IPC.setRemind, (_e, day: string, id: string, remind: Remind | null) => {
    const d = store.day(day)
    const e = d.entries.find((x) => x.id === id)
    if (!e) return
    if (remind) e.remind = { before: remind.before, at: remind.at }
    else delete e.remind
    store.markDirty(day)
    store.flush()
    broadcast()
  })

  ipcMain.handle(IPC.saveNote, (_e, day: string, input: { id: string; at: number; text: string; remind?: Remind | null }) => {
    const d = store.day(day)
    const prev = d.notes.find((n) => n.id === input.id)
    const note: Note = { ...prev, id: input.id, at: input.at, text: input.text, updatedAt: Date.now() }
    // undefined — the reminder stays as it was; null — removed; a new time — it will fire again
    if (input.remind === null) delete note.remind
    else if (input.remind) note.remind = remindAt(input.remind, note.at) === remindAt(prev?.remind, note.at) && prev?.remind ? prev.remind : { at: input.remind.at, before: input.remind.before }
    d.notes = [...d.notes.filter((n) => n.id !== note.id), note]
    store.markDirty(day)
    store.flush()
    broadcast()
    return note
  })

  // ---------- voice notes / call recordings ----------
  ipcMain.handle(IPC.voiceState, () => voice.state())
  ipcMain.handle(IPC.voiceDownloadModel, (_e, id: string) => {
    if (!isWhisperModel(id)) throw new Error('Неизвестная модель')
    return voice.downloadModel(id)
  })
  ipcMain.handle(IPC.voiceDeleteModel, (_e, id: string) => {
    if (!isWhisperModel(id)) throw new Error('Неизвестная модель')
    voice.deleteModel(id)
  })
  ipcMain.handle(IPC.readAudio, (_e, file: string) => voice.readAudio(String(file)))
  ipcMain.handle(IPC.saveAudioNote, (_e, day: string, input: { id: string; at: number; durationSec: number; kind: 'voice' | 'call'; text?: string; entryId?: string }, audio: Uint8Array) => {
    const d = store.day(day)
    const file = voice.saveAudio(day, input.id, audio)
    const note: Note = {
      id: input.id,
      at: input.at,
      text: input.text ?? '',
      updatedAt: Date.now(),
      audio: { file, durationSec: Math.round(input.durationSec), kind: input.kind },
      ...(input.entryId ? { entryId: input.entryId } : {}),
    }
    d.notes = [...d.notes.filter((n) => n.id !== note.id), note]
    store.markDirty(day)
    store.flush()
    broadcast()
    return note
  })
  ipcMain.handle(IPC.transcribeNote, async (_e, day: string, noteId: string, wav: Uint8Array) => {
    if (!store.cfg.voice.enabled) throw new Error('Расшифровка выключена в настройках')
    const text = await voice.transcribe(noteId, wav)
    const d = store.day(day)
    // the note may have been deleted meanwhile — then there is nothing to update
    const n = d.notes.find((x) => x.id === noteId)
    if (n) {
      n.transcript = text
      n.updatedAt = Date.now()
      // dictated for a block: the transcript becomes the block's text (unless the user already wrote one)
      const e = n.entryId ? d.entries.find((x) => x.id === n.entryId) : undefined
      if (e && text && e.label === VOICE_PENDING) {
        const t = titleFromTranscript(text)
        e.label = t.label
        e.description = e.description ?? t.description
      }
      store.markDirty(day)
      store.flush()
      broadcast()
    }
    return text
  })

  // ---------- search & own tasks ----------
  ipcMain.handle(IPC.search, (_e, q: string) => store.search(String(q ?? '')))
  ipcMain.handle(IPC.tasks, () => store.tasks())
  ipcMain.handle(IPC.saveTask, (_e, t: LocalTask) => {
    const task = store.putTask({ ...t, title: t.title.trim() || 'Без названия' })
    tasksChanged()
    broadcast() // a renamed task shows its new title on the calendar / blocks
    return task
  })
  ipcMain.handle(IPC.deleteTask, (_e, id: string) => {
    store.deleteTask(id)
    // notes made into this task are unlinked
    for (const day of store.listDays()) {
      const d = store.day(day)
      if (d.notes.some((n) => n.taskId === id)) {
        for (const n of d.notes) if (n.taskId === id) delete n.taskId
        store.markDirty(day)
      }
    }
    store.flush()
    tasksChanged()
    broadcast()
  })
  ipcMain.handle(IPC.noteToTask, (_e, day: string, noteId: string) => {
    const d = store.day(day)
    const n = d.notes.find((x) => x.id === noteId)
    if (!n) throw new Error('Заметка не найдена')
    // the note becomes a "Задача" block on the timeline (now, 30 min); the note goes
    const text = (n.text.trim() || n.transcript?.trim() || '').replace(/\r/g, '')
    const [first, ...rest] = text.split('\n')
    const title = (first ?? '').replace(/^[#>*\-\s]+/, '').slice(0, 160) || 'Задача из заметки'
    const description = [rest.join('\n').trim(), n.transcript && n.text.trim() ? `Расшифровка:\n${n.transcript}` : ''].filter(Boolean).join('\n\n') || undefined
    const start = day === dayKey(Date.now()) ? Math.floor(Date.now() / 60_000) * 60_000 : n.at
    const entry: Entry = {
      id: randomUUID(),
      start,
      end: Math.min(dayEnd(day), start + 30 * 60_000),
      kind: 'task',
      label: title,
      description,
      source: 'manual',
      ...(n.remind ? { remind: n.remind } : {}),
    }
    entry.lane = firstFreeLane(d.entries, entry.start, entry.end, entry.id)
    d.entries = pinLanes(putEntry(d.entries, entry), entry.id)
    voice.cancel(noteId)
    if (n.audio) voice.removeAudio(n.audio.file)
    d.notes = d.notes.filter((x) => x.id !== noteId)
    store.markDirty(day)
    store.flush()
    broadcast()
    return entry
  })

  // ---------- «Моя работа» ----------
  const taskRef = (t: unknown): { key: string; summary: string } | undefined => {
    const x = t as { key?: unknown; summary?: unknown } | null
    return x && typeof x.key === 'string' && x.key.trim() ? { key: x.key.trim(), summary: typeof x.summary === 'string' ? x.summary : '' } : undefined
  }
  ipcMain.handle(IPC.setDayTasks, (_e, day: string, tasks: unknown[]) => {
    const d = store.day(day)
    const list = (Array.isArray(tasks) ? tasks : []).map(taskRef).filter((x): x is { key: string; summary: string } => !!x)
    // each task once
    d.dayTasks = list.filter((t, i) => list.findIndex((x) => x.key === t.key) === i)
    store.markDirty(day)
    store.flush()
    broadcast()
  })
  ipcMain.handle(IPC.setEntryTask, (_e, day: string, id: string, task: unknown) => {
    const d = store.day(day)
    const e = d.entries.find((x) => x.id === id)
    if (!e) throw new Error('Запись не найдена')
    // an Outlook meeting too: only its task changes (time and title stay Outlook's)
    const t = task === null ? undefined : taskRef(task)
    if (t) e.task = t
    else delete e.task
    store.markDirty(day)
    store.flush()
    broadcast()
  })

  ipcMain.handle(IPC.planDone, (_e, day: string, id: string) => {
    const d = store.day(day)
    const p = (d.plan ?? []).find((x) => x.id === id)
    if (!p) return undefined
    // pressed again (or from another place) — the block is already there
    const made = p.doneEntryId ? d.entries.find((e) => e.id === p.doneEntryId) : undefined
    if (made) return made
    const entry: Entry = {
      id: randomUUID(),
      start: p.start,
      end: p.end,
      kind: p.kind,
      label: p.label,
      ...(p.task ? { task: { key: p.task.key, summary: p.task.summary } } : {}),
      source: 'manual',
    }
    entry.lane = firstFreeLane(d.entries, entry.start, entry.end, entry.id)
    d.entries = pinLanes(putEntry(d.entries, entry), entry.id)
    p.doneEntryId = entry.id
    store.markDirty(day)
    store.flush()
    broadcast()
    return entry
  })
  ipcMain.handle(IPC.savePlan, (_e, day: string, block: PlanBlock) => {
    if (!(block.end > block.start)) throw new Error('Конец должен быть позже начала')
    const d = store.day(day)
    const prev = (d.plan ?? []).find((p) => p.id === block.id)
    d.plan = [...(d.plan ?? []).filter((p) => p.id !== block.id), { ...prev, ...block, label: block.label.trim() }]
    store.markDirty(day)
    store.flush()
    broadcast()
    return block
  })

  ipcMain.handle(IPC.deletePlan, (_e, day: string, id: string) => {
    const d = store.day(day)
    d.plan = (d.plan ?? []).filter((p) => p.id !== id)
    store.markDirty(day)
    store.flush()
    broadcast()
  })

  ipcMain.handle(IPC.deleteNote, (_e, day: string, id: string) => {
    const d = store.day(day)
    const audio = d.notes.find((n) => n.id === id)?.audio
    // a transcription still running / queued for this note is stopped first (process killed, temp files removed)
    voice.cancel(id)
    if (audio) voice.removeAudio(audio.file)
    d.notes = d.notes.filter((n) => n.id !== id)
    store.markDirty(day)
    store.flush()
    broadcast()
  })

  ipcMain.handle(IPC.getCombo, () => currentCombo())
  ipcMain.handle(IPC.getPulse, () => pulseBins.slice(-120))

  // ---------- Outlook / Teams ----------
  ipcMain.handle(IPC.outlookState, () => outlook.state())
  ipcMain.handle(IPC.outlookLogin, () => outlook.login())
  ipcMain.handle(IPC.outlookLogout, () => outlook.logout())
  ipcMain.handle(IPC.outlookSync, () => outlook.sync())

  // ---------- Jira ----------
  ipcMain.handle(IPC.jiraState, () => jira.state())
  ipcMain.handle(IPC.jiraLogin, () => jira.login())
  ipcMain.handle(IPC.jiraLogout, () => jira.logout())
  ipcMain.handle(IPC.jiraSync, () => jira.sync())
  ipcMain.handle(IPC.jiraSetSecret, (_e, secret: string) => jira.setSecret(String(secret ?? '')))
  ipcMain.handle(IPC.jiraStar, (_e, key: string, on: boolean) => jira.star(key, on))
  ipcMain.handle(IPC.jiraSetMyStatus, (_e, key: string, status: MyTaskStatus | null) => jira.setMyStatus(key, status))
  /** A day as far as it happened: today's planned (future) blocks are not time spent yet. */
  const spentDay = (day: string) => {
    const d = store.day(day)
    return day === dayKey(Date.now()) ? { ...d, entries: clipEntries(d.entries, Date.now()) } : d
  }
  /** The task calendar: blocks and notes of the stored days in [from, to] — nothing heavier. */
  ipcMain.handle(IPC.calendarRange, (_e, from: string, to: string) => {
    return store
      .listDays()
      .filter((d) => d >= from && d <= to)
      .map((day) => {
        const d = store.day(day)
        return { day, entries: d.entries, notes: d.notes, plan: d.plan ?? [], dayTasks: d.dayTasks ?? [] }
      })
  })
  ipcMain.handle(IPC.jiraTracked, () => keyTotals(store.listDays().map(spentDay)))
  /** Every block of every day linked to a task (the planned ones too) — when a task was / will be worked on. */
  ipcMain.handle(IPC.jiraWorked, () => {
    const out: Record<string, Array<{ day: string; id: string; start: number; end: number }>> = {}
    for (const day of store.listDays()) for (const e of store.day(day).entries) if (e.task?.key) (out[e.task.key] ??= []).push({ day, id: e.id, start: e.start, end: e.end })
    return out
  })
  ipcMain.handle(IPC.jiraFind, (_e, q: string, offset: number, limit: number, mode?: string, query?: JiraListQuery) =>
    jira.find(String(q ?? ''), Number(offset) || 0, Number(limit) || 50, mode === 'pick' ? 'pick' : 'list', query && typeof query === 'object' ? query : undefined),
  )
  ipcMain.handle(IPC.jiraIssue, (_e, key: string) => jira.issue(String(key)))
  ipcMain.handle(IPC.jiraVersions, (_e, q: string, offset: number, limit: number) => jira.findVersions(String(q ?? ''), Number(offset) || 0, Number(limit) || 40))
  ipcMain.handle(IPC.jiraVersionIssues, (_e, id: string) => jira.versionIssues(String(id)))
  // ---------- the terminal ----------
  const toMain = (ch: string, ...args: unknown[]) => mainWin && !mainWin.isDestroyed() && mainWin.webContents.send(ch, ...args)
  terminals = new Terminals(store.root, (id, data, end) => toMain(IPC.termData, id, data, end), (list) => {
    toMain(IPC.termState, list)
    if (island && !island.win.isDestroyed()) island.win.webContents.send(IPC.termState, list)
  }, (list, watchError) => toMain(IPC.termAlertsEv, { list, watchError }))
  const term = terminals
  ipcMain.handle(IPC.termCreate, (_e, cwd?: string) => term.create(typeof cwd === 'string' ? cwd : undefined))
  ipcMain.on(IPC.termWrite, (_e, id: string, data: string) => term.write(String(id), String(data)))
  ipcMain.on(IPC.termResize, (_e, id: string, cols: number, rows: number) => term.resize(String(id), Number(cols), Number(rows)))
  ipcMain.handle(IPC.termKill, (_e, id: string) => term.kill(String(id)))
  ipcMain.handle(IPC.termRename, (_e, id: string, title: string) => term.rename(String(id), String(title)))
  ipcMain.handle(IPC.termReplay, (_e, id: string) => term.replay(String(id)))
  ipcMain.handle(IPC.termValues, (_e, id?: string) => term.values(typeof id === 'string' ? id : undefined))
  ipcMain.handle(IPC.termAlerts, () => term.alerts())
  ipcMain.handle(IPC.termDismiss, (_e, id?: string) => term.dismiss(typeof id === 'string' ? id : undefined))
  ipcMain.handle(IPC.termList, () => term.list())
  ipcMain.handle(IPC.termDirs, (_e, p: string) => term.dirs(String(p)))
  ipcMain.handle(IPC.termConfig, () => term.cfg)
  ipcMain.handle(IPC.termSetConfig, (_e, c: Partial<TermConfig>) => term.setConfig(JSON.parse(JSON.stringify(c)) as Partial<TermConfig>))
  ipcMain.handle(IPC.termRender, (_e, id: string, cmd: string, answers: Record<string, string>) => term.render(String(id), String(cmd), answers ?? {}))

  // ---------- HTTP ----------
  const http = new HttpClient(store.root)
  ipcMain.handle(IPC.httpLoad, () => http.load())
  ipcMain.handle(IPC.httpSave, (_e, doc: HttpDoc) => http.save(doc))
  ipcMain.handle(IPC.httpRun, (_e, req: HttpRequest, doc: HttpDoc, runId?: string) => http.run(req, doc, typeof runId === 'string' ? runId : undefined))
  ipcMain.handle(IPC.httpChain, (_e, ids: string[], doc: HttpDoc, stopOn: string, runId: string) =>
    http.chain(Array.isArray(ids) ? ids.map(String) : [], doc, String(stopOn ?? ''), String(runId), (i, id, out) => toMain(IPC.httpChainEv, runId, i, id, out)),
  )
  ipcMain.handle(IPC.httpAbort, (_e, runId: string) => http.abort(String(runId)))
  ipcMain.handle(IPC.httpImport, (_e, folder: HttpFolder, vars: HttpKV[]) => http.import(JSON.parse(JSON.stringify(folder)) as HttpFolder, JSON.parse(JSON.stringify(vars)) as HttpKV[]))

  // ---------- Инструменты · the clipboard's history ----------
  const clips = new ClipLog(store.root, (s) => toMain(IPC.clipEv, s))
  clipLog = clips
  ipcMain.handle(IPC.clip, (_e, m: string, a?: unknown) => {
    if (m === 'get') return clips.get()
    if (m === 'set') return clips.setOn(!!a)
    if (m === 'remove') return clips.remove(String(a))
    if (m === 'clear') return clips.clear()
    if (m === 'copy') return clips.copy(String(a))
    throw new Error(`clip: нет метода ${m}`)
  })

  // ---------- the browser ----------
  browser = new Browser(store.root, (type, payload) => toMain(IPC.browserEv, type, payload))
  if (mainWin && !mainWin.isDestroyed()) browser.attach(mainWin)
  const br = browser
  ipcMain.handle(IPC.browser, (_e, m: string, ...a: unknown[]) => {
    if (!BROWSER_METHODS.includes(m as (typeof BROWSER_METHODS)[number])) throw new Error(`browser: нет метода ${m}`)
    return (br[m as (typeof BROWSER_METHODS)[number]] as (...x: unknown[]) => unknown).apply(br, a)
  })
  // a file picked while recording: into the notebook's «Записанные»
  br.onRecordFiles = (paths) => files().recorded(paths)
  ipcMain.handle(IPC.files, (_e, m: string, ...a: unknown[]) => {
    if (!TEST_FILES_METHODS.includes(m as (typeof TEST_FILES_METHODS)[number])) throw new Error(`files: нет метода ${m}`)
    const tf = files()
    return (tf[m as (typeof TEST_FILES_METHODS)[number]] as (...x: unknown[]) => unknown).apply(tf, a)
  })
  // «Базы данных»: made on its first use (the notebook is there by then)
  ipcMain.handle(IPC.sql, (_e, m: string, ...a: unknown[]) => {
    if (!SQL_METHODS.includes(m as (typeof SQL_METHODS)[number])) throw new Error(`sql: нет метода ${m}`)
    sqlStore ??= new SqlStore(store.root, join(__dirname, 'sqlWorker.js'), vault)
    const db = sqlStore
    return (db[m as (typeof SQL_METHODS)[number]] as (...x: unknown[]) => unknown).apply(db, a)
  })
  ipcMain.on(IPC.browserLayout, (_e, rects: Parameters<Browser['layout']>[0]) => br.layout(Array.isArray(rects) ? rects : []))

  ipcMain.handle(IPC.copyImage, async (_e, bytes: Uint8Array) => {
    // (a JPEG too — the clipboard takes it as PNG)
    const img = nativeImage.createFromBuffer(Buffer.from(bytes))
    if (img.isEmpty()) throw new Error('это не картинка')
    await sysClipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })])
  })
  ipcMain.on(IPC.openExternal, (_e, url: string) => {
    // web pages only (Jira, links in notes) — never file:// or app protocols
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle(IPC.getSettings, () => publicSettings())
  ipcMain.handle(IPC.updateSettings, async (_e, patch: SettingsPatch) => {
    const outlookBefore = JSON.stringify(store.cfg.outlook)
    const jiraEvery = store.cfg.jira.syncMin
    store.update(patch)
    if (patch.ui?.theme) applyWindowTheme()
    if (JSON.stringify(store.cfg.outlook) !== outlookBefore) outlook.start()
    if (store.cfg.jira.syncMin !== jiraEvery) jira.schedule()
    if (patch.autoStart !== undefined) applyAutoStart()
    if (patch.sampleIntervalMs) probe.setInterval(patch.sampleIntervalMs)
    if (patch.captureTitles !== undefined) probe.setTitles(patch.captureTitles)
    if (patch.countKeys !== undefined) probe.setKeys(patch.countKeys)
    if (patch.voice) for (const w of [mainWin, island?.win]) if (w && !w.isDestroyed()) w.webContents.send(IPC.voice, voice.state())
    const s = publicSettings()
    for (const w of [mainWin, island?.win]) if (w && !w.isDestroyed()) w.webContents.send(IPC.settings, s)
    return s
  })

  // ---------- the notebook ----------
  const str = (v: unknown) => String(v ?? '')
  ipcMain.handle(IPC.vaultTree, () => vault.tree())
  ipcMain.handle(IPC.vaultRead, (_e, p: string) => vault.read(str(p)))
  ipcMain.handle(IPC.vaultWrite, (_e, p: string, text: string) => vault.write(str(p), str(text)))
  ipcMain.handle(IPC.vaultCreate, (_e, dir: string, kind: 'note' | 'folder' | 'board', name?: string, text?: string) =>
    vault.create(str(dir), kind === 'folder' ? 'folder' : kind === 'board' ? 'board' : 'note', name ? str(name) : undefined, text ? str(text) : ''),
  )
  ipcMain.handle(IPC.vaultMove, (_e, from: string, toDir: string, name?: string) => vault.move(str(from), str(toDir), name === undefined ? undefined : str(name)))
  ipcMain.handle(IPC.vaultDelete, (_e, p: string) => vault.remove(str(p)))
  ipcMain.handle(IPC.vaultSearch, (_e, q: string) => vault.search(str(q)))
  ipcMain.handle(IPC.eventMentions, () => vault.eventMentions())
  ipcMain.handle(IPC.vaultSaveAudio, (_e, audio: Uint8Array) => vault.saveAudio(audio))
  ipcMain.handle(IPC.vaultReadAudio, (_e, p: string) => vault.readAudio(str(p)))
  ipcMain.handle(IPC.vaultTranscribe, (_e, wav: Uint8Array, key?: string) => {
    if (!store.cfg.voice.enabled) throw new Error('Расшифровка выключена в настройках')
    return voice.transcribe(`vault-${typeof key === 'string' && key ? key : randomUUID()}`, wav)
  })
  // the recording deleted: its whisper stopped (or taken out of the queue)
  ipcMain.on(IPC.vaultTranscribeCancel, (_e, key: string) => typeof key === 'string' && key && voice.cancel(`vault-${key}`))
  ipcMain.on(IPC.vaultReveal, (_e, p: string) => vault.reveal(str(p)))
  ipcMain.handle(IPC.vaultPair, (_e, a: string, b?: string) => vault.setPair(str(a), typeof b === 'string' && b ? str(b) : undefined))
  // an emoji mark: one emoji (a few code points), no text
  ipcMain.handle(IPC.vaultSetEmoji, (_e, p: string, emoji?: string) => vault.setEmoji(str(p), typeof emoji === 'string' && emoji && emoji.length <= 16 && /\p{Extended_Pictographic}/u.test(emoji) ? emoji : undefined))
  ipcMain.handle(IPC.vaultSetColor, (_e, p: string, color?: string) => vault.setColor(str(p), typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined))
  ipcMain.handle(IPC.vaultDeleteAudio, (_e, p: string) => vault.deleteAudio(str(p)))
  ipcMain.handle(IPC.vaultRestoreAudio, (_e, p: string, audio: Uint8Array) => vault.restoreAudio(str(p), audio))
  ipcMain.handle(IPC.vaultSaveImage, (_e, bytes: Uint8Array) => vault.saveImage(bytes))
  ipcMain.handle(IPC.runLoad, (_e, p: string) => vault.runRead(str(p)))
  ipcMain.handle(IPC.runSave, (_e, p: string, json: string) => vault.runWrite(str(p), str(json)))
  // a document into one file — and back (on another machine)
  ipcMain.handle(IPC.docExport, async (_e, p: string) => {
    const rel = str(p)
    let withRuns = false
    if (vault.hasRuns(rel)) {
      const opts = {
        type: 'question' as const,
        title: 'Экспорт документа',
        message: 'Включить результаты выполнения?',
        detail: 'Контекст заметки и ответы HTTP-блоков. В них могут быть токены, пароли и личные данные — включайте, только если файл не уйдёт посторонним.',
        buttons: ['Без результатов', 'С результатами', 'Отмена'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      }
      const r = mainWin ? await dialog.showMessageBox(mainWin, opts) : await dialog.showMessageBox(opts)
      if (r.response === 2) return undefined
      withRuns = r.response === 1
    }
    const { bundle, missing } = vault.exportDoc(rel, withRuns, app.getVersion())
    const name = (rel.replace(/\/+$/, '').split('/').pop() || 'Документ').replace(/\.(md|qboard)$/i, '')
    const opts = { defaultPath: `${name}.${BUNDLE_EXT}`, filters: [{ name: 'Документ Qvarch', extensions: [BUNDLE_EXT] }] }
    const r = mainWin ? await dialog.showSaveDialog(mainWin, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return undefined
    writeFileSync(r.filePath, JSON.stringify(bundle))
    return { file: r.filePath, docs: bundle.docs.length, files: Object.keys(bundle.files).length, missing }
  })
  ipcMain.handle(IPC.docImport, async (_e, dir: string) => {
    const opts = { properties: ['openFile' as const], filters: [{ name: 'Документ Qvarch', extensions: [BUNDLE_EXT] }, { name: 'Все файлы', extensions: ['*'] }] }
    const r = mainWin ? await dialog.showOpenDialog(mainWin, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return undefined
    if (statSync(r.filePaths[0]).size > MAX_BUNDLE) throw new Error(`Файл больше ${MAX_BUNDLE / 1024 / 1024} МБ`)
    return vault.importDoc(parseBundle(readFileSync(r.filePaths[0], 'utf8')), str(dir))
  })
  // a .qvdoc dropped on the notebook's side
  ipcMain.handle(IPC.docImportFile, (_e, dir: string, file: string) => {
    const p = str(file)
    if (!p.toLowerCase().endsWith(`.${BUNDLE_EXT}`)) throw new Error('Это не документ Qvarch (.qvdoc)')
    if (statSync(p).size > MAX_BUNDLE) throw new Error(`Файл больше ${MAX_BUNDLE / 1024 / 1024} МБ`)
    return vault.importDoc(parseBundle(readFileSync(p, 'utf8')), str(dir))
  })
  // a code block of a note: a process of its own per run (stopped at once, its memory capped)
  const codeRuns = new Map<string, { proc: UtilityProcess; done: (r: unknown) => void; timer: NodeJS.Timeout; off: () => void }>()
  const endRun = (id: string, r: unknown, from?: UtilityProcess) => {
    const run = codeRuns.get(id)
    // (a process killed by a restart, its exit coming late: not the run going on now)
    if (!run || (from && run.proc !== from)) return
    codeRuns.delete(id)
    clearTimeout(run.timer)
    run.off()
    try {
      run.proc.kill()
    } catch {
      // gone
    }
    run.done(r)
  }
  ipcMain.handle(IPC.runCode, (e, runId: string, job: { code: string; ts: boolean; libs: Array<{ code: string; ts: boolean }>; ctx: Record<string, unknown>; runs?: Record<string, unknown>; timeoutSec?: number }) => {
    const id = str(runId)
    endRun(id, { ok: false, error: 'Перезапущено', logs: [], ms: 0 })
    return new Promise((done) => {
      const proc = utilityProcess.fork(join(__dirname, 'codeWorker.js'), [], { serviceName: 'Qvarch Code', execArgv: ['--max-old-space-size=512', '--disable-warning=ExperimentalWarning'] })
      const sec = Math.min(3600, Math.max(1, Number(job.timeoutSec) || 30))
      const timer = setTimeout(() => endRun(id, { ok: false, error: `Остановлено: дольше ${sec} с (timeout=… в строке блока — дать больше)`, logs: [], ms: sec * 1000 }, proc), sec * 1000)
      // (the window that asked is gone: nothing waits for the run)
      const gone = () => endRun(id, { ok: false, error: 'Окно закрыто', logs: [], ms: 0 }, proc)
      e.sender.once('destroyed', gone)
      codeRuns.set(id, { proc, done, timer, off: () => e.sender.off('destroyed', gone) })
      proc.on('message', (m: unknown) => endRun(id, m, proc))
      proc.on('exit', (code) => endRun(id, { ok: false, error: code ? `Процесс выполнения завершился (код ${code}) — возможно, не хватило памяти (предел 512 МБ)` : 'Процесс выполнения завершился', logs: [], ms: 0 }, proc))
      proc.postMessage({ code: str(job.code), ts: !!job.ts, libs: Array.isArray(job.libs) ? job.libs : [], ctx: job.ctx ?? {}, runs: job.runs ?? {} })
    })
  })
  ipcMain.on(IPC.runCodeStop, (_e, runId: string) => endRun(str(runId), { ok: false, error: 'Остановлено', logs: [], ms: 0 }))
  // a loop of a note: its head in a process of its own; each pass it asks for goes to the window that runs the note
  const loopRuns = new Map<string, { proc: UtilityProcess; done: (r: LoopResult) => void; timer: NodeJS.Timeout; off: () => void }>()
  const endLoop = (id: string, r: LoopResult, from?: UtilityProcess) => {
    const run = loopRuns.get(id)
    if (!run || (from && run.proc !== from)) return
    loopRuns.delete(id)
    clearTimeout(run.timer)
    run.off()
    try {
      run.proc.kill()
    } catch {
      // gone
    }
    run.done(r)
  }
  const loopFail = (error: string, ms = 0): LoopResult => ({ ok: false, error, logs: [], passes: 0, ms })
  ipcMain.handle(IPC.runLoop, (e, runId: string, job: LoopJob & { timeoutSec: number }) => {
    const id = str(runId)
    endLoop(id, loopFail('Перезапущено'))
    return new Promise<LoopResult>((done) => {
      const proc = utilityProcess.fork(join(__dirname, 'loopWorker.js'), [], { serviceName: 'Qvarch Loop', execArgv: ['--max-old-space-size=512', '--disable-warning=ExperimentalWarning'] })
      const sec = Math.min(86_400, Math.max(1, Number(job.timeoutSec) || 600))
      const timer = setTimeout(() => endLoop(id, loopFail(`Остановлено: цикл дольше ${sec} с (timeout=… в начале цикла — дать больше)`, sec * 1000), proc), sec * 1000)
      const gone = () => endLoop(id, loopFail('Окно закрыто'), proc)
      e.sender.once('destroyed', gone)
      loopRuns.set(id, { proc, done, timer, off: () => e.sender.off('destroyed', gone) })
      proc.on('message', (m: { type: 'pass'; n: number; vars: Record<string, unknown> } | { type: 'end'; result: LoopResult }) => {
        if (m?.type === 'pass') {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.loopPass, id, m.n, m.vars)
          // (no window to run the pass — the loop has nothing to go on with)
          else endLoop(id, loopFail('Окно закрыто'), proc)
        } else if (m?.type === 'end') endLoop(id, m.result, proc)
      })
      proc.on('exit', (code) => endLoop(id, loopFail(code ? `Процесс цикла завершился (код ${code}) — возможно, не хватило памяти (предел 512 МБ)` : 'Процесс цикла завершился'), proc))
      proc.postMessage({
        type: 'start',
        job: {
          head: str(job.head),
          ts: !!job.ts,
          libs: Array.isArray(job.libs) ? job.libs : [],
          ctx: job.ctx ?? {},
          parallel: Math.min(LOOP_PARALLEL_LIMIT, Math.max(1, Math.floor(Number(job.parallel)) || 1)),
          max: Math.min(LOOP_MAX_LIMIT, Math.max(1, Math.floor(Number(job.max)) || LOOP_MAX)),
        },
      })
    })
  })
  ipcMain.on(IPC.runLoopPass, (_e, runId: string, n: number, result: PassResult) => loopRuns.get(str(runId))?.proc.postMessage({ type: 'pass', n: Number(n), result }))
  ipcMain.on(IPC.runLoopStop, (_e, runId: string) => endLoop(str(runId), loopFail('Остановлено')))
  // a Playwright block: a process of its own per run; asked to stop first (it closes its browser), killed if it does not
  const pwRuns = new Map<string, { proc: UtilityProcess; done: (r: PwResult) => void; timer: NodeJS.Timeout; kill?: NodeJS.Timeout; reason?: string }>()
  const endPw = (id: string, r: PwResult, from?: UtilityProcess) => {
    const run = pwRuns.get(id)
    if (!run || (from && run.proc !== from)) return
    pwRuns.delete(id)
    clearTimeout(run.timer)
    clearTimeout(run.kill)
    try {
      run.proc.kill()
    } catch {
      // gone
    }
    run.done(run.reason && !r.ok ? { ...r, error: run.reason } : r)
  }
  const stopPw = (id: string, reason: string) => {
    const run = pwRuns.get(id)
    if (!run || run.reason) return
    run.reason = reason
    run.proc.postMessage({ type: 'stop' })
    run.kill = setTimeout(() => endPw(id, { ok: false, error: reason, logs: [], ms: 0 }, run.proc), 8000)
  }
  /** The Браузер section's cookies in Playwright's form (a host-only one goes by its address). */
  const browserCookies = async (): Promise<Array<Record<string, unknown>>> => {
    const list = await session.fromPartition('persist:qa-browser').cookies.get({})
    const same = { strict: 'Strict', lax: 'Lax', no_restriction: 'None', unspecified: 'Lax' } as const
    return list
      .filter((c) => c.domain && c.name)
      .map((c) => {
        const host = c.domain!.replace(/^\./, '')
        const sameSite = c.sameSite === 'no_restriction' && !c.secure ? 'Lax' : same[c.sameSite ?? 'unspecified']
        const base = { name: c.name, value: c.value, httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite, ...(c.expirationDate ? { expires: Math.floor(c.expirationDate) } : {}) }
        return c.hostOnly ? { ...base, url: `${c.secure ? 'https' : 'http'}://${host}${c.path ?? '/'}` } : { ...base, domain: c.domain!, path: c.path ?? '/' }
      })
  }
  /**
   * The cookies a run left, back into the Браузер section: a site that renews its session on every visit
   * (a rotating refresh token) would otherwise be signed out there — its old cookie no longer valid.
   * Only the changed and the new ones (what the user did there meanwhile is not overwritten with the same).
   */
  const cookiesBack = async (sent: Array<Record<string, unknown>>, got: unknown): Promise<number> => {
    if (!Array.isArray(got)) return 0
    const key = (c: { name?: unknown; domain?: unknown; path?: unknown; url?: unknown }) => {
      const host = typeof c.url === 'string' ? new URL(c.url).hostname : String(c.domain ?? '').replace(/^\./, '')
      return `${String(c.name)}|${host}|${typeof c.url === 'string' ? new URL(c.url).pathname : String(c.path ?? '/')}`
    }
    const before = new Map(sent.map((c) => [key(c), String(c.value)]))
    const ses = session.fromPartition('persist:qa-browser')
    const same = { Strict: 'strict', Lax: 'lax', None: 'no_restriction' } as const
    let n = 0
    for (const raw of got as Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None' }>) {
      if (!raw?.name || !raw.domain || before.get(key(raw)) === raw.value) continue
      const host = raw.domain.replace(/^\./, '')
      try {
        await ses.cookies.set({
          url: `${raw.secure ? 'https' : 'http'}://${host}${raw.path || '/'}`,
          name: raw.name,
          value: raw.value,
          // a leading dot — for the subdomains too; none — this host only
          ...(raw.domain.startsWith('.') ? { domain: raw.domain } : {}),
          path: raw.path || '/',
          secure: raw.secure,
          httpOnly: raw.httpOnly,
          sameSite: same[raw.sameSite] ?? 'lax',
          ...(raw.expires > 0 ? { expirationDate: raw.expires } : {}),
        })
        n++
      } catch {
        // one refused — the rest still go
      }
    }
    return n
  }
  ipcMain.handle(IPC.runPw, async (e, runId: string, job: PwJob) => {
    const id = str(runId)
    const cookies = job?.session ? await browserCookies().catch(() => []) : undefined
    // the sites the scenario opens: their localStorage from the Браузер (a site's settings — its layout — live there)
    const origins = job?.session
      ? [...String(job.code ?? '').matchAll(/page\.goto\(\s*['"`](https?:\/\/[^'"`]+)/g)].map((m) => {
          try {
            return new URL(m[1]).origin
          } catch {
            return ''
          }
        })
      : []
    const storage = origins.length ? await br.localStorageOf(origins.filter(Boolean)).catch(() => []) : []
    endPw(id, { ok: false, error: 'Перезапущено', logs: [], ms: 0 })
    const note = str(job?.note)
    const dir = vault.runDir(note, str(job?.key))
    rmSync(dir, { recursive: true, force: true })
    return new Promise<PwResult>((done) => {
      const proc = utilityProcess.fork(join(__dirname, 'pwWorker.js'), [], { serviceName: 'Qvarch Playwright', execArgv: ['--max-old-space-size=1024', '--disable-warning=ExperimentalWarning'] })
      const sec = Math.min(3600, Math.max(5, Number(job.timeoutSec) || 120))
      const timer = setTimeout(() => stopPw(id, `Остановлено: дольше ${sec} с (timeout=… в строке блока — дать больше)`), sec * 1000)
      pwRuns.set(id, { proc, done, timer })
      proc.on('message', (m: { type: string; steps?: PwStep[]; result?: PwResult }) => {
        if (m?.type === 'progress' && !e.sender.isDestroyed()) e.sender.send(IPC.pwProgress, id, m.steps ?? [])
        else if (m?.type === 'done' && m.result) {
          const r = m.result as PwResult & { cookies?: unknown }
          const got = r.cookies
          // the cookies never go further (not to the window, not into the saved runs)
          delete r.cookies
          if (cookies && got) {
            void cookiesBack(cookies, got).then((n) => {
              if (n) r.logs = [...r.logs, { level: 'info', text: `Вход сохранён в Браузер: обновлено cookie — ${n}` }]
              endPw(id, r, proc)
            }, () => endPw(id, r, proc))
          } else endPw(id, r, proc)
        }
      })
      proc.on('exit', (code) => endPw(id, { ok: false, error: code ? `Процесс Playwright завершился (код ${code})` : 'Процесс Playwright завершился', logs: [], ms: 0 }, proc))
      const name = (note.split('/').pop() ?? note).replace(/\.md$/i, '')
      proc.postMessage({
        type: 'run',
        job: {
          code: str(job.code),
          ts: !!job.ts,
          libs: Array.isArray(job.libs) ? job.libs : [],
          ctx: job.ctx ?? {},
          runs: job.runs ?? {},
          dir,
          files: files().root,
          name: str(job.name) || 'Сценарий',
          suite: name,
          browser: (PW_BROWSERS as readonly string[]).includes(job.browser) ? job.browser : 'msedge',
          headed: !!job.headed,
          trace: job.trace !== false,
          ignoreHTTPSErrors: br.settings().acceptBadCerts,
          cookies,
          storage,
        },
      })
    })
  })
  ipcMain.on(IPC.runPwStop, (_e, runId: string) => stopPw(str(runId), 'Остановлено'))
  ipcMain.handle(IPC.runFile, (_e, p: string, key: string, name: string) => {
    const n = str(name)
    if (!/^(final|failure)\.png$|^layout-\d+x\d+-\d+\.png$/.test(n)) throw new Error('Недопустимый файл')
    return readFileSync(join(vault.runDir(str(p), str(key)), n))
  })
  const traces = new TraceServer(vault.runsRoot)
  app.on('will-quit', () => (traces.stop(), br.hooks.stop()))
  ipcMain.handle(IPC.pwTrace, async (_e, p: string, key: string) => {
    const url = await traces.url(join(vault.runDir(str(p), str(key)), 'trace.zip'))
    br.open(url)
    showMain({ view: 'browser' })
  })
  // the notes' browser component
  const nbEmit = (host: Electron.WebContents, type: string, payload: unknown) => !host.isDestroyed() && host.send(IPC.nbEv, type, payload)
  setupNoteBrowser(nbEmit)
  // ---------- AI assistants (MCP): the window does the notes' part ----------
  const mcpPending = new Map<string, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: NodeJS.Timeout }>()
  ipcMain.on(IPC.mcpReply, (_e, id: string, ok: boolean, value: unknown) => {
    const p = mcpPending.get(String(id))
    if (!p) return
    mcpPending.delete(String(id))
    clearTimeout(p.timer)
    if (ok) p.ok(value)
    else p.fail(new Error(String(value)))
  })
  const mcpUi = <T>(op: string, args: Record<string, unknown>): Promise<T> =>
    new Promise<T>((ok, fail) => {
      const w = mainWin
      if (!w || w.isDestroyed()) return fail(new Error('Окно Qvarch закрыто — откройте приложение'))
      const id = randomUUID()
      // a run may take long (tests); the rest — seconds
      const timer = setTimeout(() => (mcpPending.delete(id), fail(new Error('Окно Qvarch не ответило'))), op === 'run' ? 30 * 60_000 : 60_000)
      mcpPending.set(id, { ok: ok as (v: unknown) => void, fail, timer })
      w.webContents.send(IPC.mcpCall, id, op, args)
    })
  const mcp: Mcp = new Mcp(
    store.root,
    (): McpTool[] =>
      qvarchTools({
        tree: () => vault.tree(),
        mkdir: (dir, name) => vault.create(dir, 'folder', name),
        issue: (key) => jira.issue(key),
        findIssues: (q) => jira.find(q, 0, 20).items,
        day: (d) => store.day(d),
        saveEntry: (d, input, opts) => saveEntryImpl(d, input, opts),
        openInBrowser: (url) => void br.open(url),
        ui: mcpUi,
        allow: (): string[] => mcp.cfg.allow,
        confirmHosts: async (hosts, note) => {
          const opts = {
            type: 'warning' as const,
            title: 'AI-ассистент: запуск против стенда',
            message: `${note}: адреса не из разрешённого списка`,
            detail: `${hosts.join('\n')}\n\nРазрешены без вопроса: ${mcp.cfg.allow.join(', ')}. Это может быть рабочий стенд — тесты могут менять данные. Разрешить на этот сеанс?`,
            buttons: ['Запретить', 'Разрешить'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          }
          const r = mainWin && !mainWin.isDestroyed() && mainWin.isVisible() ? await dialog.showMessageBox(mainWin, opts) : await dialog.showMessageBox(opts)
          return r.response === 1
        },
      }),
    app.getVersion(),
  )
  void mcp.restart()
  app.on('will-quit', () => mcp.stop())
  ipcMain.handle(IPC.mcpInfo, () => mcp.info())
  ipcMain.handle(IPC.mcpSet, (_e, patch: Parameters<Mcp['set']>[0]) => mcp.set(patch ?? {}))
  ipcMain.handle(IPC.mcpInstall, async (_e, client: 'desktop' | 'code') => {
    const i = mcp.info()
    if (client === 'desktop') {
      // Claude Desktop: its config gets the stdio bridge (the app's exe runs it as Node)
      const file = join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json')
      let cfg: { mcpServers?: Record<string, unknown> } = {}
      try {
        if (existsSync(file)) cfg = JSON.parse(readFileSync(file, 'utf8')) as typeof cfg
      } catch {
        throw new Error(`Не удалось прочитать ${file} — поправьте его вручную`)
      }
      cfg.mcpServers = { ...(cfg.mcpServers ?? {}), qvarch: { command: i.exe, args: [i.bridge], env: { ELECTRON_RUN_AS_NODE: '1' } } }
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, JSON.stringify(cfg, null, 2))
      return `Готово: ${file}. Перезапустите Claude Desktop.`
    }
    // Claude Code (VS Code and the terminal share it): its own command, for the user
    const args = ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'qvarch', i.url, '--header', `Authorization: Bearer ${i.token}`]
    const { execFile } = await import('node:child_process')
    return new Promise<string>((ok, fail) =>
      execFile('claude', args, { shell: true, timeout: 30_000, windowsHide: true }, (err, out, errOut) => {
        if (err) fail(new Error(/not recognized|не является|ENOENT/i.test(String(errOut) + String(err)) ? 'Команда claude не найдена — выполните её вручную (скопируйте ниже)' : String(errOut || err.message).trim()))
        else ok(String(out).trim() || 'Готово: qvarch добавлен в Claude Code')
      }),
    )
  })
  ipcMain.handle(IPC.nbNet, (e, id: number, on: boolean, preserve?: boolean) => netListen(e.sender, Number(id), !!on, !!preserve, nbEmit))
  ipcMain.handle(IPC.nbNetClear, (e, id: number) => netClear(e.sender, Number(id)))
  ipcMain.on(IPC.browserOpen, (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
    br.open(url)
    showMain({ view: 'browser' })
  })
  ipcMain.on(IPC.pwAllure, (_e, p: string, key: string) => {
    const dir = join(vault.runDir(str(p), str(key)), 'allure-results')
    if (existsSync(dir)) void shell.openPath(dir)
  })
  ipcMain.handle(IPC.vaultReadImage, (_e, p: string) => vault.readImage(str(p)))
  ipcMain.handle(IPC.vaultDeleteImage, (_e, p: string) => vault.deleteImage(str(p)))
  ipcMain.handle(IPC.vaultRestoreImage, (_e, p: string, bytes: Uint8Array) => vault.restoreImage(str(p), bytes))
  ipcMain.handle(IPC.vaultClipImage, (_e, save: boolean) => vault.clipImage(!!save))
  ipcMain.handle(IPC.vaultFetchImage, (_e, url: string) => vault.fetchImage(str(url)))

  ipcMain.handle(IPC.getSelection, () => selection)
  ipcMain.on(IPC.setSelection, (_e, sel: Selection | null) => {
    selection = sel
    broadcast()
  })

  ipcMain.on(IPC.islandSolid, (_e, solid: boolean) => island?.setSolid(solid))
  ipcMain.on(IPC.islandRect, (_e, r: { x: number; y: number; width: number; height: number }) => island?.setRect(r))
  ipcMain.on(IPC.islandBlur, () => island?.blur())
  ipcMain.on(IPC.islandFocus, () => island?.focus())
  ipcMain.handle(IPC.getIslandLayout, () => island?.islandLayout ?? { up: false })
  ipcMain.on(IPC.openMain, (_e, day?: string, entryId?: string) => showMain(day || entryId ? { day, entryId } : undefined))
  ipcMain.on(IPC.command, (_e, cmd: AppCommand) => runCommand(cmd))
}

// ---------- lifecycle ----------

app.on('second-instance', () => showMain())


app.whenReady().then(() => {
  fixShortcut()
  // no application menu: Electron's default one (hidden behind our title bar) still owns Ctrl+Z / Ctrl+Y (its
  // "Edit → Undo" — the page never sees the key, a board can't undo) and Ctrl+= / Ctrl+- (Chromium's page zoom,
  // shared with the island). Text fields keep their own undo, copy and paste.
  Menu.setApplicationMenu(null)
  store = new Store()
  tracker = new Tracker(store, broadcast)
  probe = new Probe(
    store.cfg.sampleIntervalMs,
    (s) => {
      const settings = store.cfg
      tracker.onSample(s, settings.sampleIntervalMs, settings.captureTitles)
      if (settings.countKeys && s.pid !== process.pid) countSwitch(s.proc)
      autoLunch()
    },
    onInput,
  )

  jira = new Jira(store.root, () => store.cfg.jira, (s) => {
    for (const w of [mainWin, island?.win]) if (w && !w.isDestroyed()) w.webContents.send(IPC.jira, s)
  })
  outlook = new Outlook(
    store.root,
    () => store.cfg.outlook,
    (s) => {
      for (const w of [mainWin, island?.win]) if (w && !w.isDestroyed()) w.webContents.send(IPC.outlook, s)
    },
    (events, from, to) => {
      // every day of the synced window follows Outlook
      for (let day = dayKey(from); dayStart(day) < to; day = shiftDay(day, 1)) {
        const d = store.day(day)
        if (applyMeetings(d, events, store.cfg.kinds, randomUUID)) store.markDirty(day)
      }
      store.flush()
      broadcast()
    },
    (inCall) => tracker.setPresenceCall(inCall),
  )
  vault = new Vault(store.root, (paths) => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(IPC.vault, paths)
  })
  vault.watch()
  voice = new Voice(store.root, () => (isWhisperModel(store.cfg.voice.model) ? store.cfg.voice.model : 'small'), (s) => {
    for (const w of [mainWin, island?.win]) if (w && !w.isDestroyed()) w.webContents.send(IPC.voice, s)
  })
  // recording a call: the system sound (loopback — the other side) comes with a screen capture request
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, callback) => {
      void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => callback({ video: sources[0], audio: 'loopback' }))
    },
    { useSystemPicker: false },
  )
  registerIpc()
  if (SNAP) {
    Island.hidden = true
    mainWin = createMainWindow()
    browser?.attach(mainWin)
    applyWindowTheme()
    createIslandWindow()
    // a broken steps file must not leave the app hanging
    runSnap(SNAP, mainWin, island?.win).catch((e) => (console.error('snap:', e), app.exit(1)))
    return
  }
  tracker.start()
  jira.start()
  outlook.start()
  probe.setTitles(store.cfg.captureTitles)
  probe.setKeys(store.cfg.countKeys)
  probe.start()
  tablet?.start()
  createTray()
  createIslandWindow()
  if (!process.argv.includes('--hidden')) showMain()
  applyAutoStart()
  globalShortcut.register(ISLAND_HOTKEY, () => {
    if (!island || island.win.isDestroyed()) createIslandWindow()
    island?.focus()
    island?.win.webContents.send(IPC.islandHotkey)
  })
  // Persist activity regularly even without heartbeats.
  setInterval(() => store.flush(), 10_000)
  setInterval(() => {
    checkReminders()
    broadcast()
  }, 20_000)
})

// Closing windows keeps the tracker alive in the tray.
app.on('window-all-closed', () => undefined)

app.on('before-quit', () => {
  quitting = true
  // the queries going on: cancelled on their servers, their connections closed
  sqlStore?.stopAll()
  globalShortcut.unregisterAll()
  probe?.stop()
  tablet?.stop()
  tracker?.stop()
  jira?.stop()
  outlook?.stop()
  voice?.stop()
  vault?.stop()
  terminals?.killAll()
  browser?.closeAll()
  clipLog?.flush()
  store?.close()
})
