import { randomUUID } from 'node:crypto'
import { dayEnd, dayKey, MINUTE, scheduleRanges } from '../../shared/timeline'
import { extendRecording, recordingEnd } from '../../shared/tracker/recording'
import type { Entry, RecordingState } from '../../shared/types'
import type { AppContext } from '../app/appContext'
import { addEntryOnFreeLane } from './dayEdits'

/** How often a recording's end catches up with the clock. */
const TICK_MS = 15_000

/**
 * «Запись»: an event started now whose end follows the clock until it is stopped (shared/tracker/recording) — here,
 * so it goes on with the window closed. Its event is the person's to edit meanwhile (kind, text, task, its start);
 * its end stays the recording's. Not kept over a restart: the event stays as far as it got.
 */
export class Recording {
  state?: RecordingState
  private timer?: NodeJS.Timeout

  constructor(private app: AppContext) {}

  /** A recording begun now (one going on is stopped first): its event on the first free lane. */
  start(kind: string, label: string): Entry {
    this.stop()
    const now = Date.now()
    const day = dayKey(now)
    const start = Math.floor(now / MINUTE) * MINUTE
    const entry = addEntryOnFreeLane(this.app, day, { id: randomUUID(), start, end: start + MINUTE, kind, label: label.trim() || kind, source: 'manual', created: now })
    this.state = { day, entryId: entry.id }
    this.saved(day)
    this.timer = setInterval(() => this.tick(), TICK_MS)
    return entry
  }

  /** The event is the recording's (its end is not taken from a save). */
  owns(id: string | undefined): boolean {
    return !!id && this.state?.entryId === id
  }
  /** The recording's event as far as it got (a save from the card keeps this end). */
  currentEnd(): number | undefined {
    const s = this.state
    return s && this.app.store.day(s.day).entries.find((e) => e.id === s.entryId)?.end
  }

  /** The end caught up with the clock; the event gone (deleted, moved to another day) — the recording ends. */
  tick(): void {
    const s = this.state
    if (!s) return
    const { store } = this.app
    const d = store.day(s.day)
    const e = d.entries.find((x) => x.id === s.entryId)
    if (!e) return this.clear()
    const r = recordingEnd(e.start, Date.now(), { workEnd: scheduleRanges(s.day, store.cfg.schedule).work?.[1], stopAtWorkEnd: store.cfg.schedule.stopRecordingAtEnd !== false, dayEnd: dayEnd(s.day) })
    d.entries = extendRecording(d.entries, e.id, r.end)
    this.saved(s.day)
    if (r.stop) this.clear()
  }

  /** Stopped by the person: the end at the moment, the recording over. */
  stop(): void {
    if (!this.state) return
    this.tick()
    this.clear()
  }

  private clear(): void {
    clearInterval(this.timer)
    this.timer = undefined
    this.state = undefined
    this.app.broadcast()
  }
  private saved(day: string): void {
    this.app.store.markDirty(day)
    this.app.store.flush()
    this.app.broadcast()
  }
}
