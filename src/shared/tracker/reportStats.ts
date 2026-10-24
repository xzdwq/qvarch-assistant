import { formatDuration, formatHM, shiftDay } from '../timeline'
import { groupItems, sourceOf, taskType, unionOf, type GroupBy, type ReportGroupBy, type ReportItem } from '../report'
import { attrDim, attrOfDim, attrValue, optionColor, optionLabel, type AttrDef } from './attributes'
import type { EventStat } from '../analytics'
import { fmtDay } from './reportPeriod'
import { isKind, TASK_TYPE_LOOK } from './constants'
import { isCall, isMeeting } from '../work'

/** How kinds look (the palette lives in the renderer; pure code gets it passed in). */
export interface KindLook {
  label: (kind: string) => string
  color: (kind: string) => string
}

/** One total card: this period, the previous one, and the per-day curve. */
export interface Kpi {
  label: string
  ms: number
  prev: number
  color?: string
  main: boolean
  spark: number[]
}

/** The total cards: all, the daily average, Jira, calls, meetings (in this order — insights read them by index). */
export function kpiCards(items: ReportItem[], prevItems: ReportItem[], days: string[], kind: KindLook): Kpi[] {
  const byDay = new Map<string, ReportItem[]>()
  for (const i of items) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i])
  const make = (label: string, pred: (i: ReportItem) => boolean, color?: string, main = false): Kpi => ({
    label,
    ms: unionOf(items.filter(pred)),
    prev: unionOf(prevItems.filter(pred)),
    color,
    main,
    spark: days.map((d) => unionOf((byDay.get(d) ?? []).filter(pred))),
  })
  const active = new Set(items.map((i) => i.day)).size
  const prevActive = new Set(prevItems.map((i) => i.day)).size
  const avg: Kpi = { label: 'В среднем за день', ms: active ? unionOf(items) / active : 0, prev: prevActive ? unionOf(prevItems) / prevActive : 0, color: undefined, main: false, spark: [] }
  return [
    make('Всего', () => true, undefined, true),
    avg,
    make('Jira', (i) => taskType(i.e) === 'jira', 'var(--report-kpi-jira)'),
    make('Созвоны', (i) => isCall(i.e), kind.color('call')),
    make('Встречи', (i) => isMeeting(i.e), kind.color('meeting')),
  ]
}

/** The change against the previous period, % (none when there was nothing before). */
export const changePct = (k: { ms: number; prev: number }): number | undefined => (k.prev > 0 ? Math.round(((k.ms - k.prev) / k.prev) * 100) : undefined)

/** An event's name: its task, else its label, else its kind. */
export const eventLabel = (ev: EventStat, kindLabel: (kind: string) => string): string => (ev.task ? `${ev.task.key} ${ev.task.summary}`.trim() : ev.label || kindLabel(ev.kind))

export interface Insight {
  k: string
  v: string
  tone?: 'up' | 'down' | 'warn'
}

/** A few plain sentences about the period. */
export function reportInsights(a: { items: ReportItem[]; total: number; events: EventStat[]; kpi: Kpi[]; days: string[]; heat: number[][]; kindLabel: (kind: string) => string }): Insight[] {
  const out: Insight[] = []
  const tot = a.total
  if (!tot) return out
  const top = a.events[0]
  if (top) out.push({ k: 'Больше всего', v: `${eventLabel(top, a.kindLabel)} — ${formatDuration(top.ms)} (${Math.round((top.ms / tot) * 100)}%)` })
  const meet = a.kpi[4].ms + a.kpi[3].ms
  if (meet) out.push({ k: 'Встречи и созвоны', v: `${Math.round((meet / tot) * 100)}% времени`, tone: meet / tot > 0.5 ? 'warn' : undefined })
  const busiest = a.days.map((d, i) => ({ d, ms: a.kpi[0].spark[i] ?? 0 })).sort((x, y) => y.ms - x.ms)[0]
  if (busiest?.ms && a.days.length > 1) out.push({ k: 'Самый загруженный', v: `${fmtDay(busiest.d, { weekday: 'short', day: 'numeric', month: 'short' })} — ${formatDuration(busiest.ms)}` })
  const hours = a.heat.reduce((acc, row) => row.map((v, h) => v + (acc[h] ?? 0)), [] as number[])
  const peak = hours.indexOf(Math.max(...hours))
  if (hours[peak]) out.push({ k: 'Пик по часам', v: `${peak}:00–${peak + 1}:00` })
  const noTask = unionOf(a.items.filter((i) => !i.e.task && isKind(i.e.kind, 'task')))
  if (noTask) out.push({ k: 'Задачи без ключа', v: formatDuration(noTask), tone: 'warn' })
  const d = changePct(a.kpi[0])
  if (d !== undefined) out.push({ k: 'К прошлому периоду', v: `${d > 0 ? '+' : ''}${d}%`, tone: d >= 0 ? 'up' : 'down' })
  return out
}

/** A breakdown row's head: name, an optional second line, its colour. */
export interface GroupHead {
  name: string
  sub?: string
  color: string
}

/** Each grouping names its rows its own way. */
const GROUP_HEADS: Record<GroupBy, (key: string, kind: KindLook, summaryOf: (taskKey: string) => string) => GroupHead> = {
  kind: (key, kind) => ({ name: kind.label(key), color: kind.color(key) }),
  task: (key, _kind, summaryOf) => {
    const type = taskType({ task: key ? { key } : undefined })
    return type === 'none' ? { name: TASK_TYPE_LOOK.none.label, color: TASK_TYPE_LOOK.none.color } : { name: key, sub: summaryOf(key), color: TASK_TYPE_LOOK[type].color }
  },
  day: (key) => ({ name: fmtDay(key, { weekday: 'short', day: 'numeric', month: 'short' }), color: 'var(--accent)' }),
  week: (key) => ({ name: `${fmtDay(key, { day: 'numeric', month: 'short' })} – ${fmtDay(shiftDay(key, 6), { day: 'numeric', month: 'short' })}`, color: 'var(--accent)' }),
}
/** A row's head by its grouping — an attribute's: its value, in the attribute's colour. */
export function groupHead(key: string, by: ReportGroupBy, kind: KindLook, summaryOf: (taskKey: string) => string, attrs: readonly AttrDef[] = []): GroupHead {
  const id = attrOfDim(by)
  if (id === undefined) return GROUP_HEADS[by as GroupBy](key, kind, summaryOf)
  const def = attrs.find((a) => a.id === id)
  return { name: optionLabel(def, key), color: optionColor(def, key) }
}

/** An attribute's values over the period: time (overlaps once), how many events, the colour — the biggest first. */
export interface AttrRow {
  value: string
  label: string
  color: string
  ms: number
  count: number
}
/** Every attribute's values over the items (with «Без значения»; an attribute nobody set — left out). */
export function attrBreakdown(items: ReportItem[], defs: readonly AttrDef[]): Array<{ def: AttrDef; rows: AttrRow[]; total: number }> {
  return defs.flatMap((def) => {
    const rows = groupItems(items, attrDim(def.id)).map((g) => ({ value: g.key, label: optionLabel(def, g.key), color: optionColor(def, g.key), ms: g.ms, count: g.count }))
    if (!rows.some((r) => r.value)) return []
    return [{ def, rows, total: rows.reduce((s, r) => s + r.ms, 0) }]
  })
}

const HOUR = 3_600_000
/** The items as CSV (Excel-friendly: «;», decimal comma, BOM), in time order; a column per attribute at the end. */
export function reportCsv(items: ReportItem[], kindLabel: (kind: string) => string, attrs: readonly AttrDef[] = []): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  const rows = [['Дата', 'Начало', 'Конец', 'Часы', 'Вид', 'Задача', 'Название задачи', 'Запись', 'Источник', ...attrs.map((a) => q(a.name))].join(';')]
  for (const i of [...items].sort((a, b) => a.e.start - b.e.start))
    rows.push([i.day, formatHM(i.e.start), formatHM(i.e.end), ((i.e.end - i.e.start) / HOUR).toFixed(2).replace('.', ','), q(kindLabel(i.e.kind)), i.e.task?.key ?? '', q(i.e.task?.summary ?? ''), q(i.e.label), sourceOf(i.e), ...attrs.map((a) => (attrValue(i.e, a.id) ? q(optionLabel(a, attrValue(i.e, a.id))) : ''))].join(';'))
  return '﻿' + rows.join('\r\n')
}
