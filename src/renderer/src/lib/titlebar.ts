import { onBeforeUnmount, shallowRef, watchEffect } from 'vue'

/**
 * The icons in the middle of the main window's title bar — the open section's own actions (like the macOS
 * menu bar follows the app in front). A section registers them while it is shown.
 */
export interface TitleAction {
  id: string
  icon: string
  title: string
  on?: boolean
  click?: () => void
  /** A small list instead of an action. */
  menu?: Array<{ label: string; icon: string; click: () => void }>
}
export const titleActions = shallowRef<TitleAction[]>([])

export function useTitleActions(get: () => TitleAction[]): void {
  const stop = watchEffect(() => (titleActions.value = get()))
  onBeforeUnmount(() => {
    stop()
    titleActions.value = []
  })
}
