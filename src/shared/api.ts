import type { DayData, DayStateMessage, Entry, LiveStatus, LocalTask, Note, PlanBlock, SearchHit, VoiceState, PublicSettings, Selection, SettingsPatch } from './types'
import type { RangeDay } from './report'
import type { Dock } from './island'
import type { ProjectProfile } from './release'
import type { ComboState } from './combo'
import type { PulsePoint } from './pulse'
import type { JiraFacets, JiraIssue, JiraListQuery, JiraState, JiraVersion, MyTaskStatus } from './jira'
import type { HttpDoc, HttpFolder, HttpKV, HttpRequest, HttpRunResult } from './http'
import type { BrowserApi } from './browser'
import type { TestFilesApi } from './testFiles'
import type { SqlApi } from './sql'
import type { TableFileApi } from './tableData'
import type { PwBrowser } from '../notebook/domain/blockInfo'
import type { LoopJob, LoopResult, PassResult } from '../notebook/domain/loop'
import type { ClipState } from './clip'
import type { TermAlert, TermConfig, TermSession } from './terminal'
import type { OutlookState } from './outlook'
import type { ChatFile } from './transport/chat'
import type { TransportState } from './transport/constants'
import type { ResultsPage, ResultsPut, ResultsPutReply, TransportEvent } from './transport/protocol'
import type { SharedFolderLink } from './transport/sharedFolder'
import type { KeptState } from './transport/sharedText'
import type { MediaReport } from './transport/space'
import type { VaultEntryKind, VaultHit, VaultNode } from './vault'
import type { Remind, RepeatRule } from './repeat'
import type { TabletMsg, TabletPrefs, TabletState } from './tablet'
import type { AudioNoteKind } from './tracker/constants'

export interface IslandLayout {
  /** Island sits in the lower half of the screen → content grows upward. */
  up: boolean
  /** Stuck to a screen edge (a slim pill without the rounding on that side; upright at a side edge). */
  dock?: Dock
  /** At a side edge: where the pill's centre is, from the window's top (px). */
  offset?: number
}

export type AppCommand = 'island-toggle' | 'island-reset' | 'quit' | 'devtools' | 'open-data-folder' | 'reload'

/** Everything a renderer can ask the main process for. Exposed as `window.qa`. */
export interface QaApi {
  getDay(day: string): Promise<DayData>
  getLive(): Promise<LiveStatus>
  /**
   * Create or update an entry (by id). By default overlapping main-line entries are trimmed;
   * with `overlap` (moving a block) they are left alone and the overlap is shown in parallel.
   */
  saveEntry(day: string, entry: Omit<Entry, 'id'> & { id?: string }, opts?: { overlap?: boolean }): Promise<Entry>
  /** «Запись» begun now: a new event of this kind whose end follows the clock until stopped (any number at once). */
  recordStart(kind: string, label: string): Promise<Entry>
  /** A recording started on an event (going on or ahead) / stopped (it ends at the moment). */
  recordSet(day: string, id: string, on: boolean): Promise<void>
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
  /** The board the pen is mapped onto now (none — the window). */
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
  /** Any bytes saved where the user picks (a «save as» dialog for that extension); the path, or undefined. */
  fileSave(bytes: Uint8Array, name: string, ext: string): Promise<string | undefined>
  /** MD5 / SHA-1 / SHA-256 / SHA-512 (hex) of a text, bytes or a file on disk (read as a stream); HMAC with a key. */
  hashOf(src: { text?: string; bytes?: Uint8Array; path?: string }, key?: string): Promise<Record<'md5' | 'sha1' | 'sha256' | 'sha512', string>>
  /** Reports / the week sheet: the blocks of every day with data in [from, to] and how long QA was on. */
  rangeDays(from: string, to: string): Promise<RangeDay[]>
  /** Every event of every day, light — the notebook's «@» list and its chips. */
  eventsIndex(): Promise<import('./noteEvents').EventRef[]>
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
  saveAudioNote(day: string, note: { id: string; at: number; durationSec: number; kind: AudioNoteKind; text?: string; entryId?: string }, audio: Uint8Array): Promise<Note>
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
  onNavigate(cb: (nav: { day?: string; entryId?: string; view?: 'day' | 'log' | 'settings' | 'browser' }) => void): () => void
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
  /** The transport server (Настройки → Сервер и чат): the connection's state, the access code (kept encrypted). */
  transportState(): Promise<TransportState>
  onTransport(cb: (s: TransportState) => void): () => void
  transportSetCode(code: string): Promise<TransportState>
  transportReconnect(): Promise<void>
  /** A method of the server: chat, shared spaces, documents (renderer: lib/transport.ts types it by TransportMethods). */
  serverCall(method: string, params: unknown): Promise<unknown>
  /** A shared document's state as kept on this computer (Yjs, base64; '' — none) / kept. */
  sharedLoad(doc: string): Promise<KeptState | null>
  sharedSave(doc: string, kept: KeptState): Promise<void>
  /**
   * A shared note's pictures, recordings, test files in step with the server: what it lacks sent, what this computer
   * lacks fetched (`ways` — only one of them); the files fetched.
   */
  sharedMedia(space: string, rels: string[], ways?: { send?: boolean; fetch?: boolean }): Promise<MediaReport>
  /** A shared note's run results: this device's sent (null — taken away) / what changed after a number fetched. */
  sharedResultsPut(space: string, doc: string, changes: ResultsPut['changes']): Promise<ResultsPutReply>
  sharedResultsGet(space: string, doc: string, since: number): Promise<ResultsPage>
  /** A line into the shared notes' journal (data/shared.log) — what the window did with their files. */
  sharedLog(line: string): void
  /** A file sent into a chat (kept on the server and here): what a message carries of it. */
  chatFilePut(room: string, name: string, mime: string, bytes: Uint8Array): Promise<ChatFile>
  /** A chat's file: kept here, else fetched. */
  chatFileGet(room: string, id: string): Promise<Uint8Array>
  /** A chat's file saved where one picks (false — not saved). */
  chatFileSave(room: string, id: string, name: string): Promise<boolean>
  /** A note / a folder of the notebook sent into a chat as one file (its export, .qvdoc; run results with it — or not). */
  chatFileFromNotes(room: string, rel: string, withRuns: boolean): Promise<ChatFile>
  /** A note / a folder received in a chat (a .qvdoc) put into the notebook (in `dir`): what was made. */
  chatFileToNotes(room: string, id: string, dir: string): Promise<{ main: string; paths: string[]; folder?: string }>
  /** The note / board of the notebook that is this shared document, by its mark (never by name); '' — none. */
  sharedFind(doc: string): Promise<string>
  /** The shared folders of the notebook (their links: the space, where each document was last time). */
  sharedFolders(): Promise<SharedFolderLink[]>
  /** A folder's link kept (null — the folder is no longer shared). */
  sharedFolderLink(dir: string, link: Omit<SharedFolderLink, 'dir'> | null): Promise<void>
  /** The server's events: messages, new rooms, «печатает…», spaces, documents' edits and presence. */
  onServer(cb: (ev: TransportEvent) => void): () => void
  /** A chat to open in the feed (a click on a message's notification): its room. */
  onChatOpen(cb: (room: string) => void): () => void
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
  /** Per task key: its blocks on the timeline (any day, the planned ones too). */
  jiraWorked(): Promise<Record<string, Array<{ day: string; id: string; start: number; end: number }>>>
  /** A page of the open Jira tasks matching a search (no descriptions). */
  /** `query` — the task list's filters and sort (without it: the old order — by project and due date / for picking). */
  jiraFind(q: string, offset: number, limit: number, mode?: 'list' | 'pick', query?: JiraListQuery): Promise<{ items: JiraIssue[]; total: number; facets: JiraFacets }>
  /** Терминал: shells that live until the app quits. */
  termCreate(cwd?: string): Promise<TermSession>
  termWrite(id: string, data: string): void
  termResize(id: string, cols: number, rows: number): void
  termKill(id: string): Promise<void>
  termRename(id: string, title: string): Promise<void>
  /** A shell's output so far (a pane drawing it again). */
  termReplay(id: string): Promise<{ buf: string; upto: number }>
  /** Every variable's value for a shell (or its error). */
  termValues(id?: string): Promise<Record<string, { value?: string; error?: string }>>
  /** The reactions' notices (and why they are paused, if they are). */
  termAlerts(): Promise<{ list: TermAlert[]; watchError: string }>
  /** Closes a notice (none given — every one). */
  termDismiss(id?: string): Promise<void>
  termList(): Promise<TermSession[]>
  termDirs(path: string): Promise<string[]>
  termConfig(): Promise<TermConfig>
  termSetConfig(c: Partial<TermConfig>): Promise<TermConfig>
  /** A preset's command worked out for a shell (its folder, branch…), ask(…) → the answers. */
  termRender(id: string, cmd: string, answers: Record<string, string>): Promise<{ text: string; empty: string[] }>
  /** A shell's output; `end` — how much it has sent so far, this included. */
  onTermData(cb: (id: string, data: string, end: number) => void): () => void
  onTermState(cb: (list: TermSession[]) => void): () => void
  onTermAlerts(cb: (p: { list: TermAlert[]; watchError: string }) => void): () => void
  /** HTTP: the collection (a test one on the first start), saving it, running a request. */
  httpLoad(): Promise<HttpDoc>
  httpSave(doc: HttpDoc): Promise<void>
  httpRun(req: HttpRequest, doc: HttpDoc, runId?: string): Promise<HttpRunResult>
  /** A folder's requests in order, in the main process (goes on whatever the window shows); steps come as events. */
  httpChain(ids: string[], doc: HttpDoc, stopOn: string, runId: string): Promise<{ stopped?: string }>
  /** Stops a run / a chain (the request on its way is cut off). */
  httpAbort(runId: string): Promise<void>
  onHttpChain(cb: (runId: string, i: number, id: string, out: HttpRunResult) => void): () => void
  /** A chain recorded in the browser → a folder on top of the collection, its variables set. */
  httpImport(folder: HttpFolder, vars: HttpKV[]): Promise<void>
  /** Инструменты · the clipboard's history (texts copied anywhere; kept encrypted, the last 1000). */
  clipGet(): Promise<ClipState>
  clipSet(on: boolean): Promise<ClipState>
  clipRemove(id: string): Promise<void>
  clipClear(): Promise<void>
  clipCopy(id: string): Promise<void>
  onClip(cb: (s: ClipState) => void): () => void
  /** A dropped file's path on disk. */
  pathForFile(file: File): string
  /** Браузер: a method of the pages' side (see BrowserApi). */
  browser<K extends keyof BrowserApi>(m: K, ...a: Parameters<BrowserApi[K]>): Promise<Awaited<ReturnType<BrowserApi[K]>>>
  /** The notebook's test files (see TestFilesApi). */
  files<K extends keyof TestFilesApi>(m: K, ...a: Parameters<TestFilesApi[K]>): Promise<Awaited<ReturnType<TestFilesApi[K]>>>
  /** «Базы данных»: the connections, a query run / explained / stopped, the notebook's queries (see SqlApi). */
  sql<K extends keyof SqlApi>(m: K, ...a: Parameters<SqlApi[K]>): Promise<Awaited<ReturnType<SqlApi[K]>>>
  /** Table files: rows saved as Excel / CSV, a table file read as a grid, the clipboard's table (see TableFileApi). */
  tableFile<K extends keyof TableFileApi>(m: K, ...a: Parameters<TableFileApi[K]>): Promise<Awaited<ReturnType<TableFileApi[K]>>>
  /** Where the visible pages go (sent often — no answer). */
  browserLayout(rects: Array<{ id: string; x: number; y: number; w: number; h: number; dev?: { x: number; y: number; w: number; h: number }; scale?: number }>): void
  /** The browser's news: tabs, rec, opened, key, login, open, download, bookmarks, recError. */
  onBrowser(cb: (type: string, payload: unknown) => void): () => void
  /** A page of the Jira releases of the projects (unreleased first). */
  jiraVersions(q: string, offset: number, limit: number): Promise<{ items: JiraVersion[]; total: number; unreleased: number }>
  /** The task keys of a Jira release. */
  jiraVersionIssues(id: string): Promise<string[]>
  /** One Jira task in full (with its description). */
  jiraIssue(key: string): Promise<JiraIssue | undefined>
  openExternal(url: string): void
  /** A picture (PNG / JPEG bytes) into the system clipboard. */
  copyImage(bytes: Uint8Array): Promise<void>
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
  vaultCreate(dir: string, kind: VaultEntryKind, name?: string, text?: string): Promise<string>
  /** Rename / move; the new path. */
  vaultMove(from: string, toDir: string, name?: string): Promise<string>
  /** To the recycle bin. */
  vaultDelete(path: string): Promise<void>
  vaultSearch(q: string): Promise<VaultHit[]>
  /** The notes that have this text as it is (a block's mark: a chat's room, a feed). */
  vaultNotesWith(needle: string): Promise<string[]>
  /** The events mentioned in the notes: event id → the notes' paths. */
  eventMentions(): Promise<Record<string, string[]>>
  /** A recording for a note; its vault path (.audio/…). */
  vaultSaveAudio(audio: Uint8Array): Promise<string>
  vaultReadAudio(path: string): Promise<Uint8Array>
  /** WAV 16 kHz → text (local whisper). */
  vaultTranscribe(wav: Uint8Array, key?: string): Promise<string>
  /** Stops a recording's transcription (running or waiting) — its recording was deleted. */
  vaultTranscribeCancel(key: string): void
  vaultReveal(path: string): void
  /** A colour mark of a note / folder (undefined — none). */
  vaultSetColor(path: string, color?: string): Promise<void>
  /** An emoji mark of a note / board / folder (undefined — none). */
  vaultSetEmoji(path: string, emoji?: string): Promise<void>
  /** Links a note with a board (b undefined — unlinks). */
  vaultPair(a: string, b?: string): Promise<void>
  /** Deletes a recording from the disk if no note embeds it any more; true if deleted. */
  vaultDeleteAudio(path: string): Promise<boolean>
  vaultRestoreAudio(path: string, audio: Uint8Array): Promise<void>
  /** A picture for a note / a board (its type by its bytes); its vault path (.images/…). */
  vaultSaveImage(bytes: Uint8Array): Promise<string>
  /** A runnable note's saved runs (JSON), or undefined. */
  runLoad(path: string): Promise<string | undefined>
  runSave(path: string, json: string): Promise<void>
  /** A code block run in a process of its own (killed by runCodeStop / its time limit). */
  runCode(runId: string, job: { code: string; ts: boolean; libs: Array<{ code: string; ts: boolean }>; ctx: Record<string, unknown>; runs?: Record<string, unknown>; timeoutSec?: number }): Promise<{ ok: boolean; value?: unknown; hasValue?: boolean; sets?: Record<string, unknown>; logs: Array<{ level: 'log' | 'info' | 'warn' | 'error'; text: string }>; error?: string; ms: number }>
  runCodeStop(runId: string): void
  /** A loop's head run in a process of its own: each pass it asks for comes as onLoopPass, answered by runLoopPass. */
  runLoop(runId: string, job: LoopJob & { timeoutSec: number }): Promise<LoopResult>
  runLoopPass(runId: string, n: number, result: PassResult): void
  runLoopStop(runId: string): void
  onLoopPass(cb: (runId: string, n: number, vars: Record<string, unknown>) => void): () => void
  /** A Playwright block run in a process of its own; its files go to the note's runs (vault/.runs/<note>/<key>). */
  runPw(runId: string, job: PwJob): Promise<PwResult>
  runPwStop(runId: string): void
  /** The steps of a Playwright run going on. */
  onPwProgress(cb: (runId: string, steps: PwStep[]) => void): () => void
  /** A file of a block's last run (a screenshot). */
  runFile(path: string, key: string, name: string): Promise<Uint8Array>
  /** The block's trace opened in Trace Viewer (the app's browser). */
  pwTrace(path: string, key: string): Promise<void>
  /** The block's Allure results folder shown in Explorer. */
  pwAllure(path: string, key: string): void
  /** A note's browser tab (a webview, by its webContents id): its requests listened to, or no more. */
  nbNet(id: number, on: boolean, preserve?: boolean): Promise<void>
  nbNetClear(id: number): Promise<void>
  /** A note's browser news: open (a page asked for a new window), net (a tab's requests). */
  onNoteBrowser(cb: (type: string, payload: unknown) => void): () => void
  /** A page opened in the Браузер section (shown). */
  browserOpen(url: string): void
  /** The AI assistants' server (MCP): its settings, the clients set up. */
  mcpInfo(): Promise<McpInfoView>
  mcpSet(patch: { on?: boolean; port?: number; allow?: string[]; newToken?: boolean }): Promise<McpInfoView>
  mcpInstall(client: McpClient): Promise<string>
  /** The main process asks the window to do something with the notes (for an AI tool). */
  onMcpCall(cb: (id: string, op: string, args: Record<string, unknown>) => void): () => void
  mcpReply(id: string, ok: boolean, value: unknown): void
  /** The document (with its pictures, boards, results if chosen) into one .qvdoc file; undefined — cancelled. */
  docExport(path: string): Promise<{ file: string; docs: number; files: number; missing: string[] } | undefined>
  /** A .qvdoc file unpacked into a folder of the vault; undefined — cancelled. */
  docImport(dir: string): Promise<{ main: string; paths: string[]; folder?: string } | undefined>
  /** A .qvdoc file (its path on disk — dropped) unpacked into a folder of the vault. */
  docImportFile(dir: string, file: string): Promise<{ main: string; paths: string[]; folder?: string }>
  vaultReadImage(path: string): Promise<Uint8Array>
  /** Deletes a picture from the disk if no note / board has it any more; true if deleted. */
  vaultDeleteImage(path: string): Promise<boolean>
  vaultRestoreImage(path: string, bytes: Uint8Array): Promise<void>
  /** The clipboard's picture: its signature ('' — none); saved into the vault when asked. */
  vaultClipImage(save: boolean): Promise<{ sig: string; rel?: string }>
  /** A picture by its address (dragged from a web page) → the vault. */
  vaultFetchImage(url: string): Promise<string>
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
  /** A picture / a recording appeared in the vault (fetched for a shared note, pasted, put back, put there outside). */
  onVaultMedia(cb: (rels: string[]) => void): () => void
}


// ---------- a notebook's Playwright block ----------
export interface PwStep {
  name: string
  depth: number
  start: number
  ms?: number
  state: 'run' | 'ok' | 'error'
  error?: string
}
export interface PwJob {
  code: string
  ts: boolean
  libs: Array<{ code: string; ts: boolean }>
  ctx: Record<string, unknown>
  /** The note's other blocks as they went (state, time, error, steps) — `runs` in the code. */
  runs?: Record<string, unknown>
  /** The note and the block (where its files go). */
  note: string
  /** The notebook's test files' folder (qa.file('Набор/файл')) — set by the main process. */
  files?: string
  key: string
  name: string
  browser: PwBrowser
  headed: boolean
  trace: boolean
  /** With the Браузер section's cookies (its sign-ins). */
  session?: boolean
  timeoutSec?: number
}
export interface PwResult {
  ok: boolean
  value?: unknown
  hasValue?: boolean
  sets?: Record<string, unknown>
  logs: Array<{ level: 'log' | 'info' | 'warn' | 'error'; text: string }>
  steps?: PwStep[]
  /** The ready checks (qa.…): passed / failed / a warning, with their tables. */
  checks?: import('./qaChecks').QaCheck[]
  error?: string
  ms: number
  /** What the run left: final.png / failure.png, trace.zip, allure-results. */
  files?: string[]
  browser?: string
}

/** The AI clients Qvarch can set itself up in: Claude Desktop (its config file), Claude Code (its own command). */
export type McpClient = 'desktop' | 'code'
export interface McpInfoView {
  on: boolean
  port: number
  token: string
  allow: string[]
  url: string
  listening: boolean
  error?: string
  bridge: string
  exe: string
}
