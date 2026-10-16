import { themeVars } from '@shared/theme'
import type { PublicSettings } from '@shared/types'

/** Applies the user's theme to this window and follows its changes (both the main window and the island). */
export function syncTheme(): void {
  const apply = (s: PublicSettings) => {
    const root = document.documentElement.style
    for (const [k, v] of Object.entries(themeVars(s.ui.theme))) root.setProperty(k, v)
  }
  void window.qa.getSettings().then(apply)
  window.qa.onSettings(apply)
}
