import { powerMonitor } from 'electron'
import { randomUUID } from 'node:crypto'
import { emptyCombo, pushKeys, type ComboState } from '../../shared/combo'
import { addToRows, type PulsePoint } from '../../shared/pulse'
import { dayKey, dayStart, firstFreeLane, pinLanes, putEntry, scheduleRanges } from '../../shared/timeline'
import type { Entry } from '../../shared/types'
import { isKind } from '../../shared/tracker/constants'
import type { AppContext } from '../app/appContext'

/**
 * What the input says (amounts only — never which keys, never what apps): the typing combo, the activity pulse,
 * window switches, the automatic lunch when the input stops at lunch time.
 */
const PULSE_KEEP = 300
const LUNCH_LEAD_MS = 10 * 60_000

export class Activity {
  private combo: ComboState = emptyCombo()
  private comboDay = ''
  /** The live 1-second bins (the last few minutes). */
  private readonly pulseBins: PulsePoint[] = []
  private pulseTimer: NodeJS.Timeout | undefined
  private lastProc = ''
  constructor(private readonly app: AppContext) {}

  /** Today's combo (the day's best read from its file when the day changes). */
  currentCombo(): ComboState {
    const day = dayKey(Date.now())
    if (day !== this.comboDay) {
      const saved = this.app.store.day(day).combo
      this.combo = { ...emptyCombo(), best: saved?.best ?? 0, bestAt: saved?.at }
      this.comboDay = day
    }
    return this.combo
  }
  /** The recent live bins (for a window opened now). */
  recentPulse(): PulsePoint[] {
    return this.pulseBins.slice(-120)
  }
  /** An input batch: key presses' moments and the mouse's travel. */
  onInput(times: number[], mousePx: number): void {
    const { store } = this.app
    if (times.length) {
      const c = this.currentCombo()
      if (pushKeys(c, times)) {
        const d = store.day(this.comboDay)
        d.combo = { best: c.best, at: c.bestAt ?? Date.now() }
        store.markDirty(this.comboDay)
      }
      this.app.emitToAll('onCombo', { ...c })
    }
    this.addPulse(times.length, mousePx, 0)
  }
  /** A different foreground process than the previous sample = one window switch. */
  countSwitch(proc: string): void {
    if (!proc) return
    if (this.lastProc && proc !== this.lastProc) this.addPulse(0, 0, 1)
    this.lastProc = proc
  }
  /**
   * Every input batch lands in a 1-second live bin (kept for a few minutes, streamed to the windows at most ~3 times
   * a second) and in the day's minute bins (stored).
   */
  private addPulse(k: number, m: number, s: number): void {
    const { store } = this.app
    const now = Date.now()
    const t = Math.floor(now / 1000) * 1000
    let bin = this.pulseBins[this.pulseBins.length - 1]
    if (!bin || bin.t !== t) {
      bin = { t, k: 0, m: 0, s: 0 }
      this.pulseBins.push(bin)
      if (this.pulseBins.length > PULSE_KEEP) this.pulseBins.splice(0, this.pulseBins.length - PULSE_KEEP)
    }
    bin.k += k
    bin.m += m
    bin.s += s
    const day = dayKey(now)
    const d = store.day(day)
    d.pulse ??= []
    addToRows(d.pulse, dayStart(day), now, k, m, s)
    store.markDirty(day)
    this.pulseTimer ??= setTimeout(() => {
      this.pulseTimer = undefined
      this.app.emitToAll('onPulse', this.pulseBins.slice(-3))
    }, 300)
  }
  /**
   * Lunch time by the schedule (from 10 min before) and no input → a lunch block up to the lunch end, on a free lane:
   * whatever happens meanwhile (a call…) goes in parallel. Once a day; not if the user has one.
   */
  autoLunch(): void {
    const { store } = this.app
    // no input for a while (the system's idle time — nothing about apps is looked at or kept)
    const idleSec = powerMonitor.getSystemIdleTime()
    if (idleSec < store.cfg.idleThresholdSec) return
    const now = Date.now()
    const day = dayKey(now)
    const { lunch } = scheduleRanges(day, store.cfg.schedule)
    if (!lunch || now < lunch[0] - LUNCH_LEAD_MS || now >= lunch[1]) return
    const d = store.day(day)
    if (d.autoLunch) return
    const kind = store.cfg.kinds.find((k) => isKind(k.id, 'lunch'))
    if (!kind) return
    if (d.entries.some((e) => e.kind === kind.id && e.end > lunch[0] && e.start < lunch[1])) {
      d.autoLunch = 'manual'
      store.markDirty(day)
      return
    }
    // from when the input stopped (but not earlier than 10 min before lunch)
    const start = Math.max(now - idleSec * 1000, lunch[0] - LUNCH_LEAD_MS)
    const entry: Entry = { id: randomUUID(), start, end: lunch[1], kind: kind.id, label: kind.label, source: 'detected', lane: firstFreeLane(d.entries, start, lunch[1]) }
    d.entries = pinLanes(putEntry(d.entries, entry), entry.id)
    d.autoLunch = entry.id
    store.markDirty(day)
    store.flush()
    this.app.broadcast()
  }
}
