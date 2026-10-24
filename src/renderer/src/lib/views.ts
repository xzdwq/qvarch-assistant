import { ref } from 'vue'
import { headerIds, placeOf } from '@shared/places'
import type { UiPrefs } from '@shared/types'

/** The sections of the main window, in the default menu order. */
export type View = 'work' | 'notebook' | 'release' | 'browser' | 'http' | 'terminal' | 'tools' | 'settings'
export const VIEWS: Array<{ id: Exclude<View, 'settings'>; icon: string; label: string }> = [
  { id: 'work', icon: 'checkSquare', label: 'Моя работа' },
  { id: 'notebook', icon: 'notebook', label: 'Блокнот' },
  { id: 'release', icon: 'branch', label: 'Релиз' },
  { id: 'browser', icon: 'globe', label: 'Браузер' },
  { id: 'http', icon: 'api', label: 'HTTP' },
  { id: 'terminal', icon: 'terminal', label: 'Терминал' },
  { id: 'tools', icon: 'wrench', label: 'Инструменты' },
]
const VIEW_IDS = VIEWS.map((v) => v.id)

/** The bar's sections in the user's order (the ones moved into «Инструменты» left out). */
export function orderedViews(menu: UiPrefs['menu'] | undefined): typeof VIEWS {
  if (!menu) return VIEWS
  return headerIds(menu, VIEW_IDS).map((id) => VIEWS.find((v) => v.id === id)!)
}

// ---------- where the window is: a section on the bar, or a tool / a section inside «Инструменты» ----------
/** The section shown. */
export const view = ref<View>('work')
const TOOL_KEY = 'qa.tools.sel'
/** What «Инструменты» shows (a tool, or a section moved there). */
export const toolSel = ref<string>(readTool())
function readTool(): string {
  try {
    return localStorage.getItem(TOOL_KEY) || 'diff'
  } catch {
    return 'diff'
  }
}
/** The menu as the settings say (set by the window once they are loaded). */
let menuNow: UiPrefs['menu'] | undefined
export const setMenu = (m: UiPrefs['menu'] | undefined) => void (menuNow = m)

/** A section (or a tool) opened wherever it stands: on the bar — itself; in «Инструменты» — there. */
export function openPlace(id: string): void {
  if (menuNow && placeOf(menuNow, id) === 'tools') {
    toolSel.value = id
    try {
      localStorage.setItem(TOOL_KEY, id)
    } catch {
      // fine
    }
    view.value = 'tools'
  } else view.value = id as View
}
/** A request of the HTTP collection shown (a chain recorded in the browser, a Swagger import): picked there, HTTP opened. */
export function openHttp(requestId: string): void {
  try {
    localStorage.setItem('qa.http.sel', requestId)
  } catch {
    // fine
  }
  // (HTTP may be on screen already — kept in «Инструменты»: it picks the request itself)
  window.dispatchEvent(new CustomEvent('qa:http-select', { detail: requestId }))
  openPlace('http')
}
