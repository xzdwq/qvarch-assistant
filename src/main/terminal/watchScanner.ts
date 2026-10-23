import vm from 'node:vm'
import { compileWatch, lineKey, presetId, scanBatch, type TermAlert, type TermSession, type TermWatch } from '../../shared/terminal'

const SCAN_MS = 100
/** Output waiting for the check, at most (the oldest is skipped beyond it). */
const PEND_MAX = 2_000_000
/** A batch's check, at most — longer means a regex that backtracks forever: the reactions pause. */
const SCAN_LIMIT_MS = 2000
const MAX_ALERTS = 100
/** Line keys a notice remembers, at most. */
const ALERT_KEYS_MAX = 500
/** Closed line keys a shell remembers per reaction, at most (the oldest are forgotten first). */
const DISMISSED_MAX = 2000

/** One shell's side of the reactions: its output waiting for the check and the lines whose notice was closed. */
export interface ScanState {
  pend: string[]
  pendLen: number
  /** The unfinished last line of the previous batch. */
  carry: string
  timer?: NodeJS.Timeout
  /** Lines whose notice was closed, by reaction (their keys): they do not raise it again. */
  dismissed: Map<string, Set<string>>
}
export const newScanState = (): ScanState => ({ pend: [], pendLen: 0, carry: '', dismissed: new Map() })

/** A shell as the reactions see it: its public state (title, skipped count) and its scan state. */
export interface ScannedShell {
  s: TermSession
  scan: ScanState
}

/**
 * The reactions (a word or a regex in a command's output → a notice): the output is read line by line, in batches
 * (every SCAN_MS), in a sandbox with a time limit; what a flood brings beyond PEND_MAX waiting is skipped (and
 * counted) — the check never falls behind for good, the memory stays bounded.
 */
export class WatchScanner {
  private watches: TermWatch[] = []
  private rules: Array<{ id: string; source: string; flags: string }> = []
  private sandbox = vm.createContext({ cache: {} as Record<string, RegExp>, input: null as unknown })
  private scanScript = new vm.Script(`(${scanBatch.toString()})(input.raw, input.carry, input.rules, cache)`)
  private alertList: TermAlert[] = []
  /** Each notice's line keys (what closing it silences). */
  private alertKeys = new Map<string, Set<string>>()
  /** Why the reactions are paused (a regex too slow / broken). */
  watchError = ''

  constructor(
    private readonly shellOf: (id: string) => ScannedShell | undefined,
    private readonly onAlerts: (list: TermAlert[], watchError: string) => void,
    /** A shell's public state changed (its skipped count). */
    private readonly onShellChanged: () => void,
  ) {}

  /** Whether any reaction is on (no rules — the output is not even collected). */
  get active(): boolean {
    return this.rules.length > 0
  }

  /** The reactions (new or edited): compiled again; a broken one pauses them all with its error. */
  setWatches(watches: TermWatch[], announce: boolean): void {
    this.watches = watches
    this.watchError = ''
    this.rules = []
    for (const w of watches) {
      if (!w.on) continue
      try {
        const r = compileWatch(w)
        if (r) this.rules.push({ id: w.id, ...r })
      } catch (e) {
        this.watchError = `«${w.name}»: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    this.sandbox.cache = {}
    if (announce) this.alertsChanged()
  }

  /** A command's output to check (soon, in a batch). */
  feed(sh: ScannedShell, d: string): void {
    if (!d) return
    const st = sh.scan
    st.pend.push(d)
    st.pendLen += d.length
    // a flood: the oldest waiting output is skipped (counted) — the check keeps up, the memory stays bounded
    while (st.pendLen > PEND_MAX && st.pend.length > 1) {
      const x = st.pend.shift()!
      st.pendLen -= x.length
      sh.s.skipped = (sh.s.skipped ?? 0) + x.length
      st.carry = ''
    }
    st.timer ??= setTimeout(() => this.scanNow(sh), SCAN_MS)
  }
  /** The command ended: its last line is complete — checked now. */
  commandEnded(sh: ScannedShell): void {
    if (sh.scan.pend.length || sh.scan.carry) this.feed(sh, '\n')
    this.scanNow(sh)
  }
  /** The shell is gone: its pending check dropped. */
  forget(sh: ScannedShell): void {
    clearTimeout(sh.scan.timer)
  }

  /** The waiting output checked in the sandbox; matches raise or add to the shell's notices. */
  private scanNow(sh: ScannedShell): void {
    const st = sh.scan
    clearTimeout(st.timer)
    st.timer = undefined
    if (!st.pend.length) return
    const raw = st.pend.join('')
    st.pend = []
    st.pendLen = 0
    if (!this.rules.length || this.watchError) return
    let res: ReturnType<typeof scanBatch>
    try {
      this.sandbox.input = { raw, carry: st.carry, rules: this.rules }
      res = this.scanScript.runInContext(this.sandbox, { timeout: SCAN_LIMIT_MS }) as ReturnType<typeof scanBatch>
    } catch {
      // too long (a busy machine, a heavy regex): this batch goes unchecked — counted, no alarm, the next one is read
      st.carry = ''
      sh.s.skipped = (sh.s.skipped ?? 0) + raw.length
      this.onShellChanged()
      return
    } finally {
      this.sandbox.input = null
    }
    st.carry = res.carry
    if (!res.hits.length) return
    const now = Date.now()
    let changed = false
    for (const h of res.hits) {
      const w = this.watches.find((x) => x.id === h.id)
      if (!w) continue
      // lines whose notice was closed do not count again (a process redrawing the same line)
      const gone = st.dismissed.get(w.id)
      const fresh = gone ? h.keys.filter(([k]) => !gone.has(k)) : h.keys
      const beyond = h.count - h.keys.reduce((s, [, n]) => s + n, 0)
      const count = fresh.reduce((s, [, n]) => s + n, 0) + beyond
      if (!count) continue
      const line = gone?.has(lineKey(h.line)) ? (fresh[fresh.length - 1]?.[2] ?? h.line) : h.line
      changed = true
      let a = this.alertList.find((x) => x.sid === sh.s.id && x.watchId === w.id)
      if (a) {
        a.count += count
        a.last = now
        a.line = line
        a.color = w.color
        a.name = w.name
      } else {
        a = { id: presetId(), sid: sh.s.id, title: sh.s.title, watchId: w.id, name: w.name, color: w.color, at: now, last: now, count, line }
        this.alertList.unshift(a)
        this.alertList.length = Math.min(this.alertList.length, MAX_ALERTS)
      }
      // the notice remembers its lines — closing it closes them
      let keys = this.alertKeys.get(a.id)
      if (!keys) this.alertKeys.set(a.id, (keys = new Set()))
      for (const [k] of fresh) if (keys.size < ALERT_KEYS_MAX) keys.add(k)
    }
    if (changed) this.alertsChanged()
  }

  alerts(): { list: TermAlert[]; watchError: string } {
    return { list: this.alertList, watchError: this.watchError }
  }
  /** Closes a notice (or every one): its lines are remembered for its shell and reaction — they stay quiet. */
  dismiss(id?: string): void {
    for (const a of this.alertList) {
      if (id && a.id !== id) continue
      const sh = this.shellOf(a.sid)
      const keys = this.alertKeys.get(a.id)
      if (sh && keys) {
        let gone = sh.scan.dismissed.get(a.watchId)
        if (!gone) sh.scan.dismissed.set(a.watchId, (gone = new Set()))
        for (const k of keys) gone.add(k)
        // bounded: the oldest are forgotten first
        while (gone.size > DISMISSED_MAX) gone.delete(gone.values().next().value!)
      }
      this.alertKeys.delete(a.id)
    }
    this.alertList = id ? this.alertList.filter((a) => a.id !== id) : []
    this.alertsChanged()
  }
  private alertsChanged(): void {
    this.onAlerts(this.alertList, this.watchError)
  }
}
