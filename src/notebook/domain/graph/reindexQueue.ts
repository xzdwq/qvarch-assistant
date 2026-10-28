/**
 * Which notes are to be indexed again, and when. A save only marks a note (nothing read then); a note is taken once
 * it has settled — no save for `quietMs` (an AI writing it in pieces, the autosave of typing: one indexing at the
 * end) — but not later than `maxWaitMs` after its first unindexed save (one written to all the time is still
 * indexed). The clock is given (pure: tests drive it).
 */
export interface ReindexTiming {
  quietMs: number
  maxWaitMs: number
}
export const REINDEX_TIMING: ReindexTiming = { quietMs: 3000, maxWaitMs: 60_000 }

export class ReindexQueue {
  /** A marked note: its first unindexed save and its last one. */
  private marked = new Map<string, { first: number; last: number }>()

  constructor(private timing: ReindexTiming = REINDEX_TIMING) {}

  /** A note saved (again). */
  mark(path: string, now: number): void {
    const was = this.marked.get(path)
    this.marked.set(path, { first: was?.first ?? now, last: now })
  }
  /** A note gone / indexed another way: not to be taken. */
  drop(path: string): void {
    this.marked.delete(path)
  }
  /** A note (and what is under it, a folder's) renamed: its marks follow. */
  rename(from: string, to: string): void {
    for (const [p, m] of [...this.marked]) {
      if (p !== from && !p.startsWith(`${from}/`)) continue
      this.marked.delete(p)
      this.marked.set(to + p.slice(from.length), m)
    }
  }
  has(path: string): boolean {
    return this.marked.has(path)
  }
  get size(): number {
    return this.marked.size
  }
  private dueAt(m: { first: number; last: number }): number {
    return Math.min(m.last + this.timing.quietMs, m.first + this.timing.maxWaitMs)
  }
  /** The notes due by now, the longest waiting first — taken off the queue. */
  takeDue(now: number): string[] {
    const due = [...this.marked].filter(([, m]) => this.dueAt(m) <= now).sort((a, b) => a[1].first - b[1].first)
    for (const [p] of due) this.marked.delete(p)
    return due.map(([p]) => p)
  }
  /** Every marked note, at once (a search must see them all) — taken off the queue. */
  takeAll(): string[] {
    const all = [...this.marked.keys()]
    this.marked.clear()
    return all
  }
  /** When the next note is due (none marked — undefined). */
  nextDue(): number | undefined {
    let at: number | undefined
    for (const m of this.marked.values()) at = Math.min(at ?? Infinity, this.dueAt(m))
    return at
  }
}

/**
 * Indexing done in slices, never holding the app: a slice works for `budgetMs` at most, then gives way; the pause
 * after it grows with what it cost (a big note written by an AI — a longer breath before the next).
 */
export const SLICE = { budgetMs: 12, minPauseMs: 15, maxPauseMs: 500 }
export const pauseAfter = (spentMs: number) => Math.min(SLICE.maxPauseMs, Math.max(SLICE.minPauseMs, spentMs * 2))
