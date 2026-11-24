import type { ActionKind, AnimCost, NoteLevel, ProblemLevel, TaskKind, VitalName, VitalRating } from './constants'

/** The inspector's data — what main gathers on a tab and the window shows (plain objects: they cross the IPC). */

/** A request a group saw: its times are wall-clock ms (`end` — not yet: still going). */
export interface InspectReq {
  id: string
  method: string
  url: string
  /** Network.ResourceType (Document, XHR, Fetch, Script…). */
  type: string
  start: number
  end?: number
  status?: number
  /** Bytes over the wire. */
  size?: number
  failed?: string
  cached?: boolean
  /** The protocol (h2, h3, http/1.1). */
  proto?: string
  /** Who started it: the script's function and place, the page's HTML, a preload. */
  initiator?: string
  /** Its headers as sent and answered (the site's own — shown as they are). */
  reqHeaders?: Record<string, string>
  resHeaders?: Record<string, string>
  mime?: string
}
/** A console line (error / warning) or an exception the page had. */
export interface InspectNote {
  at: number
  level: NoteLevel
  text: string
  /** Where: script:line. */
  where?: string
}
/** What the page's main thread was busy with (long animation frames / tasks): how many, all together, the longest. */
export interface BusyTime {
  count: number
  total: number
  max: number
  /** The scripts that took it (the longest first): their source and time. */
  scripts: Array<{ src: string; ms: number }>
}
/** One piece of the main thread's work in a long frame: what started it and how long it ran. */
export interface TaskItem {
  kind: TaskKind
  /** The invoker as the browser names it (BUTTON#save.onclick, Response.json.then, TimerHandler:setTimeout…). */
  name: string
  fn?: string
  src?: string
  at: number
  ms: number
}
/** A long frame of the main thread and the scripts that took it. */
export interface TaskEvent {
  at: number
  ms: number
  items: TaskItem[]
}
/** An animation / a transition seen on the page. */
export interface AnimEvent {
  id: string
  kind: 'animation' | 'transition'
  /** The animation's name / the transition's property. */
  name: string
  target: string
  props: string[]
  cost: AnimCost
  at: number
  /** Ended (none — still running; an infinite one never ends). */
  end?: number
  infinite?: boolean
}
/** An animation's sum on the page: how often, how long, still running. */
export interface AnimStat {
  key: string
  kind: AnimEvent['kind']
  name: string
  target: string
  props: string[]
  cost: AnimCost
  count: number
  running: number
  total: number
  max: number
  last: number
  infinite: boolean
}
/** A scroll of the person: where, how far, how smooth, what the page did to its content meanwhile. */
export interface ScrollInfo {
  target: string
  distance: number
  dir: 'down' | 'up' | 'side'
  ms: number
  fps: number
  /** Frames longer than SLOW_FRAME_MS, the longest frame. */
  slow: number
  maxFrame: number
  /** Elements put into / taken out of the scrolled content meanwhile. */
  added: number
  removed: number
}
/** An act's response as the person felt it (Event Timing): waited to start, ran, drawn after. */
export interface ActResponse {
  total: number
  delay: number
  processing: number
  presentation: number
}

/** A group of the log: one act and all it caused until the page was quiet. */
export interface ActionGroup {
  id: string
  kind: ActionKind
  /** What was acted on, in words (a button's text, a field's name), or the page opened. */
  label: string
  /** A CSS path to the element (to show it again). */
  target?: string
  at: number
  /** The last thing that happened in it. */
  end: number
  /** Gathering ended (quiet, or too long). */
  closed: boolean
  reqs: InspectReq[]
  /** Requests past the limit, only counted. */
  moreReqs: number
  notes: InspectNote[]
  busy: BusyTime
  /** The long frames one by one (the timeline's «Поток»). */
  tasks: TaskEvent[]
  anims: AnimEvent[]
  /** The layout shifts one by one. */
  shifts: Array<{ at: number; value: number }>
  scroll?: ScrollInfo
  response?: ActResponse
  /** The layout shifts it caused (CLS score). */
  shift: number
  /** The page's address it went to (an opening, a route). */
  url?: string
}
/** A group's numbers at a glance. */
export interface GroupSummary {
  /** From the act to the last thing it caused, ms. */
  duration: number
  count: number
  /** All the requests' times added up, ms. */
  sum: number
  /** The time any request was going (the overlaps counted once), ms. */
  wall: number
  failed: number
  bytes: number
  errors: number
  warnings: number
}

/** A technology the site is made with. */
export interface TechHit {
  name: string
  version?: string
  /** Its categories' names. */
  cats: string[]
  confidence: number
  website?: string
  description?: string
  /** What it was found by (js, dom, headers…), or implied by another. */
  by: string[]
}
/** How the page is made: rendered where, an app or pages, installable. */
export interface RenderInfo {
  render: 'ssr' | 'ssg' | 'csr' | 'unknown'
  hydrated: boolean
  islands: boolean
  spa: boolean
  pwa: { manifest: boolean; worker: boolean; installable?: boolean }
  /** Why it is said so, in words. */
  why: string[]
}
/** A fact about the site, as a line: a label and its value. */
export interface SiteFact {
  group: string
  label: string
  value: string
  level?: ProblemLevel
}
export interface SiteProblem {
  level: ProblemLevel
  title: string
  detail?: string
}
export interface VitalValue {
  name: VitalName
  value: number
  rating: VitalRating
  /** The element it is about (LCP's, the shift's). */
  target?: string
}
/** The page's opening by phases (Navigation Timing), ms from its start; the paints on it. */
export interface NavTiming {
  redirect: number
  dns: number
  connect: number
  tls: number
  /** Waiting for the server's first byte. */
  wait: number
  download: number
  /** The document parsed (DOMContentLoaded's end), all loaded (load's end), ms from the start. */
  dcl: number
  load: number
  fcp?: number
  lcp?: number
  protocol?: string
}
/** One moment of the page's performance (as DevTools' «Performance monitor»): per second of the last interval. */
export interface MonitorSample {
  at: number
  /** The main thread busy, % of the time. */
  cpu: number
  /** Of that: scripts, layout, styles — ms per second. */
  script: number
  layout: number
  style: number
  /** JS memory used, bytes. */
  heap: number
  nodes: number
  listeners: number
  /** Layouts / style recalculations per second. */
  layouts: number
  recalcs: number
  documents: number
  frames: number
}
/** The site's passport: what it is made with, how it works, how it does. */
export interface SitePassport {
  url: string
  at: number
  /** Still gathering (the technologies come from their own process). */
  pending: boolean
  tech: TechHit[]
  render?: RenderInfo
  facts: SiteFact[]
  problems: SiteProblem[]
  vitals: VitalValue[]
  timing?: NavTiming
}

/** A tab's inspector as the window sees it: on, its passport, its log. */
export interface InspectView {
  tabId: string
  on: boolean
  /** Why it cannot watch (the page's DevTools hold the protocol). */
  blocked?: string
  passport?: SitePassport
  groups: ActionGroup[]
  monitor: MonitorSample[]
  anims: AnimStat[]
}
/**
 * The window told: a tab's changed groups (merged by id), its passport, its state, the performance samples since
 * last time; `reset` — the log starts anew.
 */
export interface InspectNews {
  tabId: string
  on: boolean
  blocked?: string
  reset?: boolean
  passport?: SitePassport
  groups: ActionGroup[]
  monitor: MonitorSample[]
  /** The page's animations summed (sent when they changed). */
  anims?: AnimStat[]
}
