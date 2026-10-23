import { onBeforeUnmount, ref } from 'vue'
import { dayKey } from '@shared/timeline'
import type { Entry, RecordingState } from '@shared/types'

/**
 * «Запись» as a screen sees it: whether one goes on (and its event) — told by the main process with the day's state;
 * begun / stopped there (it goes on with the window closed).
 */
export function useRecording() {
  const state = ref<RecordingState>()
  const off = window.qa.onDayState((m) => (state.value = m.live.recording))
  onBeforeUnmount(off)
  void window.qa.getLive().then((l) => (state.value = l.recording))
  /** A recording begun now: an event of this kind, its end following the clock. */
  async function start(kind: string, label: string): Promise<Entry> {
    const e = await window.qa.recordStart(kind, label)
    state.value = { day: dayKey(e.start), entryId: e.id }
    return e
  }
  async function stop(): Promise<void> {
    await window.qa.recordStop()
    state.value = undefined
  }
  /** The event is the recording's (it goes on now). */
  const isRecording = (id: string | undefined) => !!id && state.value?.entryId === id
  return { state, start, stop, isRecording }
}
