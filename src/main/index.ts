import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, Notification, session, shell, Tray } from 'electron'
import { ReleaseSession } from './release/session'
import { deleteProject, importVscodeProjects, readProjects, releaseState, saveProject, setReleaseDataDir } from './release/config'
import { setReleaseSink } from './release/panel'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type AppCommand } from '../shared/api'
import { clipEntries, dayEnd, dayKey, dayStart, shiftDay, firstFreeLane, mergeEntries, pinLanes, placeEntry, putEntry, scheduleRanges, unionMs } from '../shared/timeline'
import type { DayStateMessage, DaySummary, Entry, LinkEnd, LocalTask, Note, PlanBlock, Selection, SettingsPatch } from '../shared/types'
import { emptyCombo, pushKeys, type ComboState } from '../shared/combo'
import { addToRows, type PulsePoint } from '../shared/pulse'
import { makeIcon } from './icon'
import { Probe } from './probe'
import { Jira } from './jira'
import { Outlook } from './outlook'
import { adoptTime, applyMeetings, linkCallsToMeetings, pairKey } from '../shared/outlook'
import { Ai } from './ai'
import { Voice } from './voice'
import { Vault } from './vault'
import { remindAt, shiftBy, type Remind, type RepeatRule } from '../shared/repeat'
import { isWhisperModel, titleFromTranscript, VOICE_PENDING } from '../shared/voice'
import { addLink, endDay, isCrossDay, pruneLinks, remapLinks, setLinksOf } from '../shared/links'
import { keyTotals } from '../shared/board'
import type { MyTaskStatus } from '../shared/jira'
import { Store } from './store'
import { Tracker } from './tracker'
import { createMainWindow, Island } from './windows'

const ISLAND_HOTKEY = 'Control+Alt+Space'

if (!app.requestSingleInstanceLock()) app.quit()
app.setAppUserModelId('com.qvarch.assistant')

let store: Store
let tracker: Tracker
let probe: Probe
let mainWin: BrowserWindow | undefined
let island: Island | undefined
let selection: Selection | null = null
let tray: Tray | undefined
let jira: Jira
let outlook: Outlook
let ai: Ai
let voice: Voice
let vault: Vault
let quitting = false

// ---------- broadcasting ----------

let pending = false
function broadcast(): void {
  if (pending) return
  pending = true
  setTimeout(() => {
    pending = false
    // a marker left on a previous day is stale
    if (selection && selection.day !== dayKey(Date.now())) selection = null
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
  if (!tracker.live.idle) return
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
  const idle = [...d.activity].reverse().find((a) => a.kind === 'idle' || a.kind === 'locked')
  const idleFrom = idle && now - idle.end < 2 * 60_000 ? idle.start : now
  const start = Math.max(idleFrom, lunch[0] - LUNCH_LEAD_MS)
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

type Nav = { day?: string; entryId?: string; view?: 'day' | 'log' | 'settings' }

function showMain(nav?: Nav): void {
  if (!mainWin || mainWin.isDestroyed()) {
    mainWin = createMainWindow()
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
    { label: 'Журнал дня', click: () => showMain({ view: 'log' }) },
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

/** Removes a link (by id) from the lists of other days. */
function dropLinkElsewhere(linkId: string, days: string[]): void {
  for (const dk of days) {
    const d = store.day(dk)
    if (!d.links?.some((l) => l.id === linkId)) continue
    d.links = d.links.filter((l) => l.id !== linkId)
    store.markDirty(dk)
  }
}
/** A thing of `day` goes away: its links to other days go from those days too. */
const OUTLOOK_RO = 'Встреча из Outlook — её меняет только Outlook'

/** Deletes a block (its links go too). */
function removeEntry(day: string, id: string): void {
  const d = store.day(day)
  dropCrossLinksOf(day, id)
  d.entries = d.entries.filter((e) => e.id !== id)
  if (d.links) d.links = pruneLinks(d)
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

function dropCrossLinksOf(day: string, id: string): void {
  for (const l of store.day(day).links ?? [])
    if ((l.a.id === id || l.b.id === id) && isCrossDay(l, day)) dropLinkElsewhere(l.id, [endDay(l.a, day), endDay(l.b, day)].filter((x) => x !== day))
}

/**
 * A block moved to another day (the task calendar): it leaves `from`, lands on `to` at [start, end];
 * its links follow — with a block that stayed behind they become links across days, with one on `to`
 * they become ordinary again. An Outlook meeting moved away is not brought back on its old day.
 */
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
    const mine = (a.links ?? []).filter((l) => l.a.id === id || l.b.id === id)
    a.links = (a.links ?? []).filter((l) => !mine.includes(l))
    for (const l of mine) {
      // where each end lives now
      const place = (x: LinkEnd): LinkEnd => {
        const dk = x.id === id ? to : endDay(x, from)
        return { type: x.type, id: x.id, ...(x.hint ? { hint: x.hint } : {}), day: dk }
      }
      const la = place(l.a)
      const lb = place(l.b)
      const days = [...new Set([la.day!, lb.day!])]
      // drop the old copies elsewhere, then store the link where its ends are now
      dropLinkElsewhere(l.id, [endDay(l.a, from), endDay(l.b, from)].filter((x) => x !== from))
      for (const dk of days) {
        const d = store.day(dk)
        const strip = (x: LinkEnd): LinkEnd => (days.length === 1 ? { type: x.type, id: x.id } : x)
        d.links = [...(d.links ?? []).filter((x) => x.id !== l.id), { ...l, a: strip(la), b: strip(lb) }]
        store.markDirty(dk)
      }
    }
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

  ipcMain.handle(IPC.saveEntry, (_e, day: string, input: Omit<Entry, 'id'> & { id?: string }, opts?: { overlap?: boolean }) => {
    if (!(input.end > input.start)) throw new Error('Конец записи должен быть позже начала')
    const d = store.day(day)
    const prev = input.id ? d.entries.find((e) => e.id === input.id) : undefined
    if (prev?.outlook) throw new Error(OUTLOOK_RO)
    const entry: Entry = { ...prev, ...input, id: input.id ?? randomUUID(), label: input.label.trim() }
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
  })

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
    if (d.links) d.links = remapLinks(d.links, r.removed, r.merged.id)
    store.markDirty(day)
    store.flush()
    broadcast()
    return r.merged
  })

  // ---------- release builder (the former VS Code extension) ----------
  setReleaseDataDir(store.root)
  setReleaseSink((msg) => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(IPC.releaseMsg, msg)
  })
  let release: ReleaseSession | undefined
  ipcMain.handle(IPC.releaseOpen, (_e, id: string, resume?: boolean) => {
    const project = readProjects().find((p) => p.id === id)
    if (!project) throw new Error('Проект не найден')
    const session = new ReleaseSession({ workspaceState: releaseState })
    release = session
    // the section gets its data by messages as git answers — the call itself returns at once
    void (resume ? session.resume(project, { projectId: project.id, projectName: project.name }) : session.start(project, { projectId: project.id, projectName: project.name }))
  })
  ipcMain.handle(IPC.releaseCmd, (_e, msg: { command: string } & Record<string, unknown>) => release?.dispatch(msg))
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

  ipcMain.handle(IPC.rangeDays, (_e, from: string, to: string) => {
    const now = Date.now()
    return store
      .listDays()
      .filter((d) => d >= from && d <= to)
      .map((day) => {
        const d = store.peek(day)
        if (!d) return undefined
        const spans = d.spans.map((s) => ({ start: s.start, end: s.open ? Math.max(s.end, Math.min(now, dayEnd(day))) : s.end }))
        return { day, entries: d.entries, pcOnMs: unionMs(spans) }
      })
      .filter((x) => !!x)
  })

  ipcMain.handle(IPC.monthSummary, (_e, month: string) => {
    const out: DaySummary[] = []
    const now = Date.now()
    for (const day of store.listDays().filter((x) => x.startsWith(month))) {
      const d = store.day(day)
      const spans = d.spans.map((s) => ({ start: s.start, end: s.open ? Math.max(s.end, Math.min(now, dayEnd(day))) : s.end }))
      const main = d.entries
      const byKind: Record<string, number> = {}
      for (const e of main) byKind[e.kind] = (byKind[e.kind] ?? 0) + (e.end - e.start)
      out.push({
        day,
        pcOnMs: unionMs(spans),
        labelledMs: unionMs(main),
        firstStart: spans.length ? Math.min(...spans.map((s) => s.start)) : undefined,
        lastEnd: spans.length ? Math.max(...spans.map((s) => s.end)) : undefined,
        entries: d.entries.length,
        byKind,
      })
    }
    return out
  })

  // ---------- links ----------
  const validEnd = (e: LinkEnd) => !!e && (e.type === 'entry' || e.type === 'note') && typeof e.id === 'string'
  ipcMain.handle(IPC.link, (_e, day: string, a: LinkEnd, b: LinkEnd) => {
    if (!validEnd(a) || !validEnd(b)) throw new Error('Неверная связь')
    const da = a.day ?? day
    const db = b.day ?? day
    if (da === db) {
      const d = store.day(da)
      d.links = pruneLinks({ ...d, links: addLink(d.links ?? [], { type: a.type, id: a.id }, { type: b.type, id: b.id }, randomUUID(), Date.now()) })
      store.markDirty(da)
    } else {
      // across days: the same link (same id) in both days, each end with its day and title
      const titleOf = (e: LinkEnd, d: string) =>
        e.type === 'entry' ? store.day(d).entries.find((x) => x.id === e.id)?.label : store.day(d).notes.find((x) => x.id === e.id)?.text.slice(0, 80)
      const ea: LinkEnd = { type: a.type, id: a.id, day: da, hint: titleOf(a, da) }
      const eb: LinkEnd = { type: b.type, id: b.id, day: db, hint: titleOf(b, db) }
      const id = randomUUID()
      for (const dk of [da, db]) {
        const d = store.day(dk)
        d.links = addLink(d.links ?? [], ea, eb, id, Date.now())
        store.markDirty(dk)
      }
    }
    store.flush()
    broadcast()
  })
  ipcMain.handle(IPC.unlink, (_e, day: string, id: string) => {
    const d = store.day(day)
    // a link the app made (call ↔ meeting) that the user removes is not made again
    const l = d.links?.find((x) => x.id === id)
    if (l?.auto) d.linkDismissed = [...new Set([...(d.linkDismissed ?? []), pairKey(l.a.id, l.b.id)])]
    d.links = (d.links ?? []).filter((l) => l.id !== id)
    // a link across days goes from the other day too
    if (l && isCrossDay(l, day)) dropLinkElsewhere(l.id, [endDay(l.a, day), endDay(l.b, day)].filter((x) => x !== day))
    store.markDirty(day)
    store.flush()
    broadcast()
  })
  ipcMain.handle(IPC.setLinks, (_e, day: string, end: LinkEnd, others: LinkEnd[]) => {
    if (!validEnd(end) || !Array.isArray(others) || !others.every(validEnd)) throw new Error('Неверная связь')
    const d = store.day(day)
    d.links = pruneLinks({ ...d, links: setLinksOf(d.links ?? [], end, others, randomUUID, Date.now()) })
    store.markDirty(day)
    store.flush()
    broadcast()
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
    // dictated for a block → linked to it
    if (input.entryId && d.entries.some((e) => e.id === input.entryId))
      d.links = addLink(d.links ?? [], { type: 'note', id: note.id }, { type: 'entry', id: input.entryId }, randomUUID(), Date.now())
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
    // what the note was linked with is now linked with the block
    dropCrossLinksOf(day, noteId)
    const swap = (e: LinkEnd): LinkEnd => (e.type === 'note' && e.id === noteId ? { type: 'entry', id: entry.id } : e)
    d.links = (d.links ?? []).map((l) => ({ ...l, a: swap(l.a), b: swap(l.b) })).filter((l) => !(l.a.type === l.b.type && l.a.id === l.b.id))
    voice.cancel(noteId)
    if (n.audio) voice.removeAudio(n.audio.file)
    d.notes = d.notes.filter((x) => x.id !== noteId)
    if (d.links) d.links = pruneLinks(d)
    store.markDirty(day)
    store.flush()
    broadcast()
    return entry
  })

  ipcMain.handle(IPC.adoptTime, (_e, day: string, keepId: string, fromId: string) => {
    const d = store.day(day)
    const kept = adoptTime(d, keepId, fromId)
    if (!kept) return undefined
    d.entries = pinLanes(d.entries, kept)
    store.markDirty(day)
    store.flush()
    broadcast()
    return kept
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
    dropCrossLinksOf(day, id)
    d.notes = d.notes.filter((n) => n.id !== id)
    if (d.links) d.links = pruneLinks(d)
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
  /** The task calendar: blocks, links and notes of the stored days in [from, to] — nothing heavier. */
  ipcMain.handle(IPC.calendarRange, (_e, from: string, to: string) => {
    return store
      .listDays()
      .filter((d) => d >= from && d <= to)
      .map((day) => {
        const d = store.day(day)
        return { day, entries: d.entries, links: d.links ?? [], notes: d.notes, spans: d.spans, plan: d.plan ?? [] }
      })
  })
  ipcMain.handle(IPC.jiraTracked, () => keyTotals(store.listDays().map(spentDay)))

  ipcMain.on(IPC.openExternal, (_e, url: string) => {
    // web pages only (Jira, links in AI answers and notes) — never file:// or app protocols
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  // ---------- AI ----------
  ipcMain.handle(IPC.aiHasKey, () => ai.hasKey)
  ipcMain.handle(IPC.aiSetKey, (_e, key: string) => ai.setKey(String(key ?? '')))
  ipcMain.handle(IPC.aiPreview, (_e, day: string) => ai.model(store.day(day), store.cfg))
  ipcMain.handle(IPC.aiAnalyze, async (_e, day: string) => {
    const result = await ai.analyze(store.day(day), store.cfg)
    store.day(day).ai = result
    store.markDirty(day)
    store.flush()
    broadcast()
    return result
  })

  ipcMain.handle(IPC.getSettings, () => publicSettings())
  ipcMain.handle(IPC.updateSettings, async (_e, patch: SettingsPatch) => {
    const outlookBefore = JSON.stringify(store.cfg.outlook)
    const jiraEvery = store.cfg.jira.syncMin
    store.update(patch)
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
  ipcMain.handle(IPC.vaultCreate, (_e, dir: string, kind: 'note' | 'folder', name?: string, text?: string) =>
    vault.create(str(dir), kind === 'folder' ? 'folder' : 'note', name ? str(name) : undefined, text ? str(text) : ''),
  )
  ipcMain.handle(IPC.vaultMove, (_e, from: string, toDir: string, name?: string) => vault.move(str(from), str(toDir), name === undefined ? undefined : str(name)))
  ipcMain.handle(IPC.vaultDelete, (_e, p: string) => vault.remove(str(p)))
  ipcMain.handle(IPC.vaultSearch, (_e, q: string) => vault.search(str(q)))
  ipcMain.handle(IPC.vaultSaveAudio, (_e, audio: Uint8Array) => vault.saveAudio(audio))
  ipcMain.handle(IPC.vaultReadAudio, (_e, p: string) => vault.readAudio(str(p)))
  ipcMain.handle(IPC.vaultTranscribe, (_e, wav: Uint8Array) => {
    if (!store.cfg.voice.enabled) throw new Error('Расшифровка выключена в настройках')
    return voice.transcribe(`vault-${randomUUID()}`, wav)
  })
  ipcMain.on(IPC.vaultReveal, (_e, p: string) => vault.reveal(str(p)))
  ipcMain.handle(IPC.vaultSetColor, (_e, p: string, color?: string) => vault.setColor(str(p), typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined))
  ipcMain.handle(IPC.vaultDeleteAudio, (_e, p: string) => vault.deleteAudio(str(p)))
  ipcMain.handle(IPC.vaultRestoreAudio, (_e, p: string, audio: Uint8Array) => vault.restoreAudio(str(p), audio))

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
  store = new Store()
  tracker = new Tracker(store, broadcast)
  probe = new Probe(
    store.cfg.sampleIntervalMs,
    (s) => {
      const settings = store.cfg
      tracker.onSample(s, settings.sampleIntervalMs, settings.idleThresholdSec, settings.captureTitles)
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
      // every day of the synced window follows Outlook; calls of those days get linked to their meetings
      for (let day = dayKey(from); dayStart(day) < to; day = shiftDay(day, 1)) {
        const d = store.day(day)
        let changed = applyMeetings(d, events, store.cfg.kinds, randomUUID)
        if (store.cfg.outlook.linkCalls) changed = linkCallsToMeetings(d, store.cfg.kinds, randomUUID, Date.now()) || changed
        if (changed) store.markDirty(day)
      }
      store.flush()
      broadcast()
    },
    (inCall) => tracker.setPresenceCall(inCall),
  )
  ai = new Ai(store.root)
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
  tracker.start()
  jira.start()
  outlook.start()
  probe.setTitles(store.cfg.captureTitles)
  probe.setKeys(store.cfg.countKeys)
  probe.start()
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
  globalShortcut.unregisterAll()
  probe?.stop()
  tracker?.stop()
  jira?.stop()
  outlook?.stop()
  voice?.stop()
  vault?.stop()
  store?.close()
})
