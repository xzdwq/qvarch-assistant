import { computed, shallowRef, watch } from 'vue'
import type { AiSignal } from '@shared/agent/harness/constants'
import { noteOfRoom } from './agentContext'
import { agentWork } from './agentTurns'
import { roomOf } from './chat'
import { harnessRuns, isRunning } from './harness/harnessDriver'

/**
 * What the AI is doing in the notes, by note: working (an agent's turn, a harness run going on) or waiting for the
 * person (a harness's plan to take, its question). The status bar and the notes' tabs and tree show it — one need not
 * scroll to the chat to see it.
 */

/** The note of each room an agent works in (found once per room). */
const roomDocs = shallowRef(new Map<string, string>())
watch(
  () => [...agentWork.value.keys()],
  (rooms) => {
    for (const id of rooms) {
      const room = roomOf(id)
      if (!room || roomDocs.value.has(id)) continue
      void noteOfRoom(room).then((p) => p && (roomDocs.value = new Map(roomDocs.value).set(id, p)))
    }
  },
)

/** Each note's signal (the person's turn first: it outweighs the work). */
export const aiSignals = computed(() => {
  const m = new Map<string, AiSignal>()
  for (const run of harnessRuns.value) {
    if (!run.doc) continue
    if (run.phase === 'help' || run.phase === 'confirm') m.set(run.doc, 'human')
    else if (isRunning(run) && !m.has(run.doc)) m.set(run.doc, 'work')
  }
  for (const room of agentWork.value.keys()) {
    const doc = roomDocs.value.get(room)
    if (doc && !m.has(doc)) m.set(doc, 'work')
  }
  return m
})
export const aiSignalOf = (path: string): AiSignal | undefined => aiSignals.value.get(path)
/** The notes waiting for the person, and the ones the AI works in. */
export const aiWaiting = computed(() => [...aiSignals.value].filter(([, s]) => s === 'human').map(([p]) => p))
export const aiWorking = computed(() => [...aiSignals.value].filter(([, s]) => s === 'work').map(([p]) => p))
