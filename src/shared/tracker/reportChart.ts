import { formatDuration } from '../timeline'
import type { ReportItem } from '../report'
import { fmtDay } from './reportPeriod'
import type { KindLook } from './reportStats'
import { TASK_TYPE_LOOK, type ChartUnit } from './constants'
import { attrOfDim, attrValue, optionColor, optionLabel, type AttrDef, type AttrDimension } from './attributes'

/** One bar of the chart (as `bars` of shared/report builds it). */
export interface Bar {
  key: string
  parts: Map<string, number>
  total: number
}
export type { ChartUnit }
/** Bars by day up to two months, by week up to ~200 days, by month beyond. */
export const chartUnit = (dayCount: number): ChartUnit => (dayCount > 200 ? 'month' : dayCount > 62 ? 'week' : 'day')

/** Colours of the bars by task (the tracker's CSS variables): the biggest tasks get their own, the rest are "другое". */
const TASK_SERIES_COUNT = 10
const taskSeriesColor = (i: number): string => `var(--report-series-${(i % TASK_SERIES_COUNT) + 1})`
/** Series keys that are not a task: no task, and all the smaller ones. */
const TASK_EXTRAS = new Map<string, { label: string; color: string }>([
  ['', TASK_TYPE_LOOK.none],
  ['*', { label: 'Другие задачи', color: 'var(--report-series-rest)' }],
])
export type ChartColor = 'kind' | 'task' | AttrDimension

/** How the chart splits its bars: by kind, by the top tasks, or by an attribute's values. */
export interface SeriesScheme {
  of: (i: ReportItem) => string
  color: (s: string) => string
  label: (s: string) => string
}
export function seriesScheme(by: ChartColor, topTasks: string[], kind: KindLook, attrs: readonly AttrDef[] = []): SeriesScheme {
  if (by === 'kind') return { of: (i) => i.e.kind, color: kind.color, label: kind.label }
  const id = attrOfDim(by)
  if (id !== undefined) {
    const def = attrs.find((a) => a.id === id)
    return { of: (i) => attrValue(i.e, id), color: (s) => optionColor(def, s), label: (s) => optionLabel(def, s) }
  }
  return {
    of: (i) => (!i.e.task ? '' : topTasks.includes(i.e.task.key) ? i.e.task.key : '*'),
    color: (s) => TASK_EXTRAS.get(s)?.color ?? taskSeriesColor(topTasks.indexOf(s)),
    label: (s) => TASK_EXTRAS.get(s)?.label ?? s,
  }
}

/** All series present, the biggest first. */
export function seriesOrder(chart: Bar[]): string[] {
  const m = new Map<string, number>()
  for (const b of chart) for (const [k, v] of b.parts) m.set(k, (m.get(k) ?? 0) + v)
  return [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

const HOUR = 3_600_000
/** The y axis: a round top and a step giving at most ~4 lines. */
export function yScale(chart: Bar[]): { top: number; step: number } {
  const max = Math.max(HOUR, ...chart.map((b) => b.total))
  const step = [1, 2, 4, 5, 10, 20, 25, 50, 100, 200].map((x) => x * HOUR).find((s) => max / s <= 4) ?? 500 * HOUR
  return { top: Math.ceil(max / step) * step, step }
}
export function yTicks(scale: { top: number; step: number }): number[] {
  const out: number[] = []
  for (let v = 0; v <= scale.top; v += scale.step) out.push(v)
  return out
}

/** A bar's parts scaled to its total, % of the axis top (parts of different series may overlap in time). */
export function barSegments(b: Bar, series: string[], top: number): Array<{ s: string; h: number }> {
  const sum = [...b.parts.values()].reduce((a, x) => a + x, 0) || 1
  return series.filter((s) => b.parts.get(s)).map((s) => ({ s, h: (((b.parts.get(s) ?? 0) / sum) * b.total * 100) / top }))
}

/** The caption under a bar (a weekday too while the days are few). */
export function barCaption(key: string, unit: ChartUnit, dayCount: number): { top: string; sub?: string } {
  switch (unit) {
    case 'day':
      return { top: fmtDay(key, { day: 'numeric' }), sub: dayCount <= 14 ? fmtDay(key, { weekday: 'short' }) : undefined }
    case 'week':
      return { top: fmtDay(key, { day: 'numeric', month: 'short' }) }
    case 'month':
      return { top: fmtDay(`${key}-01`, { month: 'short' }) }
  }
}

/** A weekend day bar (dimmed). */
export const isWeekendBar = (key: string, unit: ChartUnit): boolean => unit === 'day' && [0, 6].includes(new Date(`${key}T12:00:00`).getDay())

const BAR_HEADS: Record<ChartUnit, (key: string) => string> = {
  day: (key) => fmtDay(key, { weekday: 'long', day: 'numeric', month: 'long' }),
  week: (key) => `Неделя с ${fmtDay(key, { day: 'numeric', month: 'long' })}`,
  month: (key) => fmtDay(`${key}-01`, { month: 'long', year: 'numeric' }),
}
/** A bar's tooltip: the period and its total, then each series. */
export function barTooltip(b: Bar, unit: ChartUnit, series: string[], label: (s: string) => string): string {
  return [`${BAR_HEADS[unit](b.key)} — ${formatDuration(b.total)}`, ...series.filter((s) => b.parts.get(s)).map((s) => `${label(s)}: ${formatDuration(b.parts.get(s)!)}`)].join('\n')
}
