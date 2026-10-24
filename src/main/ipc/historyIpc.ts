import { keyTotals } from '../../shared/board'
import type { EventRef } from '../../shared/noteEvents'
import { clipEntries, dayKey } from '../../shared/timeline'
import type { AppContext } from '../app/appContext'
import type { Activity } from '../tracker/activity'
import { handle } from './router'

/** Reading the history: events of every day, ranges of days, the task calendar, time per task, search, live activity. */
export function registerHistoryIpc(app: AppContext, activity: Activity): void {
  const { store } = app
  // every event of every day, light (the notebook's «@» list and its chips)
  handle('eventsIndex', () => {
    const out: EventRef[] = []
    for (const day of store.listDays()) {
      const d = store.peek(day)
      if (!d) continue
      for (const e of d.entries) out.push({ day, id: e.id, label: e.label, kind: e.kind, start: e.start, end: e.end, outlook: !!e.outlook, ...(e.task ? { task: e.task.key } : {}), ...(e.created ? { created: e.created } : {}), ...(e.attrs ? { attrs: e.attrs } : {}) })
    }
    return out
  })
  handle('rangeDays', (_e, from, to) =>
    store
      .listDays()
      .filter((d) => d >= from && d <= to)
      .flatMap((day) => {
        const d = store.peek(day)
        return d ? [{ day, entries: d.entries }] : []
      }),
  )
  /** The task calendar: blocks and notes of the stored days in [from, to] — nothing heavier. */
  handle('calendarRange', (_e, from, to) =>
    store
      .listDays()
      .filter((d) => d >= from && d <= to)
      .map((day) => {
        const d = store.day(day)
        return { day, entries: d.entries, notes: d.notes, plan: d.plan ?? [], dayTasks: d.dayTasks ?? [] }
      }),
  )
  /** A day as far as it happened: today's planned (future) blocks are not time spent yet. */
  const spentDay = (day: string) => {
    const d = store.day(day)
    return day === dayKey(Date.now()) ? { ...d, entries: clipEntries(d.entries, Date.now()) } : d
  }
  handle('jiraTracked', () => keyTotals(store.listDays().map(spentDay)))
  /** Every block of every day linked to a task (the planned ones too) — when a task was / will be worked on. */
  handle('jiraWorked', () => {
    const out: Record<string, Array<{ day: string; id: string; start: number; end: number }>> = {}
    for (const day of store.listDays()) for (const e of store.day(day).entries) if (e.task?.key) (out[e.task.key] ??= []).push({ day, id: e.id, start: e.start, end: e.end })
    return out
  })
  handle('search', (_e, q) => store.search(String(q ?? '')))
  handle('getCombo', () => activity.currentCombo())
  handle('getPulse', () => activity.recentPulse())
}
