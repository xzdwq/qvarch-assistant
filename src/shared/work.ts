import type { TaskRef } from './jira'
import { OWN_PREFIX } from './board'
import { isKind } from './tracker/constants'
import type { DayData, Entry, Ms } from './types'

/**
 * «Моя работа» for one day: the tasks taken for the day (Jira and own) with the time spent on each, the Outlook
 * meetings and the calls (they arrive by themselves) and whatever else has no task yet. A meeting / a call / a
 * block given a task counts in that task.
 */
export interface WorkTask {
  task: TaskRef
  own: boolean
  /** The blocks of this task on the day, in time order (meetings / calls given to it included). */
  slots: Entry[]
  ms: number
}
export interface WorkDay {
  tasks: WorkTask[]
  meetings: Entry[]
  calls: Entry[]
  /** Blocks without a task that are neither a meeting nor a call. */
  other: Entry[]
  totals: { all: number; tasks: number; meetings: number; calls: number }
}

export const isOwnTask = (key: string) => key.startsWith(OWN_PREFIX)
/** A meeting (from Outlook, or of the built-in kind) / a detected call — the kinds the app itself gives blocks. */
export const isMeeting = (e: Entry) => !!e.outlook || isKind(e.kind, 'meeting')
export const isCall = (e: Entry) => isKind(e.kind, 'call')

/** Union length of intervals (parallel time counted once). */
function unionLen(list: Array<{ start: Ms; end: Ms }>): number {
  const s = [...list].sort((a, b) => a.start - b.start)
  let sum = 0
  let cs = -Infinity
  let ce = -Infinity
  for (const x of s) {
    if (x.start > ce) {
      if (ce > cs) sum += ce - cs
      cs = x.start
      ce = x.end
    } else ce = Math.max(ce, x.end)
  }
  if (ce > cs) sum += ce - cs
  return sum
}

export function workDay(d: Pick<DayData, 'entries'> & { dayTasks?: TaskRef[] }): WorkDay {
  const byKey = new Map<string, WorkTask>()
  const add = (t: TaskRef) => {
    let w = byKey.get(t.key)
    if (!w) byKey.set(t.key, (w = { task: { key: t.key, summary: t.summary }, own: isOwnTask(t.key), slots: [], ms: 0 }))
    return w
  }
  // the day's list first (its order), then tasks that only have blocks
  for (const t of d.dayTasks ?? []) add(t)
  const sorted = [...d.entries].sort((a, b) => a.start - b.start)
  const meetings: Entry[] = []
  const calls: Entry[] = []
  const other: Entry[] = []
  for (const e of sorted) {
    if (e.task) add(e.task).slots.push(e)
    if (isMeeting(e)) meetings.push(e)
    else if (isCall(e)) calls.push(e)
    else if (!e.task) other.push(e)
  }
  const tasks = [...byKey.values()]
  for (const t of tasks) t.ms = unionLen(t.slots)
  return {
    tasks,
    meetings,
    calls,
    other,
    totals: {
      all: unionLen(sorted),
      tasks: unionLen(sorted.filter((e) => e.task)),
      meetings: unionLen(meetings),
      calls: unionLen(calls),
    },
  }
}

