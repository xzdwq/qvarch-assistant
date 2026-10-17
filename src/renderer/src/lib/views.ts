import type { UiPrefs } from '@shared/types'

/** The sections of the main window, in the default menu order. */
export type View = 'dashboard' | 'day' | 'calendar' | 'work' | 'reports' | 'notebook' | 'release' | 'browser' | 'http' | 'terminal' | 'pdf' | 'settings'
export const VIEWS: Array<{ id: Exclude<View, 'settings'>; icon: string; label: string }> = [
  { id: 'dashboard', icon: 'dashboard', label: 'Дашборд' },
  { id: 'day', icon: 'timeline', label: 'Таймлайн' },
  { id: 'calendar', icon: 'calendar', label: 'Календарь' },
  { id: 'work', icon: 'checkSquare', label: 'Моя работа' },
  { id: 'reports', icon: 'chart', label: 'Аналитика' },
  { id: 'notebook', icon: 'notebook', label: 'Блокнот' },
  { id: 'release', icon: 'branch', label: 'Релиз' },
  { id: 'browser', icon: 'globe', label: 'Браузер' },
  { id: 'http', icon: 'api', label: 'HTTP' },
  { id: 'terminal', icon: 'terminal', label: 'Терминал' },
  { id: 'pdf', icon: 'signature', label: 'Подпись PDF' },
]

/** The sections in the user's order (new / unknown ones keep their default place at the end). */
export function orderedViews(menu: UiPrefs['menu'] | undefined): typeof VIEWS {
  const order = menu?.order ?? []
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i < 0 ? order.length + VIEWS.findIndex((v) => v.id === id) : i
  }
  return [...VIEWS].sort((a, b) => rank(a.id) - rank(b.id))
}
