import { ref, watch, type Ref } from 'vue'
import { plainTask, type TaskRef } from '@shared/jira'
import { formatHM, splitTitle } from '@shared/timeline'
import { quickEventPlace } from '@shared/tracker/islandCut'
import { VOICE_PENDING } from '@shared/voice'
import type { QuickParsed } from '../components/QuickField.vue'
import { saveRecording, type Dictation } from '../lib/recorder'
import { kindLabel } from '../lib/palette'

/** A dictation from DictateButton: kept as an audio note of the new block, its transcript fills the text. */
export type { Dictation } from '../lib/recorder'

/** The orb panel's «Событие»: a block in a couple of clicks — kind, period (± minutes from now), an optional title. */
export function useQuickEvent(today: Ref<string>, qMsg: Ref<string>) {
  const qKind = ref('task')
  const qLabel = ref('')
  /** ± minutes from now: − the last N, + the next N. */
  const qOff = ref(-30)
  /** What the «Событие» line says — the quick way, as everywhere. */
  const qParsed = ref<QuickParsed>()
  watch(
    () => qParsed.value?.q.kind,
    (k) => k && (qKind.value = k),
  )
  const qTask = ref<TaskRef>()

  async function addQuickEvent(dict?: Dictation): Promise<void> {
    const q = qParsed.value?.q
    // the offset field, unless the line names the time or the duration
    const { day, start, end } = quickEventPlace({ q, offsetMin: qOff.value, now: Date.now(), today: today.value })
    // first line — the title, the rest — the description
    const parts = splitTitle(qLabel.value)
    const task = qTask.value ?? qParsed.value?.task
    const title = q ? q.label : parts.label
    const label = title || (dict ? VOICE_PENDING : task ? `${task.key} ${task.summary}`.trim() : kindLabel(qKind.value))
    const saved = await window.qa.saveEntry(day, { start, end, kind: qKind.value, label, description: parts.description, task: task ? plainTask(task) : undefined, source: 'manual' }, { overlap: true })
    if (dict) void saveRecording(day, { ...dict, at: start }, { entryId: saved.id })
    qTask.value = undefined
    qMsg.value = `Добавлено · ${kindLabel(qKind.value)} ${formatHM(start)}–${formatHM(end)}${dict ? ' · расшифровка…' : ''}`
    qLabel.value = ''
  }

  return { qKind, qLabel, qOff, qParsed, qTask, addQuickEvent }
}
