import { formatHM, HOUR } from '../timeline'
import type { Ms } from '../types'

/** A labelled moment on the axis: the official start / end, lunch. */
export interface AxisMark {
  t: Ms
  text: string
  cls: string
}

/** What the time axis draws: labelled ticks, schedule marks, unlabeled divisions, all tick positions. */
export interface TimelineAxis {
  step: number
  list: Ms[]
  marks: AxisMark[]
  minor: Ms[]
  all: Ms[]
}

export interface DaySchedule {
  work?: [Ms, Ms]
  lunch?: [Ms, Ms]
}

/** Unlabeled divisions between tick labels: quarters for hour+ steps, halves otherwise. */
export function minorTicks(from: Ms, to: Ms, step: number, labelled: Ms[]): Ms[] {
  const sub = step >= HOUR ? step / 4 : step / 2
  const minor: Ms[] = []
  for (let t = Math.ceil(from / sub) * sub; t <= to; t += sub) if (!labelled.includes(t)) minor.push(t)
  return minor
}

/** The schedule's labels: work start and end, lunch at its middle. */
export function scheduleMarks(schedule: DaySchedule): AxisMark[] {
  const marks: AxisMark[] = []
  const w = schedule.work
  const l = schedule.lunch
  if (w) marks.push({ t: w[0], text: `Начало ${formatHM(w[0])}`, cls: 'sch' }, { t: w[1], text: `Конец ${formatHM(w[1])}`, cls: 'sch' })
  if (l) marks.push({ t: (l[0] + l[1]) / 2, text: `Обед ${formatHM(l[0])}–${formatHM(l[1])}`, cls: 'lunch' })
  return marks
}

/** Pixel offset of a moment on a track `widthPx` wide showing [from, to]. */
function pxOf(t: Ms, from: Ms, to: Ms, widthPx: number): number {
  const pct = ((t - from) / (to - from || 1)) * 100
  return (pct / 100) * widthPx
}

/**
 * Ticks + official schedule marks; "now" and schedule labels win over ticks they would overlap.
 * A schedule mark closer than 90px to "now" is dropped, a tick closer than 56px to a winner too.
 */
export function timelineAxis(o: { ticks: { step: number; list: Ms[] }; from: Ms; to: Ms; widthPx: number; now?: Ms; schedule: DaySchedule }): TimelineAxis {
  const { from, to, widthPx } = o
  const px = (t: Ms) => pxOf(t, from, to, widthPx)
  const nowPx = o.now ? px(o.now) : undefined
  const marks = scheduleMarks(o.schedule).filter((m) => m.t >= from && m.t <= to && (nowPx === undefined || Math.abs(px(m.t) - nowPx) > 90))
  const taken = [...(nowPx !== undefined ? [nowPx] : []), ...marks.map((m) => px(m.t))]
  const all = o.ticks.list
  return {
    step: o.ticks.step,
    list: all.filter((t) => taken.every((p) => Math.abs(px(t) - p) > 56)),
    marks,
    minor: minorTicks(from, to, o.ticks.step, all),
    all,
  }
}
