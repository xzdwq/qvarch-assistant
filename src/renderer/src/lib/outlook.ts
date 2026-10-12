import { shallowRef } from 'vue'
import type { OutlookState } from '@shared/outlook'

const state = shallowRef<OutlookState>({ source: 'local', configured: false, connected: false, syncing: false })
let started = false

/** The Outlook / Teams connection state, shared by every component of a window (one subscription). */
export function useOutlook() {
  if (!started) {
    started = true
    void window.qa.outlookState().then((s) => (state.value = s))
    window.qa.onOutlook((s) => (state.value = s))
  }
  return state
}
