import { powerMonitor } from 'electron'
import { randomUUID } from 'node:crypto'
import { isCallApp } from '../shared/apps'
import { callTitle, syncCallEntry } from '../shared/calls'
import { dayKey } from '../shared/timeline'
import type { CallSegment, LiveStatus, Ms } from '../shared/types'
import type { ProbeSample } from './probe'
import type { Store } from './store'

const HEARTBEAT_MS = 15_000
/** Short gaps between call samples (mic flicker) are bridged. */
const CALL_GAP_MS = 90_000
/** A call window with another title, seen this many samples in a row, is another call (back-to-back calls). */
const NEW_TITLE_SAMPLES = 3

/**
 * Calls only: the microphone held by a call app (or the Teams status "in a call") becomes a call block on the
 * timeline, kept in sync while the call goes on. No tracking of apps, windows or the PC's on-time.
 * A heartbeat keeps the windows' "now" fresh.
 */
export class Tracker {
  live: LiveStatus = { now: Date.now(), inCall: false }
  private heartbeat?: NodeJS.Timeout
  private suspended = false

  constructor(
    private store: Store,
    private onChange: (days: string[]) => void,
  ) {}

  start(): void {
    this.backfillCalls()
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS)
    powerMonitor.on('suspend', () => (this.suspended = true))
    powerMonitor.on('resume', () => (this.suspended = false))
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.store.flush()
  }

  /** Calls detected earlier today without a block get one now (e.g. detected by an older version). */
  private backfillCalls(): void {
    const day = dayKey(Date.now())
    const d = this.store.day(day)
    let changed = false
    for (const c of d.calls) if (!c.entryId && syncCallEntry(d, c, this.store.cfg.kinds, randomUUID)) changed = true
    if (changed) this.store.markDirty(day)
  }

  private beat(): void {
    if (this.suspended) return
    this.live.now = Date.now()
    this.store.flush()
    this.onChange([dayKey(Date.now())])
  }

  /** A probe sample: only whether a call goes on (and, with call titles on, who it is with). */
  onSample(s: ProbeSample, sampleIntervalMs: number, callTitles = false): void {
    if (this.suspended) return
    const now = Date.now()
    // the microphone held by a call app, or the Teams status "in a call" (it also covers a muted mic)
    const micApp = s.mic.map(isCallApp).find(Boolean)
    const callApp = micApp ?? (this.presenceCall ? 'Teams' : undefined)
    // who the call is with: the call window's title
    const cw = callTitles ? (s.cw ?? []) : []
    const titles = cw.map((w) => w.split('\t')[1] ?? '')
    // the windows that were there before this call (and before its current segment) are not its own — a new
    // window is the newest call's
    const title = callApp ? callTitle(callApp, cw, new Set([...this.preCallWindows, ...this.segmentWindows])) : undefined
    if (!callApp) {
      this.preCallWindows = new Set(titles)
      this.segmentWindows = new Set()
      this.titleCand = undefined
    }
    if (callApp) this.addCall(now, callApp, sampleIntervalMs, micApp ? 'mic' : 'teams', title, titles)
    const was = this.live.inCall
    this.live = { now, inCall: !!callApp, callApp }
    if (callApp || was) this.onChange([dayKey(now)])
  }

  /** The Teams status (Microsoft Graph presence) says the user is in a call. */
  private presenceCall = false
  /** Call-app window titles seen while not in a call — the call's own window is a new one. */
  private preCallWindows = new Set<string>()
  /** The windows that were open when the current call segment began (its own window is new among them). */
  private segmentWindows = new Set<string>()
  /** Another call's title, seen n samples in a row. */
  private titleCand: { title: string; n: number } | undefined
  setPresenceCall(on: boolean): void {
    this.presenceCall = on
  }

  private addCall(now: Ms, app: string, intervalMs: number, source: CallSegment['source'] = 'mic', title?: string, windows: string[] = []): void {
    const day = dayKey(now)
    const d = this.store.day(day)
    const last = [...d.calls].reverse().find((c: CallSegment) => c.app === app)
    let call = last
    const near = !!last && now - last.end <= Math.max(CALL_GAP_MS, intervalMs * 2)
    // the same app, but another call's window (a call ended and the next began at once)
    let next = false
    if (near && title && last!.title && title !== last!.title) {
      this.titleCand = this.titleCand?.title === title ? { title, n: this.titleCand.n + 1 } : { title, n: 1 }
      next = this.titleCand.n >= NEW_TITLE_SAMPLES
    } else this.titleCand = undefined
    if (near && !next) last!.end = now
    else {
      // the new call began when its window was first seen
      const start = next ? now - (NEW_TITLE_SAMPLES - 1) * intervalMs : now - Math.min(intervalMs, 30_000)
      if (next && last) {
        last.end = Math.min(last.end, start)
        // its block was stretched by the samples that were the next call already
        const e = last.entryId ? d.entries.find((x) => x.id === last.entryId) : undefined
        if (e && e.source === 'detected' && e.end > last.end) e.end = last.end
      }
      d.calls.push((call = { start, end: now, app, source }))
      this.segmentWindows = new Set(windows.filter((w) => w !== title))
      this.titleCand = undefined
    }
    if (call && title && !call.title) call.title = title
    // a call becomes a block on the timeline (below if the main line is busy)
    if (next && last) syncCallEntry(d, last, this.store.cfg.kinds, randomUUID)
    if (call) syncCallEntry(d, call, this.store.cfg.kinds, randomUUID)
    this.store.markDirty(day)
  }
}
