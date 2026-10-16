import { cleanTheme, DEFAULT_THEME } from './theme'
import type { UiPrefs, UiPrefsPatch } from './types'

/** Everything is shown by default; the user hides what they do not need (nothing is lost — only hidden). */
export const DEFAULT_UI: UiPrefs = {
  pill: { app: true, date: true, combo: true, wave: true, chips: true, stats: true, dayBar: true, plan: false },
  dock: { orb: true, time: true, next: true, wave: false },
  island: { date: true, wave: true, totals: true, plan: false },
  main: { allStats: false, plan: true },
  timeline: { follow: false, stepSec: 60, leftPx: 200, idleSec: 10, zoom: 'keep', spanMin: 240, countdown: 'any' },
  theme: DEFAULT_THEME,
  menu: { order: [], hidden: [] },
}

/** Only the keys the defaults have (settings of removed features drop out). */
function only<T extends object>(def: T, v: Partial<T>): T {
  const out = { ...def }
  for (const k of Object.keys(def) as Array<keyof T>) if (v[k] !== undefined) out[k] = v[k] as T[keyof T]
  return out
}

export function mergeUi(base: UiPrefs, patch?: UiPrefsPatch): UiPrefs {
  return {
    pill: only(DEFAULT_UI.pill, { ...base.pill, ...patch?.pill }),
    dock: only(DEFAULT_UI.dock, { ...base.dock, ...patch?.dock }),
    island: only(DEFAULT_UI.island, { ...base.island, ...patch?.island }),
    main: only(DEFAULT_UI.main, { ...base.main, ...patch?.main }),
    timeline: clampTimeline({ ...DEFAULT_UI.timeline, ...base.timeline, ...patch?.timeline }),
    theme: cleanTheme({ ...base.theme, ...patch?.theme }),
    menu: cleanMenu({ ...DEFAULT_UI.menu, ...base.menu, ...patch?.menu }),
  }
}
function cleanMenu(m: UiPrefs['menu']): UiPrefs['menu'] {
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [])
  return { order: ids(m.order), hidden: ids(m.hidden) }
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
