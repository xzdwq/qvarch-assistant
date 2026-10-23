import { computed, nextTick, ref, watch } from 'vue'
import { plainTask, tasksWord, type TaskRef } from '@shared/jira'
import { formatDuration, MINUTE, splitTitle } from '@shared/timeline'
import { cutPlace } from '@shared/tracker/islandCut'
import { blockLabel, errorText } from '@shared/tracker/entryForm'
import type { Entry, EntryKind, Ms } from '@shared/types'
import { isKind } from '@shared/tracker/constants'
import { isCall } from '@shared/work'
import { VOICE_PENDING } from '@shared/voice'
import type { QuickParsed } from '../components/QuickField.vue'
import { kindLabel } from '../lib/palette'
import { saveRecording } from '../lib/recorder'
import type { IslandDay } from './useIslandDay'
import type { IslandElements } from './islandElements'
import type { IslandSelection } from './useIslandSelection'
import type { Dictation } from './useQuickEvent'

/**
 * Cutting: the marker (or the implicit period, or what the line says) becomes a block of the picked kind — one
 * parallel block per linked task. Picking «call» jumps to the latest unlabelled call; a click on a block with a
 * marker continues that topic.
 */
export function useIslandCut(els: IslandElements, day: IslandDay, pick: IslandSelection, flash: (text: string, ok: boolean) => void) {
  const { today, data, now } = day
  const { sel, marker, active, activeEnd, makeSel } = pick
  const kind = ref<EntryKind>('task')
  const label = ref('')
  const saving = ref(false)
  /** The task(s) the next cut goes to — several → one parallel block per task. */
  const cutTasks = ref<TaskRef[]>([])
  /** What the cut row's line says (time, duration, day, kind, task) — the quick way, as everywhere. */
  const cutParsed = ref<QuickParsed>()
  watch(
    () => cutParsed.value?.q.kind,
    (k) => k && (kind.value = k),
  )

  /** Calls the mic noticed (2+ minutes) that no call block covers yet — the last two. */
  const detectedCalls = computed(() =>
    data.value.calls
      .filter((c) => c.end - c.start >= 2 * MINUTE)
      .filter((c) => !data.value.entries.some((e) => isCall(e) && e.start < c.end && e.end > c.start))
      .slice(-2),
  )
  const focusLine = () => void nextTick(() => els.labelInput.value?.focus())

  function pickKind(k: string): void {
    kind.value = k
    if (isKind(k, 'call')) {
      // jump to the latest detected call that is not labelled yet
      const call = detectedCalls.value[detectedCalls.value.length - 1]
      if (call && !marker.value) sel.commit(makeSel(call.start, call.end))
    }
    focusLine()
  }
  function useCall(c: { start: Ms; end: Ms; app: string }): void {
    kind.value = 'call'
    sel.commit(makeSel(c.start, c.end))
    if (!label.value) label.value = `Созвон ${c.app}`
  }
  /** "Continue that topic": the block's kind and text go to the cut row. */
  function copyFrom(e: Entry): void {
    kind.value = e.kind
    label.value = e.label
    flash(`Продолжение: ${kindLabel(e.kind)} · ${e.label}`, true)
    focusLine()
  }

  async function cut(dict?: Dictation): Promise<void> {
    if (saving.value) return
    const parts = splitTitle(label.value)
    const q = cutParsed.value?.q
    const { day: target, range, text } = cutPlace({
      title: q ? q.label : parts.label,
      q,
      hasMarker: !!marker.value,
      active: active.value ? { start: active.value.start, end: activeEnd.value } : undefined,
      now: now.value,
      today: today.value,
    })
    if (!range) return flash('Нечего отрезать — выделите участок шкалы', false)
    if (range.end - range.start < MINUTE) return flash('Слишком короткий отрезок', false)
    saving.value = true
    try {
      // one block per linked task (parallel, on free lanes); without a task — one block
      const named = cutParsed.value?.task
      const list = named && !cutTasks.value.some((x) => x.key === named.key) ? [...cutTasks.value, named] : cutTasks.value
      const targets: Array<TaskRef | undefined> = list.length ? list.map(plainTask) : [undefined]
      let firstId: string | undefined
      for (const t of targets) {
        const saved = await window.qa.saveEntry(
          target,
          {
            ...range,
            kind: kind.value,
            // a meeting or a break needs no description — the kind itself (or the linked task) is the label;
            // dictated: a placeholder until the transcript fills it
            label: blockLabel(text, t, kindLabel(kind.value), dict ? VOICE_PENDING : undefined),
            description: parts.description,
            task: t,
            source: 'manual',
          },
          { overlap: true }, // other blocks under the new one stay — they go parallel
        )
        firstId ??= saved.id
      }
      // the dictation is kept as an audio note of the block; its transcript fills the block's text
      if (dict && firstId) void saveRecording(target, { ...dict, at: range.start }, { entryId: firstId })
      flash(`Сохранено · ${targets.length > 1 ? tasksWord(targets.length) : kindLabel(kind.value)} · ${formatDuration(range.end - range.start)}${target !== today.value ? ` · ${target.slice(8)}.${target.slice(5, 7)}` : ''}`, true)
      if (marker.value) sel.clear()
      label.value = ''
      kind.value = 'task'
      cutTasks.value = []
    } catch (e) {
      flash(errorText(e), false)
    } finally {
      saving.value = false
    }
  }

  return { kind, label, saving, cutTasks, cutParsed, detectedCalls, pickKind, useCall, copyFrom, cut }
}

export type IslandCut = ReturnType<typeof useIslandCut>
