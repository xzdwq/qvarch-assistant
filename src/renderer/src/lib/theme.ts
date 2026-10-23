import { themeRoot } from '@shared/theme'
import type { PublicSettings } from '@shared/types'

/** Applies the user's theme to this window and follows its changes (both the main window and the island). */
export function syncTheme(): void {
  const apply = (s: PublicSettings) => {
    const root = document.documentElement
    const { data, vars } = themeRoot(s.ui.theme)
    Object.assign(root.dataset, data)
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  }
  void window.qa.getSettings().then(apply)
  window.qa.onSettings(apply)
}
