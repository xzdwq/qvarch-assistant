import { formatHM } from '../timeline'
import type { Ms } from '../types'
import { minorTicks, type AxisMark, type DaySchedule } from './timelineAxis'

/** What the island's time axis draws: labelled ticks, schedule marks, unlabeled divisions, all tick positions. */
export interface IslandAxis {
  list: Ms[]
  marks: AxisMark[]
  minor: Ms[]
  all: Ms[]
}

const pctOf = (t: Ms, from: Ms, to: Ms) => ((t - from) / (to - from || 1)) * 100

/** The "Сейчас" label never goes past 88% — it is the widest label on the axis. */
export const NOW_LABEL_MAX_PCT = 88

/**
 * Axis labels: ticks + official start / lunch / end + "Сейчас"; the more important label wins on overlap
 * (in % of the track: a mark within 12 of "now" is dropped, a tick within 9 of "now" or 7.5 of a mark too).
 */
export function islandAxis(o: { from: Ms; to: Ms; now: Ms; schedule: DaySchedule; ticks: { step: number; list: Ms[] } }): IslandAxis {
  const { from, to } = o
  const pct = (t: Ms) => pctOf(t, from, to)
  const nowPct = Math.min(pct(o.now), NOW_LABEL_MAX_PCT)
  const marks: AxisMark[] = []
  const w = o.schedule.work
  const l = o.schedule.lunch
  if (w) marks.push({ t: w[0], text: `Начало ${formatHM(w[0])}`, cls: 'sch' }, { t: w[1], text: `Конец ${formatHM(w[1])}`, cls: 'sch' })
  if (l) marks.push({ t: l[0], text: 'Обед', cls: 'lunch' })
  const inView = marks.filter((m) => m.t >= from && m.t <= to && Math.abs(pct(m.t) - nowPct) > 12)
  const taken = inView.map((m) => pct(m.t))
  // the wide "Сейчас HH:MM" label needs more room than the others
  const list = o.ticks.list.filter((t) => {
    const p = pct(t)
    return Math.abs(p - nowPct) > 9 && taken.every((q) => Math.abs(p - q) > 7.5)
  })
  return { list, marks: inView, minor: minorTicks(from, to, o.ticks.step, o.ticks.list), all: o.ticks.list }
}
