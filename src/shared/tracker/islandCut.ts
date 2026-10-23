import { visibleNotes, noteEntry } from '../notes'
import type { Quick } from '../quickadd'
import { dayStart, MINUTE, parseQuickDuration } from '../timeline'
import type { Entry, Ms, Note } from '../types'

/**
 * The island's rules without state: where a cut or a quick event goes (what its quick line says wins),
 * the day list's rows.
 */

/** Where a new block goes; no range — nothing to cut. */
export interface CutPlace {
  day: string
  range?: { start: Ms; end: Ms }
  /** The block's title (a leading «30м» is taken off when it set the range). */
  text: string
}

/** The same times of day on another day. */
function shiftToDay(range: { start: Ms; end: Ms }, from: string, to: string): { start: Ms; end: Ms } {
  const shift = dayStart(to) - dayStart(from)
  return { start: range.start + shift, end: range.end + shift }
}

/**
 * The cut row: the line's time («14:00-15:30», «в 9:30 1ч») on its day; its duration without a marker — the last
 * N minutes; an unparsed «30м …» without a marker — the same; otherwise the active period (marker / implicit).
 * A line naming another day moves the range there.
 */
export function cutPlace(o: { title: string; q?: Quick; hasMarker: boolean; active?: { start: Ms; end: Ms }; now: Ms; today: string }): CutPlace {
  const { q, now, today } = o
  let text = o.title
  let day = today
  let range = o.active
  if (q?.start !== undefined) {
    range = { start: q.start, end: q.end ?? q.start + (q.dur ?? 30 * MINUTE) }
    day = q.day
  } else if (q?.dur && !o.hasMarker) {
    range = { start: now - q.dur, end: now }
  } else if (!q) {
    const quick = !o.hasMarker ? parseQuickDuration(text) : undefined
    if (quick) {
      range = { start: now - quick.minutes * MINUTE, end: now }
      text = quick.rest.trim()
    }
  }
  if (range && q && q.start === undefined && q.day !== today) {
    range = shiftToDay(range, today, q.day)
    day = q.day
  }
  return { day, range, text }
}

/**
 * The orb's «Событие»: ± minutes from the current minute (− the last N, + the next N), unless the line names the
 * duration (the last N) or the time (on its day); a line naming another day moves it there.
 */
export function quickEventPlace(o: { q?: Quick; offsetMin: number; now: Ms; today: string }): { day: string; start: Ms; end: Ms } {
  const { q, today } = o
  const t = Math.floor(o.now / MINUTE) * MINUTE
  const off = q?.dur ? -q.dur / MINUTE : o.offsetMin
  if (q?.start !== undefined) return { day: q.day, start: q.start, end: q.end ?? q.start + (q.dur ?? 30 * MINUTE) }
  const range = { start: off < 0 ? t + off * MINUTE : t, end: off < 0 ? t : t + off * MINUTE }
  if (q && q.day !== today) return { day: q.day, ...shiftToDay(range, today, q.day) }
  return { day: today, ...range }
}

/** A row of the island's day list: a block, or a note (under its block, or on its own by time). */
export type DayListRow = { type: 'entry'; e: Entry } | { type: 'note'; n: Note; owned: boolean }

/** Blocks in time order (then by lane), each followed by its notes; notes outside any block by their time. */
export function dayListRows(entries: Entry[], notes: Note[] | undefined): DayListRow[] {
  const sorted = [...entries].sort((a, b) => a.start - b.start || (a.lane ?? 0) - (b.lane ?? 0))
  const shown = visibleNotes(notes)
  const owner = new Map(shown.map((n) => [n.id, noteEntry(n, entries)]))
  const rows: DayListRow[] = []
  const orphans = shown.filter((n) => !owner.get(n.id))
  let oi = 0
  for (const e of sorted) {
    while (oi < orphans.length && orphans[oi].at < e.start) rows.push({ type: 'note', n: orphans[oi++], owned: false })
    rows.push({ type: 'entry', e })
    for (const n of shown) if (owner.get(n.id)?.id === e.id) rows.push({ type: 'note', n, owned: true })
  }
  while (oi < orphans.length) rows.push({ type: 'note', n: orphans[oi++], owned: false })
  return rows
}
