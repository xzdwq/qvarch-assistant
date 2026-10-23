import type { Entry, KindDef, Ms, WorkSchedule } from './types'
import { atTime, mergeIntervals, subtractRanges, unionMs } from './timeline'
import { BUILTIN_KINDS, isBuiltinKind, kindColorVar, type BuiltinKind } from './tracker/constants'

/** How each built-in kind starts out: its name, icon and whether it is work. */
const BUILTIN_KIND_LOOK: Record<BuiltinKind, Omit<KindDef, 'id' | 'color'> & { productive: boolean }> = {
  task: { label: 'Задача', icon: 'code', productive: true },
  call: { label: 'Созвон', icon: 'phone', productive: true },
  meeting: { label: 'Встреча', icon: 'users', productive: true },
  break: { label: 'Перерыв', icon: 'coffee', productive: false },
  lunch: { label: 'Обед', icon: 'utensils', productive: false },
  other: { label: 'Другое', icon: 'tag', productive: true },
}

/**
 * The kinds of new settings. Made by main (no CSS there), so a default colour is the CSS variable of the
 * tracker's colours that holds it — the renderer shows it as is; a colour the user picks is stored as `#rrggbb`.
 */
export const DEFAULT_KINDS: KindDef[] = BUILTIN_KINDS.map((id) => ({ id, ...BUILTIN_KIND_LOOK[id], color: kindColorVar(id) }))

/** Kind lookup with a safe fallback for entries whose kind was deleted from settings. */
export function findKind(kinds: KindDef[], id: string): KindDef {
  return kinds.find((k) => k.id === id) ?? { id, label: id, color: kindColorVar('other'), icon: 'tag' }
}

/** Breaks and lunch are not work; everything else is unless switched off in settings. */
export function isProductive(kinds: KindDef[], id: string): boolean {
  const k = kinds.find((x) => x.id === id)
  if (k?.productive !== undefined) return k.productive
  return isBuiltinKind(id) ? BUILTIN_KIND_LOOK[id].productive : true
}

/** Productive time: union of productive blocks (parallel blocks counted once). */
export function productiveMs(entries: Entry[], kinds: KindDef[]): number {
  return unionMs(entries.filter((e) => isProductive(kinds, e.kind)))
}

/** Official working time of a day without lunch (0 on days off). */
export function workDayMs(day: string, s: WorkSchedule, dow: number): number {
  if (!s.workDays.includes(dow)) return 0
  const work = Math.max(0, atTime(day, s.end) - atTime(day, s.start))
  const lunch = s.lunchStart && s.lunchEnd ? Math.max(0, atTime(day, s.lunchEnd) - atTime(day, s.lunchStart)) : 0
  return Math.max(0, work - lunch)
}

export type { Ms }

/**
 * Productive time split by the official schedule: `within` — inside working hours (lunch excluded), the base
 * for "% of the work day" (100% = the whole work day filled); `over` — before/after hours, on lunch or on a day off.
 */
export function productiveSplit(
  entries: Entry[],
  kinds: KindDef[],
  work?: [Ms, Ms],
  lunch?: [Ms, Ms],
): { total: number; within: number; over: number } {
  const merged = mergeIntervals(entries.filter((e) => isProductive(kinds, e.kind)))
  const total = merged.reduce((s, x) => s + (x.end - x.start), 0)
  if (!work) return { total, within: 0, over: total }
  let within = 0
  for (const x of merged) {
    for (const [a, b] of subtractRanges(Math.max(x.start, work[0]), Math.min(x.end, work[1]), lunch ? [{ start: lunch[0], end: lunch[1] }] : []))
      within += Math.max(0, b - a)
  }
  return { total, within, over: total - within }
}

/** QA-on time that no block covers (parallel blocks counted once). */
export function unlabelledMs(entries: Entry[], spans: Array<{ start: Ms; end: Ms }>): number {
  const covered = mergeIntervals(entries.map((e) => ({ start: e.start, end: e.end })))
  let sum = 0
  for (const s of spans) for (const [a, b] of subtractRanges(s.start, s.end, covered)) sum += b - a
  return sum
}
