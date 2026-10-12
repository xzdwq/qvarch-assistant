import type { DayData, Entry, LocalTask } from './types'
import { unionMs } from './timeline'

/**
 * Tasks across days: a block belongs to a task by its key — a Jira key or an own task's number (Q-12).
 * The same task taken into work on many days is one task; its time adds up (parallel blocks of one task
 * counted once a day). Blocks without a task are grouped by kind + label.
 */
export const blockKey = (e: Pick<Entry, 'kind' | 'label'>): string => `b:${e.kind}:${e.label.trim().toLowerCase()}`
export const cardKey = (e: Pick<Entry, 'kind' | 'label' | 'task'>): string => e.task?.key ?? blockKey(e)

export const OWN_PREFIX = 'Q-'
export const taskNo = (key?: string): number => Number(/^Q-(\d+)$/.exec(key ?? '')?.[1] ?? 0)
/** Own task keys: Q-1, Q-2, … — the next one, never below the last number given out (a deleted task's key stays on its blocks). */
export function nextTaskKey(tasks: Array<Pick<LocalTask, 'key'>>, lastUsed = 0): string {
  const n = Math.max(lastUsed, ...tasks.map((t) => taskNo(t.key)))
  return `${OWN_PREFIX}${n + 1}`
}

/** All-time totals per task key. */
export function keyTotals(days: Array<Pick<DayData, 'entries'>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of days) {
    const by = new Map<string, Entry[]>()
    for (const e of d.entries) by.set(cardKey(e), [...(by.get(cardKey(e)) ?? []), e])
    for (const [k, list] of by) out[k] = (out[k] ?? 0) + unionMs(list)
  }
  return out
}
