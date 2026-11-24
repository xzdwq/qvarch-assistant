import { ActionLog } from '../../../shared/browser/inspect/actionLog'
import { AnimStats } from '../../../shared/browser/inspect/animStats'
import type { SiteInput } from '../../../shared/browser/inspect/siteFacts'
import type { Metrics } from '../../../shared/browser/inspect/perfMonitor'
import type { InspectReq, MonitorSample, SitePassport, VitalValue } from '../../../shared/browser/inspect/types'

/** The most requests of a page kept for its passport (the resources' weight, third parties, failures). */
export const PAGE_REQS_MAX = 1500

/** A tab's inspector in main: its log, the page's requests and vitals, its performance samples, the passport. */
export interface TabInspect {
  on: boolean
  /** Why it cannot watch (the page's DevTools hold the protocol). */
  blocked?: string
  log: ActionLog
  /** The page's requests by the protocol's id (the passport's resources; a group's request details). */
  reqs: Map<string, InspectReq>
  /** The protocol's request id → the log's (a redirect makes the next hop a request of its own). */
  alias: Map<string, string>
  /** The page's document request (and the protocol's id of it — its body read for the passport). */
  doc?: InspectReq
  docRequestId?: string
  mainFrame?: string
  /** What the passport's facts were made of (made again as the vitals and errors come). */
  factsInput?: SiteInput
  /** The protocol's monotonic seconds → wall-clock ms (from the requests' wallTime). */
  clockOffset?: number
  /** The watcher's script registered for the tab's new pages, and its world's contexts (its own console is not the page's). */
  script?: string
  ownCtx: Set<number>
  vitals: Map<string, VitalValue>
  /** Console errors since the page opened. */
  errors: number
  softNavs: number
  passport?: SitePassport
  /** The page's probe and the passport being made (a newer page — the older one is dropped). */
  passportSeq: number
  passportTimer?: NodeJS.Timeout
  /** The performance samples (the newest last) and those the window was not told of yet; the last reading. */
  monitor: MonitorSample[]
  monitorNew: MonitorSample[]
  metrics?: Metrics
  /** The page's animations summed (the panel's «Анимации»). */
  anims: AnimStats
  /** The window is told on the next tick. */
  dirty: boolean
  reset: boolean
}

export function newTabInspect(): TabInspect {
  return { on: false, log: new ActionLog(), reqs: new Map(), alias: new Map(), ownCtx: new Set(), monitor: [], monitorNew: [], anims: new AnimStats(), vitals: new Map(), errors: 0, softNavs: 0, passportSeq: 0, dirty: false, reset: false }
}

/** A request as the window gets it in a group (its headers asked for when it is opened). */
export function liteReq(r: InspectReq): InspectReq {
  const { reqHeaders: _q, resHeaders: _s, ...lite } = r
  return lite
}
