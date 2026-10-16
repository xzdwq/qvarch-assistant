import type { DayData, DayStateMessage, Entry, LiveStatus, LocalTask, Note, PlanBlock, SearchHit, VoiceState, PublicSettings, Selection, SettingsPatch } from './types'
import type { RangeDay } from './report'
import type { Dock } from './island'
import type { ProjectProfile } from './release'
import type { ComboState } from './combo'
import type { PulsePoint } from './pulse'
import type { JiraState, MyTaskStatus } from './jira'
import type { OutlookState } from './outlook'
import type { VaultHit, VaultNode } from './vault'
import type { Remind, RepeatRule } from './repeat'
import type { TabletMsg, TabletPrefs, TabletState } from './tablet'

export interface IslandLayout {
  /** Island sits in the lower half of the screen → content grows upward. */
  up: boolean
  /** Stuck to a screen edge (a slim pill without the rounding on that side; upright at a side edge). */
  dock?: Dock
  /** At a side edge: where the pill's centre is, from the window's top (px). */
  offset?: number
}

export type AppCommand = 'island-toggle' | 'island-reset' | 'quit' | 'devtools' | 'open-data-folder'

/** Everything a renderer can ask the main process for. Exposed as `window.qa`. */
export interface QaApi {
  getDay(day: string): Promise<DayData>
  getLive(): Promise<LiveStatus>
  /**
   * Create or update an entry (by id). By default overlapping main-line entries are trimmed;
   * with `overlap` (moving a block) they are left alone and the overlap is shown in parallel.
   */
  saveEntry(day: string, entry: Omit<Entry, 'id'> & { id?: string }, opts?: { overlap?: boolean }): Promise<Entry>
  /** Merge entries into the earliest one (spanning all); entries in between go parallel. */
  mergeEntries(day: string, ids: string[]): Promise<Entry | undefined>
  /** History calendar: per-day summaries for a month (YYYY-MM). */
  /** Release builder: open a project's section (resume — continue its saved build). */
  releaseOpen(projectId: string, resume?: boolean): Promise<void>
  /** A command of the release section (the same as the extension's webview sent). */
  releaseCmd(msg: { command: string } & Record<string, unknown>): Promise<void>
  onRelease(cb: (msg: { command: string } & Record<string, unknown>) => void): () => void
  releaseProjects(): Promise<ProjectProfile[]>
  releaseSaveProject(p: Partial<ProjectProfile>): Promise<ProjectProfile>
  releaseDeleteProject(id: string): Promise<void>
  /** Takes the profiles from the VS Code extension's settings; how many were added. */
  releaseImport(): Promise<number>
  releasePickFolder(): Promise<string | undefined>
  /** Opens the repository (or a file in it) in VS Code — conflicts are resolved there. */
  releaseOpenInCode(path: string): Promise<void>
  /** The pen tablet run by Qvarch: settings, the helper's status, the monitors; live — the pen's samples wanted. */
  tabletState(): Promise<TabletState>
  tabletSet(patch: Partial<TabletPrefs>): Promise<TabletState>
  tabletLive(on: boolean): Promise<void>
  /** The active board's visible area in physical px from the window's client corner (null — no board on screen). */
  tabletCanvas(rect: { x: number; y: number; w: number; h: number } | null): Promise<void>
  onTablet(cb: (msg: TabletMsg) => void): () => void
  /** PDF signing: the saved drawings (signatures, a handwritten date…) as PNG data URLs. */
  sigList(): Promise<Array<{ id: string; url: string }>>
  sigSave(url: string): Promise<string>
  sigDelete(id: string): Promise<void>
  /** Saves a signed PDF where the user picks (a save dialog); undefined when cancelled. */
  pdfSave(bytes: Uint8Array, name: string): Promise<string | undefined>
  /** Saves an exported picture where the user picks (a save dialog); undefined when cancelled. */
  imageSave(bytes: Uint8Array, name: string, ext: 'png' | 'svg'): Promise<string | undefined>
  /** Reports / the week sheet: the blocks of every day with data in [from, to] and how long QA was on. */
  rangeDays(from: string, to: string): Promise<RangeDay[]>
  deleteEntry(day: string, id: string): Promise<void>
  /** Moves a block to [start, end] — on the same day or another one (its links follow). */
  moveEntry(from: string, to: string, id: string, start: number, end: number): Promise<void>
  /** Create or update a quick note (autosaved while typing). */
  saveNote(day: string, note: { id: string; at: number; text: string; remind?: Remind | null }): Promise<Note>
  deleteNote(day: string, id: string): Promise<void>
  // ---------- voice ----------
  voiceState(): Promise<VoiceState>
  onVoice(cb: (s: VoiceState) => void): () => void
  /** Downloads a speech model (checked by SHA-256). */
  voiceDownloadModel(id: string): Promise<void>
  /** Deletes a downloaded model (frees the space). */
  voiceDeleteModel(id: string): Promise<void>
  /** A recording becomes a note (voice note or a call recording). */
  saveAudioNote(day: string, note: { id: string; at: number; durationSec: number; kind: 'voice' | 'call'; text?: string; entryId?: string }, audio: Uint8Array): Promise<Note>
  /** 16 kHz mono WAV of the note's audio → transcript (stored on the note). */
  transcribeNote(day: string, noteId: string, wav: Uint8Array): Promise<string>
  readAudio(file: string): Promise<Uint8Array>
  /** Full-text search over the whole history. */
  search(q: string): Promise<SearchHit[]>
  /** Own tasks (besides Jira). */
  tasks(): Promise<LocalTask[]>
  saveTask(t: LocalTask): Promise<LocalTask>
  deleteTask(id: string): Promise<void>
  onTasks(cb: (tasks: LocalTask[]) => void): () => void
  /** A note becomes an own task (the note stays, linked to it). */
  noteToTask(day: string, noteId: string): Promise<Entry>
  /** «Моя работа»: the tasks taken for the day (the whole list, in order). */
  setDayTasks(day: string, tasks: Array<{ key: string; summary: string }>): Promise<void>
  /** A block (an Outlook meeting / a call too) given to a task — or taken from it (null). */
  setEntryTask(day: string, id: string, task: { key: string; summary: string } | null): Promise<void>
  /** Create or update a planned block. */
  savePlan(day: string, block: PlanBlock): Promise<PlanBlock>
  deletePlan(day: string, id: string): Promise<void>
  /** "Сделано по плану": a real block from the plan block — only once (the same block if it already exists). */
  planDone(day: string, id: string): Promise<Entry | undefined>

  /** Cut marker shared by all windows. */
  getSelection(): Promise<Selection | null>
  setSelection(sel: Selection | null): void

  getSettings(): Promise<PublicSettings>
  updateSettings(patch: SettingsPatch): Promise<PublicSettings>

  /**
   * Island: the pointer is over the visible content (decided by the renderer in its own coordinates —
   * robust across monitors with different scaling). Everything else stays click-through.
   */
  islandSolid(solid: boolean): void
  /** Where the island's content is in its window (px) — main docks it by that rectangle. */
  islandRect(r: { x: number; y: number; width: number; height: number }): void
  /** Island: drag by the move handle/header — main moves the window after the OS cursor between start and end. */
  /** Island: give keyboard focus back to the previous app. */
  islandBlur(): void
  islandFocus(): void
  getIslandLayout(): Promise<IslandLayout>

  openMain(day?: string, entryId?: string): void
  command(cmd: AppCommand): void

  onDayState(cb: (msg: DayStateMessage) => void): () => void
  onNavigate(cb: (nav: { day?: string; entryId?: string; view?: 'day' | 'log' | 'settings' }) => void): () => void
  /** Global hotkey: expand the island and focus the label input. */
  onIslandHotkey(cb: () => void): () => void
  /** From main: a native drag has ended (`moved`), or the cursor went far away (`leave`, a safety net). */
  onIslandHover(cb: (h: { moved?: boolean; leave?: boolean }) => void): () => void
  onIslandLayout(cb: (layout: IslandLayout) => void): () => void
  /** Settings changed (in any window). */
  onSettings(cb: (s: PublicSettings) => void): () => void
  // ---------- Jira ----------
  /** Outlook / Teams (Microsoft Graph): meetings → blocks, the Teams status → a call signal. */
  outlookState(): Promise<OutlookState>
  onOutlook(cb: (s: OutlookState) => void): () => void
  outlookLogin(): Promise<void>
  outlookLogout(): Promise<void>
  outlookSync(): Promise<void>
  jiraState(): Promise<JiraState>
  onJira(cb: (s: JiraState) => void): () => void
  /** Opens the Atlassian sign-in in the browser; resolves when connected. */
  jiraLogin(): Promise<void>
  jiraLogout(): Promise<void>
  jiraSync(): Promise<void>
  jiraSetSecret(secret: string): Promise<void>
  jiraStar(key: string, on: boolean): Promise<void>
  jiraSetMyStatus(key: string, status: MyTaskStatus | null): Promise<void>
  /** Time tracked in the app per task key (all days), ms. */
  /** Blocks, links and notes of the stored days in [from, to] (the task calendar). */
  calendarRange(from: string, to: string): Promise<Array<Pick<DayData, 'day' | 'entries' | 'notes' | 'plan' | 'dayTasks'>>>
  /** Time per task key (Jira or own) over every day. */
  jiraTracked(): Promise<Record<string, number>>
  openExternal(url: string): void
  /** Live typing combo (sent on every batch of key presses). */
  onCombo(cb: (c: ComboState) => void): () => void
  getCombo(): Promise<ComboState>
  /** Live activity bins (1 s) — keys, mouse travel, window switches. */
  onPulse(cb: (bins: PulsePoint[]) => void): () => void
  /** The recent live bins (last few minutes). */
  getPulse(): Promise<PulsePoint[]>
  // ---------- the notebook (Markdown files) ----------
  vaultTree(): Promise<VaultNode[]>
  vaultRead(path: string): Promise<string>
  vaultWrite(path: string, text: string): Promise<void>
  /** A new note / folder with a free name in `dir`; its path. */
  vaultCreate(dir: string, kind: 'note' | 'folder' | 'board', name?: string, text?: string): Promise<string>
  /** Rename / move; the new path. */
  vaultMove(from: string, toDir: string, name?: string): Promise<string>
  /** To the recycle bin. */
  vaultDelete(path: string): Promise<void>
  vaultSearch(q: string): Promise<VaultHit[]>
  /** A recording for a note; its vault path (.audio/…). */
  vaultSaveAudio(audio: Uint8Array): Promise<string>
  vaultReadAudio(path: string): Promise<Uint8Array>
  /** WAV 16 kHz → text (local whisper). */
  vaultTranscribe(wav: Uint8Array): Promise<string>
  vaultReveal(path: string): void
  /** A colour mark of a note / folder (undefined — none). */
  vaultSetColor(path: string, color?: string): Promise<void>
  /** Links a note with a board (b undefined — unlinks). */
  vaultPair(a: string, b?: string): Promise<void>
  /** Deletes a recording from the disk if no note embeds it any more; true if deleted. */
  vaultDeleteAudio(path: string): Promise<boolean>
  vaultRestoreAudio(path: string, audio: Uint8Array): Promise<void>
  // ---------- repeats ----------
  /** Copies of a block every hour / day / week / year (count in all, the block included) — a series. */
  repeatEntry(day: string, id: string, rule: RepeatRule, count: number): Promise<number>
  /** The edit of one block of a series applied to all of them (time shift, length, text, kind, task, reminder). */
  seriesSave(day: string, entry: Entry): Promise<void>
  /** The whole series deleted. */
  seriesDelete(day: string, id: string): Promise<void>
  /** A reminder of a block (also of an Outlook meeting, which is otherwise read-only). */
  setRemind(day: string, id: string, remind: Remind | null): Promise<void>
  /** Files changed outside the app (another editor, Explorer). */
  onVault(cb: (paths: string[]) => void): () => void
}

export const IPC = {
  getDay: 'qa:getDay',
  getLive: 'qa:getLive',
  saveEntry: 'qa:saveEntry',
  deleteEntry: 'qa:deleteEntry',
  moveEntry: 'qa:moveEntry',
  saveNote: 'qa:saveNote',
  deleteNote: 'qa:deleteNote',
  savePlan: 'qa:savePlan',
  setDayTasks: 'qa:setDayTasks',
  setEntryTask: 'qa:setEntryTask',
  search: 'qa:search',
  voiceState: 'qa:voiceState',
  voice: 'qa:voice',
  voiceDownloadModel: 'qa:voiceDownloadModel',
  voiceDeleteModel: 'qa:voiceDeleteModel',
  saveAudioNote: 'qa:saveAudioNote',
  transcribeNote: 'qa:transcribeNote',
  readAudio: 'qa:readAudio',
  tasks: 'qa:tasks',
  saveTask: 'qa:saveTask',
  deleteTask: 'qa:deleteTask',
  tasksChanged: 'qa:tasksChanged',
  noteToTask: 'qa:noteToTask',
  deletePlan: 'qa:deletePlan',
  planDone: 'qa:planDone',
  mergeEntries: 'qa:mergeEntries',
  rangeDays: 'qa:rangeDays',
  sigList: 'qa:sigList',
  sigSave: 'qa:sigSave',
  sigDelete: 'qa:sigDelete',
  pdfSave: 'qa:pdfSave',
  imageSave: 'qa:imageSave',
  tabletState: 'qa:tabletState',
  tabletSet: 'qa:tabletSet',
  tabletLive: 'qa:tabletLive',
  tabletCanvas: 'qa:tabletCanvas',
  tabletMsg: 'qa:tabletMsg',
  releaseOpen: 'qa:releaseOpen',
  releaseCmd: 'qa:releaseCmd',
  releaseMsg: 'qa:releaseMsg',
  releaseProjects: 'qa:releaseProjects',
  releaseSaveProject: 'qa:releaseSaveProject',
  releaseDeleteProject: 'qa:releaseDeleteProject',
  releaseImport: 'qa:releaseImport',
  releasePickFolder: 'qa:releasePickFolder',
  releaseOpenInCode: 'qa:releaseOpenInCode',
  getSelection: 'qa:getSelection',
  setSelection: 'qa:setSelection',
  getSettings: 'qa:getSettings',
  updateSettings: 'qa:updateSettings',
  islandSolid: 'qa:islandSolid',
  islandRect: 'qa:islandRect',
  islandBlur: 'qa:islandBlur',
  islandFocus: 'qa:islandFocus',
  getIslandLayout: 'qa:getIslandLayout',
  openMain: 'qa:openMain',
  command: 'qa:command',
  dayState: 'qa:dayState',
  navigate: 'qa:navigate',
  islandHotkey: 'qa:islandHotkey',
  islandHover: 'qa:islandHover',
  islandLayout: 'qa:islandLayout',
  settings: 'qa:settings',
  outlookState: 'qa:outlookState',
  outlook: 'qa:outlook',
  outlookLogin: 'qa:outlookLogin',
  outlookLogout: 'qa:outlookLogout',
  outlookSync: 'qa:outlookSync',
  jiraState: 'qa:jiraState',
  jira: 'qa:jira',
  jiraLogin: 'qa:jiraLogin',
  jiraLogout: 'qa:jiraLogout',
  jiraSync: 'qa:jiraSync',
  jiraSetSecret: 'qa:jiraSetSecret',
  jiraStar: 'qa:jiraStar',
  jiraSetMyStatus: 'qa:jiraSetMyStatus',
  jiraTracked: 'qa:jiraTracked',
  calendarRange: 'qa:calendarRange',
  openExternal: 'qa:openExternal',
  combo: 'qa:combo',
  getCombo: 'qa:getCombo',
  pulse: 'qa:pulse',
  getPulse: 'qa:getPulse',
  vaultTree: 'qa:vaultTree',
  vaultRead: 'qa:vaultRead',
  vaultWrite: 'qa:vaultWrite',
  vaultCreate: 'qa:vaultCreate',
  vaultMove: 'qa:vaultMove',
  vaultDelete: 'qa:vaultDelete',
  vaultSearch: 'qa:vaultSearch',
  vaultSaveAudio: 'qa:vaultSaveAudio',
  vaultReadAudio: 'qa:vaultReadAudio',
  vaultTranscribe: 'qa:vaultTranscribe',
  vaultReveal: 'qa:vaultReveal',
  vaultSetColor: 'qa:vaultSetColor',
  vaultPair: 'qa:vaultPair',
  vaultDeleteAudio: 'qa:vaultDeleteAudio',
  vaultRestoreAudio: 'qa:vaultRestoreAudio',
  repeatEntry: 'qa:repeatEntry',
  seriesSave: 'qa:seriesSave',
  seriesDelete: 'qa:seriesDelete',
  setRemind: 'qa:setRemind',
  vault: 'qa:vault',
} as const
