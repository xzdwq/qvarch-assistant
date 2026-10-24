import { randomUUID } from 'node:crypto'
import { dayEnd, dayKey, MINUTE, scheduleRanges, shiftDay } from '../../shared/timeline'
import { canRecord, extendRecording, isStaleRecording, recordingStep } from '../../shared/tracker/recording'
import type { Entry } from '../../shared/types'
import type { AppContext } from '../app/appContext'
import { addEntryOnFreeLane } from './dayEdits'

/** How often the recorded events' ends catch up with the clock. */
const TICK_MS = 15_000

/**
 * «Запись» (shared/tracker/recording): the events marked as recorded stretch with the clock — here, so they go on
 * with the window closed; any number of them. Each is the person's to edit meanwhile (kind, text, task, its start);
 * its end stays the recording's. A recording the app was closed through ends where it got (on the next start).
 */
export class Recording {
  private timer?: NodeJS.Timeout

  constructor(private app: AppContext) {}

  /** Following the recordings (the ones left from a closed app — ended first). */
  start(): void {
    const now = Date.now()
    for (const day of this.days(now)) {
      const d = this.app.store.day(day)
      let changed = false
      d.entries = d.entries.map((e) => {
        if (!e.recording || !isStaleRecording(e, now)) return e
        changed = true
        return { ...e, recording: undefined }
      })
      if (changed) this.app.store.markDirty(day)
    }
    this.app.store.flush()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }
  stop(): void {
    this.tick()
    clearInterval(this.timer)
  }

  /** A recording begun now: a new event of this kind on the first free lane, its end following the clock. */
  begin(kind: string, label: string): Entry {
    const now = Date.now()
    const day = dayKey(now)
    const start = Math.floor(now / MINUTE) * MINUTE
    const entry = addEntryOnFreeLane(this.app, day, { id: randomUUID(), start, end: start + MINUTE, kind, label: label.trim() || kind, source: 'manual', created: now, recording: true })
    this.saved(day)
    return entry
  }

  /** A recording started on an event (going on or ahead) / stopped (its end — the moment, when it is going on). */
  set(day: string, id: string, on: boolean): void {
    const d = this.app.store.day(day)
    const e = d.entries.find((x) => x.id === id)
    if (!e) throw new Error('Событие не найдено')
    if (on && !canRecord(e, Date.now())) throw new Error('Запись можно включить только для идущего или будущего события')
    if (on) e.recording = true
    else {
      this.stepOn(day)
      const cur = d.entries.find((x) => x.id === id)
      if (cur) delete cur.recording
    }
    this.saved(day)
    if (on) this.tick()
  }

  /** A save from the card: the recording's mark and its stretched end stay the recording's. */
  guard<T extends { id?: string; end: number; recording?: true }>(day: string, input: T): T {
    const prev = input.id ? this.app.store.day(day).entries.find((e) => e.id === input.id) : undefined
    const out = { ...input, recording: prev?.recording }
    if (prev?.recording && Date.now() >= prev.start) out.end = Math.max(input.end, prev.end)
    return out
  }

  /** The ends caught up with the clock; one at its limit (the work day's end, midnight) — stopped. */
  tick(): void {
    for (const day of this.days(Date.now())) if (this.stepOn(day)) this.saved(day)
  }
  /** The day's recordings stepped; whether anything changed. */
  private stepOn(day: string): boolean {
    const { store } = this.app
    const d = store.day(day)
    const now = Date.now()
    const limits = { workEnd: scheduleRanges(day, store.cfg.schedule).work?.[1], stopAtWorkEnd: store.cfg.schedule.stopRecordingAtEnd !== false, dayEnd: dayEnd(day) }
    let changed = false
    for (const e of d.entries.filter((x) => x.recording)) {
      const r = recordingStep(e, now, limits)
      if (r.end !== e.end) {
        d.entries = extendRecording(d.entries, e.id, r.end)
        changed = true
      }
      if (r.stop) {
        const x = d.entries.find((y) => y.id === e.id)
        if (x) delete x.recording
        changed = true
      }
    }
    return changed
  }
  /** The days a recording may be on now: today, and yesterday (one going on at midnight ends there). */
  private days(now: number): string[] {
    const today = dayKey(now)
    return [shiftDay(today, -1), today]
  }
  private saved(day: string): void {
    this.app.store.markDirty(day)
    this.app.store.flush()
    this.app.broadcast()
  }
}
