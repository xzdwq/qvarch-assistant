import type { UiPrefs, UiPrefsPatch } from './types'
import { isLinkStyle } from './linkpath'

/** Everything is shown by default; the user hides what they do not need (nothing is lost — only hidden). */
export const DEFAULT_UI: UiPrefs = {
  pill: { app: true, date: true, combo: true, wave: true, chips: true, stats: true, dayBar: true, plan: false },
  island: { date: true, wave: true, apps: true, totals: true, plan: false },
  main: { allStats: false, plan: true, ai: true },
  links: { style: 'curve' },
  timeline: { follow: false, stepSec: 60, leftPx: 200, idleSec: 10, zoom: 'keep', spanMin: 240, countdown: 'any' },
}

export function mergeUi(base: UiPrefs, patch?: UiPrefsPatch): UiPrefs {
  return {
    pill: { ...base.pill, ...patch?.pill },
    island: { ...base.island, ...patch?.island },
    main: { ...base.main, ...patch?.main },
    links: { style: isLinkStyle(patch?.links?.style) ? patch.links.style : base.links.style },
    timeline: clampTimeline({ ...DEFAULT_UI.timeline, ...base.timeline, ...patch?.timeline }),
  }
}
function clampTimeline(t: UiPrefs['timeline']): UiPrefs['timeline'] {
  const n = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d)
  return {
    follow: !!t.follow,
    stepSec: n(t.stepSec, 5, 3600, 60),
    leftPx: n(t.leftPx, 0, 2000, 200),
    idleSec: n(t.idleSec, 1, 600, 10),
    zoom: t.zoom === 'fixed' ? 'fixed' : 'keep',
    spanMin: n(t.spanMin, 15, 24 * 60, 240),
    countdown: t.countdown === 'outlook' ? 'outlook' : 'any',
  }
}
