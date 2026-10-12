import { shallowRef } from 'vue'
import type { Selection } from '@shared/types'

/**
 * The cut marker, shared with the main process (and so with the other window).
 * While the user drags a handle we only update locally and commit on release.
 */
const sel = shallowRef<Selection | null>(null)
let dragging = false
let started = false

function ensure(): void {
  if (started) return
  started = true
  void window.qa.getSelection().then((s) => (sel.value = s))
  window.qa.onDayState((msg) => {
    if (!dragging) sel.value = msg.selection
  })
}

export function useSelection() {
  ensure()
  return {
    selection: sel,
    /** Local preview (during a drag). */
    preview(s: Selection | null): void {
      dragging = true
      sel.value = s
    },
    commit(s: Selection | null): void {
      dragging = false
      sel.value = s
      window.qa.setSelection(s)
    },
    clear(): void {
      dragging = false
      sel.value = null
      window.qa.setSelection(null)
    },
  }
}
