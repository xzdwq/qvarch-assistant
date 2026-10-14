import { powerMonitor } from 'electron'
import { randomUUID } from 'node:crypto'
import { uptime } from 'node:os'
import { classifyApp, isCallApp, pushSample } from '../shared/apps'
import { callTitle, syncCallEntry } from '../shared/calls'
import { linkCallsToMeetings } from '../shared/outlook'
import { dayKey, fillFromActivity, splitByDay } from '../shared/timeline'
import type { CallSegment, LiveStatus, Ms, Span } from '../shared/types'
import type { ProbeSample } from './probe'
import type { Store } from './store'

const HEARTBEAT_MS = 15_000
/**
 * A gap in tracking shorter than this, with no reboot in between, was the app being restarted/updated,
 * not the PC being off — the spans are joined.
 */
const RESTART_GAP_MS = 15 * 60_000

const bootTime = () => Date.now() - uptime() * 1000
/** Short gaps between call samples (mic flicker) are bridged. */
const CALL_GAP_MS = 90_000

/**
 * Always-on time tracking.
 * Spans: open on app start / resume / unlock-after-suspend, closed on suspend / shutdown.
 * The open span's end is refreshed by a heartbeat, so a crash or power loss loses at most one beat.
 */
export class Tracker {
  live: LiveStatus = { now: Date.now(), idle: false, inCall: false }
  private openSpan?: { day: string; span: Span }
  private heartbeat?: NodeJS.Timeout
  private locked = false
  private suspended = false

  constructor(
    private store: Store,
    private onChange: (days: string[]) => void,
  ) {}

  private starting = false

  start(): void {
    this.recover()
    this.backfillCalls()
    this.starting = true
    this.open(Date.now())
    this.starting = false
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS)
    powerMonitor.on('suspend', () => {
      this.suspended = true
      this.close(Date.now())
    })
    powerMonitor.on('shutdown', () => this.close(Date.now()))
    powerMonitor.on('resume', () => {
      this.suspended = false
      this.open(Date.now())
    })
    powerMonitor.on('lock-screen', () => (this.locked = true))
    powerMonitor.on('unlock-screen', () => (this.locked = false))
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.close(Date.now())
  }

  /** Spans left open by a crash end at their last heartbeat. */
  /** Calls detected earlier today without a block get one now (e.g. detected by an older version). */
  private backfillCalls(): void {
    const day = dayKey(Date.now())
    const d = this.store.day(day)
    let changed = false
    for (const c of d.calls) if (!c.entryId && syncCallEntry(d, c, this.store.cfg.kinds, randomUUID)) changed = true
    if (changed) this.store.markDirty(day)
  }

  private recover(): void {
    const today = dayKey(Date.now())
    for (const day of [today, dayKey(Date.now() - 86_400_000)]) {
      const d = this.store.day(day)
      let changed = false
      for (const s of d.spans) if (s.open) ((s.open = false), (changed = true))
      const boot = bootTime()
      const joined: typeof d.spans = []
      for (const s of [...d.spans].sort((a, b) => a.start - b.start)) {
        const prev = joined[joined.length - 1]
        if (prev && s.start - prev.end < RESTART_GAP_MS && prev.end > boot) {
          prev.end = Math.max(prev.end, s.end)
          changed = true
        } else joined.push({ ...s })
      }
      // time the app was running (the activity was recorded) but the span did not grow — it is given back
      const filled = fillFromActivity(joined, d.activity)
      if (filled) changed = true
      if (changed) d.spans = filled ?? joined
      if (changed) this.store.markDirty(day)
    }
  }

  private open(now: Ms): void {
    if (this.openSpan) return
    const day = dayKey(now)
    const d = this.store.day(day)
    // Reattach to the previous span if we restarted within a heartbeat or two (e.g. app relaunch).
    const last = d.spans[d.spans.length - 1]
    if (last && (now - last.end < HEARTBEAT_MS * 2 || (this.starting && now - last.end < RESTART_GAP_MS && bootTime() < last.end))) {
      last.open = true
      last.end = now
      this.openSpan = { day, span: last }
    } else {
      const span: Span = { start: now, end: now, open: true }
      d.spans.push(span)
      this.openSpan = { day, span }
    }
    this.store.markDirty(day)
    this.store.flush()
    this.onChange([day])
  }

  private close(now: Ms): void {
    if (!this.openSpan) return
    this.extend(now)
    this.openSpan.span.open = false
    this.store.markDirty(this.openSpan.day)
    this.openSpan = undefined
    this.store.flush()
    this.onChange([dayKey(now)])
  }

  /** Moves the open span's end to `now`, rolling over at midnight. */
  private extend(now: Ms): void {
    const o = this.openSpan
    if (!o) return
    // the day was reloaded from the database: carry on with its copy of the span
    const spans = this.store.day(o.day).spans
    if (!spans.includes(o.span)) {
      const same = spans.find((s) => s.start === o.span.start)
      if (same) {
        same.end = Math.max(same.end, o.span.end)
        same.open = true
        o.span = same
      } else spans.push(o.span)
    }
    const parts = splitByDay(o.span.start, Math.max(now, o.span.start))
    if (parts.length <= 1) {
      o.span.end = now
      this.store.markDirty(o.day)
      return
    }
    o.span.end = parts[0][2]
    o.span.open = false
    this.store.markDirty(o.day)
    for (const [day, s, e] of parts.slice(1)) {
      const span: Span = { start: s, end: e, open: true }
      this.store.day(day).spans.push(span)
      this.store.markDirty(day)
      this.openSpan = { day, span }
    }
  }

  private beat(): void {
    if (this.suspended) return
    this.extend(Date.now())
    this.live.now = Date.now()
    this.store.flush()
    this.onChange([dayKey(Date.now())])
  }

  onSample(s: ProbeSample, sampleIntervalMs: number, idleThresholdSec: number, captureTitles = false): void {
    if (this.suspended) return
    const now = Date.now()
    if (!this.openSpan) this.open(now)
    const day = dayKey(now)
    const d = this.store.day(day)
    const maxGap = Math.max(sampleIntervalMs * 4, 10_000)

    // the microphone held by a call app, or the Teams status "in a call" (it also covers a muted mic)
    const micApp = s.mic.map(isCallApp).find(Boolean)
    const callApp = micApp ?? (this.presenceCall ? 'Teams' : undefined)
    // who the call is with: the call window's title (only with title capture on)
    const cw = captureTitles ? (s.cw ?? []) : []
    const title = callApp ? callTitle(callApp, cw, this.preCallWindows) : undefined
    if (!callApp) this.preCallWindows = new Set(cw.map((w) => w.split('\t')[1] ?? ''))
    if (callApp) this.addCall(now, callApp, sampleIntervalMs, micApp ? 'mic' : 'teams', title)

    const idleSec = powerMonitor.getSystemIdleTime()
    let app: { name: string; kind: ReturnType<typeof classifyApp>['kind'] }
    if (this.locked) app = { name: 'Экран блокировки', kind: 'locked' }
    else if (idleSec >= idleThresholdSec && !callApp) app = { name: 'Простой', kind: 'idle' }
    else if (s.pid === process.pid) {
      // Our own island/window in focus: the user is still "in" whatever they were doing.
      const prev = [...d.activity].reverse().find((a) => a.kind !== 'idle' && a.kind !== 'locked')
      app = prev ? { name: prev.app, kind: prev.kind } : { name: 'Qvarch Assistant', kind: 'other' }
    } else app = classifyApp(s.proc)

    const last = d.activity[d.activity.length - 1]
    if (app.kind === 'idle' && last && last.kind !== 'idle') {
      // Idle actually started when input stopped: give that time back to the idle segment.
      const idleStart = Math.max(last.start, now - idleSec * 1000)
      last.end = idleStart
      d.activity.push({ start: idleStart, end: now, app: app.name, kind: 'idle' })
    } else {
      const title = captureTitles && s.title && app.kind !== 'locked' && s.pid !== process.pid ? s.title : undefined
      pushSample(d.activity, { t: now, app: app.name, kind: app.kind, title }, maxGap)
    }
    this.store.markDirty(day)

    this.live = {
      now,
      app: app.name,
      appKind: app.kind,
      idle: app.kind === 'idle' || app.kind === 'locked',
      inCall: !!callApp,
      callApp,
    }
    this.onChange([day])
  }

  /** The Teams status (Microsoft Graph presence) says the user is in a call. */
  private presenceCall = false
  /** Call-app window titles seen while not in a call — the call's own window is a new one. */
  private preCallWindows = new Set<string>()
  setPresenceCall(on: boolean): void {
    this.presenceCall = on
  }

  private addCall(now: Ms, app: string, intervalMs: number, source: CallSegment['source'] = 'mic', title?: string): void {
    const day = dayKey(now)
    const d = this.store.day(day)
    const last = [...d.calls].reverse().find((c: CallSegment) => c.app === app)
    let call = last
    if (last && now - last.end <= Math.max(CALL_GAP_MS, intervalMs * 2)) last.end = now
    else d.calls.push((call = { start: now - Math.min(intervalMs, 30_000), end: now, app, source }))
    if (call && title && !call.title) call.title = title
    // a call becomes a block on the timeline (below if the main line is busy) and is linked to its meeting
    if (call) syncCallEntry(d, call, this.store.cfg.kinds, randomUUID)
    if (this.store.cfg.outlook.linkCalls) linkCallsToMeetings(d, this.store.cfg.kinds, randomUUID, now)
    this.store.markDirty(day)
  }
}
