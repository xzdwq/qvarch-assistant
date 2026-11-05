import { ref } from 'vue'
import { headerIds, placeOf } from '@shared/places'
import type { UiPrefs } from '@shared/types'
import { todayKey } from './today'
import { readStoredText, writeStoredText } from './storedRef'

/** The bar's sections of the main window, in the default menu order. */
const BAR_SECTIONS = [
  { id: 'work', icon: 'checkSquare', label: 'Моя работа' },
  { id: 'notebook', icon: 'notebook', label: 'Блокнот' },
  { id: 'release', icon: 'branch', label: 'Релиз' },
  { id: 'browser', icon: 'globe', label: 'Браузер' },
  { id: 'http', icon: 'api', label: 'HTTP' },
  { id: 'terminal', icon: 'terminal', label: 'Терминал' },
  { id: 'tools', icon: 'wrench', label: 'Инструменты' },
] as const
export type BarView = (typeof BAR_SECTIONS)[number]['id']
/** A section of the main window (the settings — by their own button, not on the bar). */
export type View = BarView | 'settings'
export interface Section {
  id: BarView
  icon: string
  label: string
}
export const VIEWS: readonly Section[] = BAR_SECTIONS
const VIEW_IDS = VIEWS.map((v) => v.id)
const isView = (id: string): id is View => id === 'settings' || VIEW_IDS.some((v) => v === id)
/** A bar section's icon and label (its item in «Инструменты» shows the same). */
export function sectionLook(id: BarView): Pick<Section, 'icon' | 'label'> {
  const { icon, label } = VIEWS.find((v) => v.id === id)!
  return { icon, label }
}

/** The bar's sections in the user's order (the ones moved into «Инструменты» left out). */
export function orderedViews(menu: UiPrefs['menu'] | undefined): readonly Section[] {
  if (!menu) return VIEWS
  return headerIds(menu, VIEW_IDS).map((id) => VIEWS.find((v) => v.id === id)!)
}

// ---------- where the window is: a section on the bar, or a tool / a section inside «Инструменты» ----------
/** The section shown. */
export const view = ref<View>('work')
const TOOL_KEY = 'qa.tools.sel'
/** What «Инструменты» shows (a tool, or a section moved there). */
export const toolSel = ref<string>(readStoredText(TOOL_KEY) || 'diff')
/** The menu as the settings say (set by the window once they are loaded). */
let menuNow: UiPrefs['menu'] | undefined
export const setMenu = (m: UiPrefs['menu'] | undefined) => void (menuNow = m)

/** A section (or a tool) opened wherever it stands: on the bar — itself; in «Инструменты» — there; an unknown id — nothing. */
export function openPlace(id: string): void {
  if (menuNow && placeOf(menuNow, id) === 'tools') {
    toolSel.value = id
    writeStoredText(TOOL_KEY, id)
    view.value = 'tools'
  } else if (isView(id)) view.value = id
}

/** A day (and a block on it) asked to be shown — Моя работа opens it; `n` tells a repeated ask apart. */
export const dayFocus = ref<{ day: string; entryId?: string; n: number }>()
let focusN = 0
/** A day (today when empty) shown in Моя работа, a block on it picked. */
export function openDay(day: string, entryId?: string): void {
  dayFocus.value = { day: day || todayKey.value, entryId, n: ++focusN }
  view.value = 'work'
}
/** A section (or a tool) on the screen now — on the bar, or picked in «Инструменты». */
export const isShown = (id: string) => view.value === id || (view.value === 'tools' && toolSel.value === id)

/**
 * Scenarios run in the Браузер's tab: the Браузер shown while any goes; the last one over — the window back where
 * it was before the first (not if the person went elsewhere meanwhile, nor if it was the Браузер already).
 */
let runsShown = 0
let runBack: string | undefined
export function showForRun(run: 'start' | 'end'): void {
  if (run === 'start') {
    if (!runsShown++) runBack = isShown('browser') ? undefined : view.value === 'tools' ? toolSel.value : view.value
    openPlace('browser')
    return
  }
  runsShown = Math.max(0, runsShown - 1)
  if (runsShown) return
  const back = runBack
  runBack = undefined
  if (back && isShown('browser')) openPlace(back)
}

/** A request of the HTTP collection shown (a chain recorded in the browser, a Swagger import): picked there, HTTP opened. */
export function openHttp(requestId: string): void {
  writeStoredText('qa.http.sel', requestId)
  // (HTTP may be on screen already — kept in «Инструменты»: it picks the request itself)
  window.dispatchEvent(new CustomEvent('qa:http-select', { detail: requestId }))
  openPlace('http')
}
