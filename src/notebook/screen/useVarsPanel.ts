import { ref } from 'vue'

/**
 * The note's variables panel (what its blocks published), opened from its button — a popover by the button
 * (NoteVarsPanel): it stays by it (a pane resized), closes when the button is gone or on a press elsewhere.
 */
export function useVarsPanel() {
  const varsOpen = ref<{ path: string; anchor: HTMLElement }>()
  /** Opened by its button (again — closed). */
  function toggleVars(path: string, e: MouseEvent): void {
    varsOpen.value = varsOpen.value?.path === path ? undefined : { path, anchor: e.currentTarget as HTMLElement }
  }
  return { varsOpen, toggleVars }
}
