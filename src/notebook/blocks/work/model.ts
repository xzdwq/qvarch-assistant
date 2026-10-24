import { fenceBodyLines } from '../../domain/fence'

/** The «Работа» component's model: the work done over a period (```work, period / from / to / view / hide). */
export const WORK_PERIODS = [
  { id: 'today', title: 'Сегодня' },
  { id: 'yesterday', title: 'Вчера' },
  { id: 'this-week', title: 'Эта неделя' },
  { id: 'last-week', title: 'Прошлая неделя' },
  { id: 'this-month', title: 'Этот месяц' },
  { id: 'last-month', title: 'Прошлый месяц' },
  { id: 'custom', title: 'Свои даты' },
] as const satisfies ReadonlyArray<{ id: string; title: string }>
export type WorkPeriod = (typeof WORK_PERIODS)[number]['id']
const isWorkPeriod = (s: string): s is WorkPeriod => WORK_PERIODS.some((p) => p.id === s)
/** How the work is laid out: a table of the days or a list. */
export const WORK_VIEWS = ['table', 'list'] as const
export type WorkView = (typeof WORK_VIEWS)[number]
const isWorkView = (s: string): s is WorkView => (WORK_VIEWS as readonly string[]).includes(s)
export interface WorkModel {
  period: WorkPeriod
  /** YYYY-MM-DD, for «custom». */
  from?: string
  to?: string
  view: WorkView
  /** Kinds not shown (calls, meetings…). */
  hide?: string[]
  /** Whose work it is (a shared note: the device that made it — the others see its owner's work, not their own). */
  owner?: string
  /** The owner's name (as the others see it). */
  by?: string
}
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
/** The settings lines of a ```work fence, each written into the model when its value fits. */
const WORK_SETTINGS = {
  period: (m: WorkModel, v: string) => {
    if (isWorkPeriod(v)) m.period = v
  },
  from: (m: WorkModel, v: string) => {
    if (DAY_KEY.test(v)) m.from = v
  },
  to: (m: WorkModel, v: string) => {
    if (DAY_KEY.test(v)) m.to = v
  },
  view: (m: WorkModel, v: string) => {
    if (isWorkView(v)) m.view = v
  },
  hide: (m: WorkModel, v: string) => {
    m.hide = v.split(/[,\s]+/).filter(Boolean)
  },
  owner: (m: WorkModel, v: string) => {
    if (/^[0-9a-f]{32}$/.test(v)) m.owner = v
  },
  by: (m: WorkModel, v: string) => {
    if (v) m.by = v.slice(0, 60)
  },
} satisfies Record<string, (m: WorkModel, value: string) => void>
type WorkSetting = keyof typeof WORK_SETTINGS
const WORK_LINE = new RegExp(`^\\s*(${Object.keys(WORK_SETTINGS).join('|')})\\s*:\\s*(.*?)\\s*$`, 'i')

export function parseWork(src: string): WorkModel {
  const m: WorkModel = { period: 'today', view: 'table' }
  for (const l of fenceBodyLines(src)) {
    const kv = WORK_LINE.exec(l)
    if (kv) WORK_SETTINGS[kv[1].toLowerCase() as WorkSetting](m, kv[2])
  }
  if (m.from && m.to && m.period !== 'custom') m.period = 'custom'
  return m
}
export const workMd = (m: WorkModel) =>
  ['```work', `period: ${m.period}`, ...(m.period === 'custom' ? [`from: ${m.from ?? ''}`, `to: ${m.to ?? m.from ?? ''}`] : []), `view: ${m.view}`, ...(m.hide?.length ? [`hide: ${m.hide.join(', ')}`] : []), ...(m.owner ? [`owner: ${m.owner}`, ...(m.by ? [`by: ${m.by}`] : [])] : []), '```'].join('\n')
const dayKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** The days of a period (local), from — to inclusive. */
export function workRange(m: WorkModel, now = new Date()): { from: string; to: string } {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const add = (x: Date, n: number) => new Date(x.getFullYear(), x.getMonth(), x.getDate() + n)
  const monday = add(d, -((d.getDay() + 6) % 7))
  switch (m.period) {
    case 'yesterday':
      return { from: dayKeyOf(add(d, -1)), to: dayKeyOf(add(d, -1)) }
    case 'this-week':
      return { from: dayKeyOf(monday), to: dayKeyOf(add(monday, 6)) }
    case 'last-week':
      return { from: dayKeyOf(add(monday, -7)), to: dayKeyOf(add(monday, -1)) }
    case 'this-month':
      return { from: dayKeyOf(new Date(d.getFullYear(), d.getMonth(), 1)), to: dayKeyOf(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
    case 'last-month':
      return { from: dayKeyOf(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: dayKeyOf(new Date(d.getFullYear(), d.getMonth(), 0)) }
    case 'custom': {
      const a = m.from ?? dayKeyOf(d)
      const b = m.to ?? a
      return a <= b ? { from: a, to: b } : { from: b, to: a }
    }
    case 'today':
      return { from: dayKeyOf(d), to: dayKeyOf(d) }
  }
}
export interface WorkItem {
  id: string
  kind: string
  label: string
  task?: string
  start: number
  end: number
}
export interface WorkReport {
  days: Array<{ day: string; items: WorkItem[]; total: number }>
  /** Per kind: the sum of its events (parallel ones of one kind counted once). */
  byKind: Array<{ kind: string; ms: number; count: number }>
  /** All the work, parallel events counted once. */
  total: number
}
/** The length of a union of intervals (overlaps counted once). */
const unionOf = (list: Array<{ start: number; end: number }>) => {
  const s = [...list].sort((a, b) => a.start - b.start)
  let total = 0
  let cs = -Infinity
  let ce = -Infinity
  for (const x of s) {
    if (x.start > ce) {
      if (ce > cs) total += ce - cs
      cs = x.start
      ce = x.end
    } else ce = Math.max(ce, x.end)
  }
  if (ce > cs) total += ce - cs
  return total
}
/** The productive events of the days, by day, and the totals (now cuts an event still going on). */
export function workReport(days: Array<{ day: string; entries: Array<WorkItem & { source?: string }> }>, productive: (kind: string) => boolean, now = Date.now()): WorkReport {
  const out: WorkReport = { days: [], byKind: [], total: 0 }
  const kinds = new Map<string, WorkItem[]>()
  const all: WorkItem[] = []
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    const items = d.entries
      .filter((e) => productive(e.kind) && e.start < now)
      .map((e) => ({ id: e.id, kind: e.kind, label: e.label, task: e.task, start: e.start, end: Math.min(e.end, Math.max(e.start, now)) }))
      .sort((a, b) => a.start - b.start)
    if (!items.length) continue
    out.days.push({ day: d.day, items, total: unionOf(items) })
    for (const it of items) {
      kinds.set(it.kind, [...(kinds.get(it.kind) ?? []), it])
      all.push(it)
    }
  }
  out.byKind = [...kinds].map(([kind, l]) => ({ kind, ms: unionOf(l), count: l.length })).sort((a, b) => b.ms - a.ms)
  out.total = unionOf(all)
  return out
}
