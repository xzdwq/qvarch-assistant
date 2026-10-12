import { shallowRef } from 'vue'
import type { LocalTask } from '@shared/types'

const state = shallowRef<LocalTask[]>([])
let started = false

/** Own tasks (Q-n), shared by every component of a window (one subscription). */
export function useLocalTasks() {
  if (!started) {
    started = true
    void window.qa.tasks().then((t) => (state.value = t))
    window.qa.onTasks((t) => (state.value = t))
  }
  return state
}
