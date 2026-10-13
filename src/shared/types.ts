import type { Remind, RepeatRule } from './repeat'
/** Epoch milliseconds. */
export type Ms = number

/** A continuous period while the PC was on and awake (boot/resume → sleep/shutdown). */
export interface Span {
  start: Ms
  end: Ms
  /** true while this span is the live one (end is refreshed by heartbeat). */
  open?: boolean
}

export type AppKind = 'ide' | 'browser' | 'teams' | 'mail' | 'terminal' | 'office' | 'chat' | 'other' | 'idle' | 'locked'

/** Aggregated foreground activity: consecutive samples of the same app are merged. Only the app is stored. */
export interface ActivitySegment {
  start: Ms
  end: Ms
  app: string
  kind: AppKind
  /** Window/tab title — only when enabled in settings (off by default: titles can contain private text). */
  title?: string
}

/** Detected call: the microphone is held by a call app (Teams, Zoom, …). */
export interface CallSegment {
  start: Ms
  end: Ms
  app: string
  /** mic — the microphone is held by a call app; teams — the Teams status says "in a call" (works muted). */
  source: 'mic' | 'teams'
  /** The timeline block created for this call (kept in sync while the call lasts; not re-created if deleted). */
  entryId?: string
}

/** Id of a kind of activity (built-in or user-defined in settings). */
export type EntryKind = string

/** A kind of activity: shown as a button in the island and as a colour + icon on the timeline. */
export interface KindDef {
  id: EntryKind
  label: string
  color: string
  /** Icon name from the renderer icon set. */
  icon: string
  /** Counts as work time. Breaks and lunch are not; undefined → productive (except built-in break/lunch). */
  productive?: boolean
  /** Kept in settings (old blocks still show it) but not offered as a button / in menus. */
  hidden?: boolean
}
export type EntrySource = 'manual' | 'ai' | 'detected' | 'outlook'

/**
 * A labelled block on the timeline. Overlapping blocks live on parallel lanes (several timelines);
 * what belongs together is linked explicitly (DayData.links), not nested.
 */
export interface Entry {
  id: string
  start: Ms
  end: Ms
  kind: EntryKind
  label: string
  /** Longer text under the title (the lines after the first one in the description field). */
  description?: string
  /** The Jira task this time was spent on. */
  task?: { key: string; summary: string }
  source: EntrySource
  /**
   * Main-line lane (0 = the main timeline, 1+ = parallel timelines below). Stored so a block stays on its
   * timeline when moved horizontally; changed only by an explicit vertical move into a free slot.
   * Undefined (older data / auto) → placed on the first free lane.
   */
  lane?: number
  /**
   * A meeting from Outlook: its event id and what was synced (start|end|title) — while the block still
   * matches it, Outlook changes apply; once the user edits it, it is the user's.
   */
  outlook?: { id: string; sig: string; online?: boolean; joinUrl?: string; organizer?: string }
  /** A reminder (a notification at the start / N min before / at a set time). */
  remind?: Remind
  /** One of a repeated series (copies every hour / day / week / year). */
  series?: { id: string; rule: RepeatRule }
}

/** A planned block of the day ("План на день") — kept apart from what actually happened (Entry). */
export interface PlanBlock {
  id: string
  start: Ms
  end: Ms
  kind: EntryKind
  label: string
  task?: { key: string; summary: string }
  /** Row inside the plan lane (overlapping plans stack). */
  lane?: number
  /** "Сделано по плану": the block made from it (it is made only once). */
  doneEntryId?: string
}

/** A quick note typed in the island (click the orb). Its block is resolved by time — see noteEntry(). */
export interface Note {
  id: string
  /** When the note was started — places it on the timeline. */
  at: Ms
  text: string
  updatedAt: Ms
  /** A voice note / a call recording: the audio file (relative to the data folder). */
  audio?: { file: string; durationSec: number; kind: 'voice' | 'call' }
  /** Local speech-to-text of the audio (whisper.cpp). */
  transcript?: string
  /** The own task this note was turned into. */
  taskId?: string
  /** A reminder at a set time. */
  remind?: Remind
  /** Dictated for a block: its transcript fills the block's text (and they stay linked). */
  entryId?: string
}

/** An own task ("Задачи", besides Jira) — e.g. made from a note in two clicks. */
export interface LocalTask {
  id: string
  /** Its number, Q-1, Q-2… — blocks refer to it by this key (like to a Jira key). */
  key?: string
  title: string
  description?: string
  status: 'todo' | 'progress' | 'review' | 'done'
  /** YYYY-MM-DD */
  due?: string
  project?: string
  estimateMin?: number
  created: Ms
  /** The note it was made from. */
  from?: { day: string; noteId: string }
}

/** Local speech-to-text (whisper.cpp) state. */
export interface VoiceState {
  /** The chosen model is downloaded. */
  modelReady: boolean
  model: string
  models: Array<{ id: string; ready: boolean }>
  /** A model being downloaded, 0..1 */
  downloading?: { id: string; progress: number }
  error?: string
  /** note ids being transcribed */
  busy: string[]
}

/** A full-text search hit over the whole history. */
export interface SearchHit {
  day: string
  kind: 'entry' | 'note' | 'plan' | 'ai' | 'window' | 'task'
  ref: string
  at: Ms
  /** The matching text with «highlights». */
  snippet: string
}

export interface DayData {
  /** YYYY-MM-DD in local time. */
  day: string
  spans: Span[]
  activity: ActivitySegment[]
  calls: CallSegment[]
  entries: Entry[]
  notes: Note[]
  /** Best typing combo of the day (presses less than 3 s apart). */
  combo?: { best: number; at: Ms }
  /** Activity per minute: [minute of day, key presses, mouse px, window switches]. */
  pulse?: Array<[number, number, number, number]>
  /** The automatic lunch block was handled today (its id, or "manual" when the user had one) — never twice. */
  autoLunch?: string
  /** The AI analysis of the day (Markdown). */
  ai?: { at: Ms; model: string; text: string }
  /** The plan of the day. */
  plan?: PlanBlock[]
  /** What the user linked together (a task ↔ a call, a note ↔ a block, …). */
  links?: Link[]
  /** Outlook meetings whose block the user deleted — not brought back by the sync. */
  outlookDismissed?: string[]
  /** Automatic links the user removed (pair keys) — not made again. */
  linkDismissed?: string[]
}

/** One end of a link: a block or a note of the same day. */
export interface LinkEnd {
  type: 'entry' | 'note'
  id: string
  /**
   * The end lives on another day (a link across days — kept in both days' lists). Undefined → the day
   * whose list holds the link.
   */
  day?: string
  /** Its title when linked (shown on the other day, where it is not loaded). */
  hint?: string
}
/** An undirected link between two things of a day. */
export interface Link {
  id: string
  a: LinkEnd
  b: LinkEnd
  at: Ms
  /** Made by the app (a call during a meeting) — if the user removes it, it is not made again. */
  auto?: boolean
}

export interface WorkSchedule {
  /** "HH:MM" */
  start: string
  end: string
  lunchStart: string
  lunchEnd: string
  /** 0 = Sunday … 6 = Saturday */
  workDays: number[]
}

export interface IslandPrefs {
  /** Top-left of the collapsed pill (at a side edge: x — that edge, y — the pill's centre). */
  x?: number
  y?: number
  /** Stuck to a screen edge. */
  dock?: 'top' | 'bottom' | 'left' | 'right'
  /** Keep expanded regardless of hover. */
  pinned?: boolean
  /** Opacity of the collapsed pill, 0.2–1 (the expanded island is always opaque). */
  opacity?: number
}

/** What the interface shows (Настройки → Интерфейс). */
export interface UiPrefs {
  /** Mini island: app/call name, date, typing combo, activity wave, block chips, totals line, work-day bar. */
  pill: { app: boolean; date: boolean; combo: boolean; wave: boolean; chips: boolean; stats: boolean; dayBar: boolean; plan: boolean }
  /** The island stuck to a screen edge (slim): the orb, the day's time, the countdown to the next Outlook meeting, the wave. */
  dock: { orb: boolean; time: boolean; next: boolean; wave: boolean }
  /** Island: date, activity wave, apps lane, totals under the timeline. */
  island: { date: boolean; wave: boolean; apps: boolean; totals: boolean; plan: boolean }
  /** Main window: every counter in the day header (else the main three), "План дня", "AI анализ". */
  main: { allStats: boolean; plan: boolean; ai: boolean }
  /** How link lines are drawn (timelines, task board). */
  links: { style: LinkStyle }
  /**
   * The main timeline following the time: on/off; how often it moves (s); where "now" stands (px from the
   * left); after a manual move it comes back in idleSec; the scale — kept as it is or a set span (min).
   */
  timeline: { follow: boolean; stepSec: number; leftPx: number; idleSec: number; zoom: 'keep' | 'fixed'; spanMin: number; countdown: 'any' | 'outlook' }
}
export type UiPrefsPatch = { [K in keyof UiPrefs]?: Partial<UiPrefs[K]> }

import type { LinkStyle } from './linkpath'

export interface Settings {
  schedule: WorkSchedule
  kinds: KindDef[]
  /** Record window/tab titles of active apps (privacy: off by default). */
  captureTitles: boolean
  /** Count key presses for the typing combo (only the moments — never which keys). */
  countKeys: boolean
  /** Jira Cloud (OAuth 2.0 with the user's own Atlassian app). The secret is stored encrypted, not here. */
  jira: { clientId?: string; projects: string[]; site?: string; syncMin: number }
  /**
   * Outlook / Teams over Microsoft Graph (the user's own app registration, public client — no secret).
   * syncMin — how often meetings are fetched; meetings → blocks; calls → linked to meetings; presence → a call signal.
   */
  outlook: { source: 'local' | 'graph'; clientId?: string; tenantId?: string; syncMin: number; meetings: boolean; linkCalls: boolean; presence: boolean; actualTime?: boolean }
  /** AI analysis (OpenAI). The API key is stored encrypted, not here. */
  ai: { model: string; prompt: string; sendTitles: boolean }
  /** Voice notes: local speech-to-text (whisper) — on/off, right after recording, which model; micId — the microphone ('' — the system's default). */
  voice: { enabled: boolean; autoTranscribe: boolean; model: string; micId?: string }
  idleThresholdSec: number
  sampleIntervalMs: number
  autoStart: boolean
  island: IslandPrefs
  ui: UiPrefs
}

/** Settings as exposed to renderers. */
export type PublicSettings = Settings

export interface SettingsPatch {
  schedule?: Partial<WorkSchedule>
  kinds?: KindDef[]
  captureTitles?: boolean
  countKeys?: boolean
  jira?: { clientId?: string; projects?: string[]; site?: string; syncMin?: number }
  outlook?: Partial<Settings['outlook']>
  ai?: { model?: string; prompt?: string; sendTitles?: boolean }
  voice?: { enabled?: boolean; autoTranscribe?: boolean; model?: string; micId?: string }
  idleThresholdSec?: number
  sampleIntervalMs?: number
  autoStart?: boolean
  island?: Partial<IslandPrefs>
  ui?: UiPrefsPatch
}

export interface LiveStatus {
  now: Ms
  /** Current foreground app. */
  app?: string
  appKind?: AppKind
  idle: boolean
  inCall: boolean
  callApp?: string
}

/**
 * The cut marker: a range the user picked on a timeline but has not labelled yet.
 * Shared between the island and the main window, kept until it is used or cleared.
 */
export interface Selection {
  day: string
  start: Ms
  /** undefined → follows "now" */
  end?: Ms
}

/** One day in the history calendar. */
export interface DaySummary {
  day: string
  pcOnMs: number
  labelledMs: number
  firstStart?: Ms
  lastEnd?: Ms
  entries: number
  byKind: Record<string, number>
}

export interface DayStateMessage {
  day: DayData
  live: LiveStatus
  selection: Selection | null
}
